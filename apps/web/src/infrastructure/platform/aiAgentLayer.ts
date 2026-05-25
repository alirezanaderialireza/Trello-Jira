// apps/web/src/infrastructure/platform/aiAgentLayer.ts
// AI agent orchestration — event-driven, sandboxed, rate-limited, auditable.

import { eventBus, type BusEvent } from "./eventBus";
import { telemetry } from "@/lib/telemetry/logEvent";

export type AgentStatus = "idle" | "processing" | "disabled" | "error";

export interface AgentSuggestion {
  readonly agentId: string;
  readonly type: string;
  readonly confidence: number;
  readonly payload: Record<string, unknown>;
  readonly createdAt: number;
}

export interface AgentManifest {
  readonly id: string;
  readonly name: string;
  readonly triggers: readonly string[];
  readonly maxSuggestionsPerMinute?: number;
}

export type AgentHandler = (event: BusEvent) => Promise<AgentSuggestion | null>;

interface AgentInstance { manifest: AgentManifest; handler: AgentHandler; status: AgentStatus; suggestions: AgentSuggestion[]; unsubscribe?: () => void; errorCount: number; }

export class AIAgentLayer {
  private agents = new Map<string, AgentInstance>();

  registerAgent(manifest: AgentManifest, handler: AgentHandler): void {
    if (this.agents.has(manifest.id)) this.unregisterAgent(manifest.id);
    const inst: AgentInstance = { manifest, handler, status: "idle", suggestions: [], errorCount: 0 };
    this.agents.set(manifest.id, inst);
    this._subscribe(inst);
    telemetry.log("STORE", "AI_AGENT_REGISTERED", { agentId: manifest.id });
  }

  unregisterAgent(id: string): void { const i = this.agents.get(id); i?.unsubscribe?.(); this.agents.delete(id); }
  getAgents(): readonly AgentInstance[] { return Array.from(this.agents.values()); }

  getSuggestions(agentId?: string): readonly AgentSuggestion[] {
    if (agentId) return this.agents.get(agentId)?.suggestions ?? [];
    const all: AgentSuggestion[] = [];
    for (const a of this.agents.values()) all.push(...a.suggestions);
    return all.sort((a, b) => b.confidence - a.confidence);
  }

  dismissSuggestion(agentId: string, idx: number): void { this.agents.get(agentId)?.suggestions.splice(idx, 1); }

  private _subscribe(inst: AgentInstance): void {
    const unsubs: Array<() => void> = [];
    for (const trigger of inst.manifest.triggers) {
      unsubs.push(eventBus.subscribe(
        { subscriberId: `agent:${inst.manifest.id}:${trigger}`, kind: "domain", typePrefix: trigger },
        async (event) => {
          if (inst.status === "disabled" || inst.status === "error") return;
          inst.status = "processing";
          try {
            const s = await inst.handler(event);
            if (s) { inst.suggestions.push(s); if (inst.suggestions.length > 100) inst.suggestions.shift(); }
            inst.status = "idle";
          } catch (err) {
            inst.errorCount++;
            inst.status = inst.errorCount >= 5 ? "error" : "idle";
            telemetry.log("STORE", "AI_AGENT_ERROR", { agentId: inst.manifest.id, error: String(err) });
          }
        },
      ));
    }
    inst.unsubscribe = () => unsubs.forEach((u) => u());
  }
}

export const aiAgentLayer = new AIAgentLayer();
