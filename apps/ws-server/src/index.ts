// apps/ws-server/src/index.ts
// Production-grade WebSocket server for board realtime sync.
// Handles: subscribe (with catch-up), unsubscribe, ping/pong heartbeat,
// presence/cursor/typing broadcast, Redis pub/sub fanout, RESYNC_REQUIRED.

import { WebSocketServer, WebSocket } from "ws";
import { Redis } from "ioredis";
import postgres from "postgres";
import { getSessionFromToken, type AuthSession } from "@repo/auth";

// ============================================================================
// Config
// ============================================================================

const PORT              = parseInt(process.env.WS_PORT || "3001", 10);
const REDIS_URL         = process.env.REDIS_URL || "redis://localhost:6379";
const DATABASE_URL      = process.env.DATABASE_URL || "";
const HEARTBEAT_MS      = 30_000;
const STALE_CHECK_MS    = 35_000;
const MAX_CATCH_UP      = 500;        // max events to send on catch-up
const RESYNC_THRESHOLD  = 500;        // if gap > this, force RESYNC_REQUIRED
const PRESENCE_TTL_MS   = 15_000;     // presence expires after 15s without heartbeat

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
  // Presence state for this client
  presenceCursor?: { x: number; y: number } | null;
  presenceStatus: "ACTIVE" | "IDLE";
  lastPresenceAt: number;
}

type ClientAction =
  | "subscribe"
  | "unsubscribe"
  | "ping"
  | "presence"
  | "cursor"
  | "typing";

interface ClientMessage {
  action: ClientAction;
  boardId: string;
  lastSequence?: string;
  token?: string;
  // Presence / cursor / typing payload
  userId?: string;
  cursor?: { x: number; y: number } | null;
  status?: "ACTIVE" | "IDLE";
  typing?: { cardId?: string; listId?: string; field?: string; active: boolean };
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
// Connections
// ============================================================================

const redisSub = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
const redisPub = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

// Database connection for catch-up queries
const sql = DATABASE_URL ? postgres(DATABASE_URL, { prepare: false, max: 5, idle_timeout: 30 }) : null;

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
    presenceCursor: null,
    presenceStatus: "ACTIVE",
    lastPresenceAt: Date.now(),
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
    broadcastPresenceLeave(client);
    unsubscribeClient(client);
  });

  ws.on("error", () => {
    broadcastPresenceLeave(client);
    unsubscribeClient(client);
  });
});

// ============================================================================
// Message handler
// ============================================================================

function handleMessage(client: ClientState, msg: ClientMessage) {
  switch (msg.action) {
    case "subscribe":
      subscribeClient(client, msg.boardId, msg.lastSequence ?? "0", msg.token, msg.userId);
      break;

    case "unsubscribe":
      broadcastPresenceLeave(client);
      unsubscribeClient(client);
      break;

    case "ping":
      client.lastPong = Date.now();
      send(client, { type: "HEARTBEAT", meta: { timestamp: new Date().toISOString() } });
      break;

    case "presence":
      handlePresence(client, msg);
      break;

    case "cursor":
      handleCursor(client, msg);
      break;

    case "typing":
      handleTyping(client, msg);
      break;
  }
}

// ============================================================================
// Subscribe with Catch-Up Sync + RESYNC_REQUIRED
// ============================================================================

async function subscribeClient(
  client: ClientState,
  boardId: string,
  lastSequence: string,
  token?: string,
  userId?: string,
) {
  // ── Token validation ───────────────────────────────────────────────────────
  // If AUTH_REQUIRED is enabled, reject connections without a valid JWT.
  const authRequired = process.env.WS_AUTH_REQUIRED !== "false"; // default: true

  if (authRequired) {
    if (!token) {
      send(client, {
        type: "SYSTEM",
        meta: { timestamp: new Date().toISOString(), reason: "AUTH_REQUIRED", message: "Token is required." },
      });
      client.ws.close(4001, "Unauthorized: no token");
      return;
    }

    const session: AuthSession | null = await getSessionFromToken(token);
    if (!session) {
      send(client, {
        type: "SYSTEM",
        meta: { timestamp: new Date().toISOString(), reason: "AUTH_FAILED", message: "Invalid or expired token." },
      });
      client.ws.close(4001, "Unauthorized: invalid token");
      return;
    }

    // Set userId and tenantId from verified session
    client.userId = session.user.id;
    console.log(`[WS] Auth OK for user ${session.user.id} (tenant: ${session.tenantId})`);
  } else {
    // Dev mode: accept userId from message payload
    client.userId = userId ?? null;
  }

  if (client.boardId) {
    broadcastPresenceLeave(client);
    unsubscribeClient(client);
  }

  client.boardId = boardId;
  client.lastSequence = lastSequence;
  client.lastPresenceAt = Date.now();

  let set = boardClients.get(boardId);
  if (!set) { set = new Set(); boardClients.set(boardId, set); }
  set.add(client);

  // Ensure Redis subscription for this board's event + presence channels
  ensureRedisSubscription(boardId);

  // ── Catch-up sync: pull missed events from DB ─────────────────────────────
  const catchUpResult = await performCatchUp(client, boardId, lastSequence);

  if (catchUpResult === "RESYNC_REQUIRED") {
    // Gap too large — tell client to do a full page refresh / refetch
    send(client, {
      type: "RESYNC_REQUIRED",
      meta: {
        timestamp: new Date().toISOString(),
        reason: "GAP_TOO_LARGE",
        connectionId: client.connectionId,
      },
    });
    console.log(`[WS] Client ${client.connectionId} requires RESYNC (gap too large) for board ${boardId}`);
    return;
  }

  // Send SUBSCRIBED ack AFTER catch-up is complete
  send(client, {
    type: "SYSTEM",
    meta: {
      timestamp: new Date().toISOString(),
      reason: "SUBSCRIBED",
      connectionId: client.connectionId,
      catchUpCount: catchUpResult,
    },
  });

  // Broadcast presence join to other clients on this board
  broadcastPresenceJoin(client);

  // Send current presence list to the newly connected client
  sendCurrentPresenceList(client);

  console.log(`[WS] Client ${client.connectionId} subscribed to board ${boardId} from seq ${lastSequence} (caught up ${catchUpResult} events)`);
}

// ============================================================================
// Catch-up sync implementation
// ============================================================================

async function performCatchUp(
  client: ClientState,
  boardId: string,
  lastSequence: string,
): Promise<number | "RESYNC_REQUIRED"> {
  if (!sql) {
    // No DB connection — skip catch-up (dev mode without DB)
    return 0;
  }

  const lastSeq = parseInt(lastSequence, 10);
  if (isNaN(lastSeq) || lastSeq < 0) return 0;

  try {
    // First: check how many events we'd need to send
    const countResult = await sql`
      SELECT COUNT(*)::int AS cnt
      FROM outbox_events
      WHERE aggregate_id = ${boardId}
        AND sequence > ${lastSeq}
    `;
    const totalMissed = countResult[0]?.cnt ?? 0;

    // If gap exceeds threshold, demand full resync
    if (totalMissed > RESYNC_THRESHOLD) {
      return "RESYNC_REQUIRED";
    }

    if (totalMissed === 0) return 0;

    // Pull the missed events in sequence order
    const rows = await sql`
      SELECT event_id, type, sequence, payload, correlation_id, occurred_at, event_version
      FROM outbox_events
      WHERE aggregate_id = ${boardId}
        AND sequence > ${lastSeq}
      ORDER BY sequence ASC
      LIMIT ${MAX_CATCH_UP}
    `;

    // Send each event to the client
    for (const row of rows) {
      send(client, {
        type: "EVENT",
        sequence: String(row.sequence),
        payload: {
          id: row.event_id,
          type: row.type,
          version: 1,
          occurredAt: row.occurred_at,
          aggregateId: boardId,
          aggregateType: "board",
          correlationId: row.correlation_id,
          payload: row.payload,
          sequence: row.sequence,
        },
      });

      // Update client watermark
      client.lastSequence = String(row.sequence);
    }

    return rows.length;
  } catch (err) {
    console.error("[WS] Catch-up query failed:", err);
    // On failure, let client proceed without catch-up — they'll detect gaps
    return 0;
  }
}

// ============================================================================
// Presence handling
// ============================================================================

function handlePresence(client: ClientState, msg: ClientMessage) {
  if (!client.boardId || !client.userId) return;

  client.presenceStatus = msg.status ?? "ACTIVE";
  client.lastPresenceAt = Date.now();

  // Broadcast to all OTHER clients on the same board
  broadcastToBoard(client.boardId, client, {
    type: "PRESENCE_UPDATE",
    payload: {
      userId: client.userId,
      status: client.presenceStatus,
      cursor: client.presenceCursor,
      connectionId: client.connectionId,
      timestamp: Date.now(),
    },
  });
}

function handleCursor(client: ClientState, msg: ClientMessage) {
  if (!client.boardId || !client.userId) return;

  client.presenceCursor = msg.cursor ?? null;
  client.lastPresenceAt = Date.now();

  // Broadcast cursor update to all OTHER clients on the same board
  broadcastToBoard(client.boardId, client, {
    type: "CURSOR_UPDATE",
    payload: {
      userId: client.userId,
      cursor: client.presenceCursor,
      timestamp: Date.now(),
    },
  });
}

function handleTyping(client: ClientState, msg: ClientMessage) {
  if (!client.boardId || !client.userId) return;

  client.lastPresenceAt = Date.now();

  // Broadcast typing status to all OTHER clients on the same board
  broadcastToBoard(client.boardId, client, {
    type: "TYPING_UPDATE",
    payload: {
      userId: client.userId,
      typing: msg.typing,
      timestamp: Date.now(),
    },
  });
}

function broadcastPresenceJoin(client: ClientState) {
  if (!client.boardId || !client.userId) return;

  broadcastToBoard(client.boardId, client, {
    type: "PRESENCE_JOIN",
    payload: {
      userId: client.userId,
      connectionId: client.connectionId,
      timestamp: Date.now(),
    },
  });
}

function broadcastPresenceLeave(client: ClientState) {
  if (!client.boardId || !client.userId) return;

  broadcastToBoard(client.boardId, client, {
    type: "PRESENCE_LEAVE",
    payload: {
      userId: client.userId,
      connectionId: client.connectionId,
      timestamp: Date.now(),
    },
  });
}

/**
 * Sends the list of currently-connected users to a newly-connected client.
 * So they immediately see who's online without waiting for heartbeats.
 */
function sendCurrentPresenceList(newClient: ClientState) {
  if (!newClient.boardId) return;

  const clients = boardClients.get(newClient.boardId);
  if (!clients) return;

  const presenceList: Array<{
    userId: string;
    cursor: { x: number; y: number } | null;
    status: string;
    connectionId: string;
  }> = [];

  for (const c of clients) {
    if (c === newClient) continue; // skip self
    if (!c.userId) continue;
    presenceList.push({
      userId: c.userId,
      cursor: c.presenceCursor ?? null,
      status: c.presenceStatus,
      connectionId: c.connectionId,
    });
  }

  if (presenceList.length > 0) {
    send(newClient, {
      type: "PRESENCE_LIST",
      payload: { users: presenceList, timestamp: Date.now() },
    });
  }
}

// ============================================================================
// Unsubscribe
// ============================================================================

function unsubscribeClient(client: ClientState) {
  if (!client.boardId) return;

  const set = boardClients.get(client.boardId);
  if (set) {
    set.delete(client);
    if (set.size === 0) {
      boardClients.delete(client.boardId);
    }
  }

  client.boardId = null;
}

// ============================================================================
// Redis pub/sub — subscribe to board channels
// ============================================================================

const subscribedChannels = new Set<string>();

function ensureRedisSubscription(boardId: string) {
  const eventsChannel   = `board:${boardId}:events`;
  const presenceChannel = `board:${boardId}:presence`;

  if (!subscribedChannels.has(eventsChannel)) {
    subscribedChannels.add(eventsChannel);
    redisSub.subscribe(eventsChannel);
  }

  if (!subscribedChannels.has(presenceChannel)) {
    subscribedChannels.add(presenceChannel);
    redisSub.subscribe(presenceChannel);
  }
}

redisSub.on("message", (channel, message) => {
  const parts = channel.split(":");
  const boardId = parts[1];
  const channelType = parts[2]; // "events" or "presence"
  if (!boardId) return;

  const clients = boardClients.get(boardId);
  if (!clients || clients.size === 0) return;

  try {
    if (channelType === "events") {
      // Domain event from outbox-worker
      const event: OutboxPayload = JSON.parse(message);

      for (const client of clients) {
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

        client.lastSequence = String(event.sequence);
      }
    } else if (channelType === "presence") {
      // Presence update from tRPC presence router (server-side presence heartbeat)
      const presenceData = JSON.parse(message);

      // Broadcast to all clients on this board (including the one that sent it,
      // so multi-tab of the same user stays in sync)
      for (const client of clients) {
        send(client, {
          type: "PRESENCE_UPDATE",
          payload: presenceData,
        });
      }
    }
  } catch (err) {
    console.error("[WS] Failed to parse Redis message", err);
  }
});

// ============================================================================
// Broadcast helper — sends to all clients on a board EXCEPT the sender
// ============================================================================

function broadcastToBoard(
  boardId: string,
  sender: ClientState,
  payload: Record<string, unknown>,
) {
  const clients = boardClients.get(boardId);
  if (!clients) return;

  const message = JSON.stringify(payload);

  for (const client of clients) {
    if (client === sender) continue;
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  }
}

// ============================================================================
// Heartbeat — detect stale connections + expired presence
// ============================================================================

const heartbeatInterval = setInterval(() => {
  const now = Date.now();

  for (const [, clients] of boardClients) {
    for (const client of clients) {
      // Stale WS connection — no pong received
      if (now - client.lastPong > STALE_CHECK_MS) {
        console.log(`[WS] Terminating stale client ${client.connectionId}`);
        broadcastPresenceLeave(client);
        client.ws.terminate();
        unsubscribeClient(client);
        continue;
      }

      // Expired presence — no presence heartbeat received
      if (client.userId && now - client.lastPresenceAt > PRESENCE_TTL_MS) {
        if (client.presenceStatus !== "IDLE") {
          client.presenceStatus = "IDLE";
          broadcastToBoard(client.boardId!, client, {
            type: "PRESENCE_UPDATE",
            payload: {
              userId: client.userId,
              status: "IDLE",
              cursor: null,
              connectionId: client.connectionId,
              timestamp: now,
            },
          });
        }
      }

      // Send WS-level ping
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
  sql?.end();
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
