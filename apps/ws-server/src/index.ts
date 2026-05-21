// apps/ws-server/src/index.ts
// Production-grade WebSocket server for board realtime sync.
// Handles: subscribe, unsubscribe, ping/pong heartbeat, Redis pub/sub fanout.

import { WebSocketServer, WebSocket } from "ws";
import { Redis } from "ioredis";

// ============================================================================
// Config
// ============================================================================

const PORT           = parseInt(process.env.WS_PORT || "3001", 10);
const REDIS_URL      = process.env.REDIS_URL || "redis://localhost:6379";
const HEARTBEAT_MS   = 30_000;
const STALE_CHECK_MS = 35_000;
const MAX_CATCH_UP   = 200;

// ============================================================================
// Types
// ============================================================================

interface ClientState {
  ws: WebSocket;
  boardId: string | null;
  userId: string | null;
  lastSequence: string;
  lastPong: number;
  connectionId: string;
}

interface ClientMessage {
  action: "subscribe" | "unsubscribe" | "ping";
  boardId: string;
  lastSequence?: string;
  token?: string;
}

interface OutboxPayload {
  eventId: string;
  type: string;
  sequence: number;
  payload: Record<string, unknown>;
  correlationId?: string;
  occurredAt: string;
}

// ============================================================================
// Redis connections
// ============================================================================

const redisSub = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
const redisPub = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

// ============================================================================
// Client registry — boardId → Set<ClientState>
// ============================================================================

const boardClients = new Map<string, Set<ClientState>>();

// ============================================================================
// WebSocket Server
// ============================================================================

const wss = new WebSocketServer({ port: PORT });

console.log(`[WS Server] Listening on port ${PORT}`);

wss.on("connection", (ws) => {
  const client: ClientState = {
    ws,
    boardId: null,
    userId: null,
    lastSequence: "0",
    lastPong: Date.now(),
    connectionId: crypto.randomUUID(),
  };

  ws.on("message", (raw) => {
    try {
      const msg: ClientMessage = JSON.parse(raw.toString());
      handleMessage(client, msg);
    } catch (err) {
      sendError(client, "INVALID_MESSAGE", "Failed to parse message.");
    }
  });

  ws.on("pong", () => {
    client.lastPong = Date.now();
  });

  ws.on("close", () => {
    unsubscribeClient(client);
  });

  ws.on("error", () => {
    unsubscribeClient(client);
  });
});

// ============================================================================
// Message handler
// ============================================================================

function handleMessage(client: ClientState, msg: ClientMessage) {
  switch (msg.action) {
    case "subscribe":
      subscribeClient(client, msg.boardId, msg.lastSequence ?? "0", msg.token);
      break;

    case "unsubscribe":
      unsubscribeClient(client);
      break;

    case "ping":
      client.lastPong = Date.now();
      send(client, { type: "HEARTBEAT", meta: { timestamp: new Date().toISOString() } });
      break;
  }
}

// ============================================================================
// Subscribe / Unsubscribe
// ============================================================================

function subscribeClient(client: ClientState, boardId: string, lastSequence: string, token?: string) {
  // TODO Phase B: validate token / session here
  if (client.boardId) unsubscribeClient(client);

  client.boardId = boardId;
  client.lastSequence = lastSequence;

  let set = boardClients.get(boardId);
  if (!set) { set = new Set(); boardClients.set(boardId, set); }
  set.add(client);

  // Ensure Redis subscription for this board channel
  ensureRedisSubscription(boardId);

  // Send SUBSCRIBED ack
  send(client, {
    type: "SYSTEM",
    meta: { timestamp: new Date().toISOString(), reason: "SUBSCRIBED", connectionId: client.connectionId },
  });

  console.log(`[WS] Client ${client.connectionId} subscribed to board ${boardId} from seq ${lastSequence}`);
}

function unsubscribeClient(client: ClientState) {
  if (!client.boardId) return;

  const set = boardClients.get(client.boardId);
  if (set) {
    set.delete(client);
    if (set.size === 0) {
      boardClients.delete(client.boardId);
      // Optionally unsubscribe from Redis channel (keep for now — low cost)
    }
  }

  client.boardId = null;
}

// ============================================================================
// Redis pub/sub — subscribe to board channels
// ============================================================================

const subscribedChannels = new Set<string>();

function ensureRedisSubscription(boardId: string) {
  const channel = `board:${boardId}:events`;
  if (subscribedChannels.has(channel)) return;
  subscribedChannels.add(channel);
  redisSub.subscribe(channel);
}

redisSub.on("message", (channel, message) => {
  // channel = "board:<boardId>:events"
  const boardId = channel.split(":")[1];
  if (!boardId) return;

  const clients = boardClients.get(boardId);
  if (!clients || clients.size === 0) return;

  try {
    const event: OutboxPayload = JSON.parse(message);

    for (const client of clients) {
      // Only send events newer than the client's last known sequence
      const clientSeq = BigInt(client.lastSequence);
      const eventSeq  = BigInt(event.sequence);

      if (eventSeq <= clientSeq) continue;

      send(client, {
        type: "EVENT",
        sequence: String(event.sequence),
        payload: {
          id: event.eventId,
          type: event.type,
          version: 1,
          occurredAt: event.occurredAt,
          aggregateId: boardId,
          aggregateType: "board",
          correlationId: event.correlationId,
          payload: event.payload,
          sequence: event.sequence,
        },
      });

      // Update client's last sequence watermark
      client.lastSequence = String(event.sequence);
    }
  } catch (err) {
    console.error("[WS] Failed to parse Redis message", err);
  }
});

// ============================================================================
// Heartbeat — detect stale connections
// ============================================================================

const heartbeatInterval = setInterval(() => {
  const now = Date.now();

  for (const [, clients] of boardClients) {
    for (const client of clients) {
      if (now - client.lastPong > STALE_CHECK_MS) {
        // Client missed heartbeat — terminate
        console.log(`[WS] Terminating stale client ${client.connectionId}`);
        client.ws.terminate();
        unsubscribeClient(client);
        continue;
      }
      // Send ping
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.ping();
      }
    }
  }
}, HEARTBEAT_MS);

wss.on("close", () => {
  clearInterval(heartbeatInterval);
  redisSub.disconnect();
  redisPub.disconnect();
});

// ============================================================================
// Helpers
// ============================================================================

function send(client: ClientState, payload: Record<string, unknown>) {
  if (client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify(payload));
  }
}

function sendError(client: ClientState, code: string, message: string) {
  send(client, { type: "SYSTEM", meta: { timestamp: new Date().toISOString(), reason: code, message } });
}
