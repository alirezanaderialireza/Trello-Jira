// apps/web/src/infrastructure/platform/pluginEngine.ts
// Plugin registration, event subscriptions, sandboxed execution.

import { eventBus, type BusEvent, type BusSubscriber } from "./eventBus";
import { telemetry } from "@/lib/telemetry/logEvent";

export type PluginStatus = "registered" | "active" | "disabled" | "error";

export interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly author?: string;
  readonly subscriptions: readonly string[];
  readonly permissions: readonly string[];
}

export interface PluginInstance {
  readonly manifest: PluginManifest;
  status: PluginStatus;
  readonly handler: BusSubscriber;
  unsubscribe?: () => void;
  errorCount: number;
  lastError?: string;
}

export class PluginEngine {
  private plugins = new Map<string, PluginInstance>();
  private readonly MAX_ERRORS = 5;

  register(manifest: PluginManifest, handler: BusSubscriber): void {
    if (this.plugins.has(manifest.id)) this.unregister(manifest.id);
    this.plugins.set(manifest.id, { manifest, status: "registered", handler, errorCount: 0 });
    telemetry.log("STORE", "PLUGIN_REGISTERED", { pluginId: manifest.id, name: manifest.name });
  }

  activate(pluginId: string): void {
    const inst = this.plugins.get(pluginId);
    if (!inst || inst.status === "active") return;
    const unsubs: Array<() => void> = [];
    for (const prefix of inst.manifest.subscriptions) {
      const unsub = eventBus.subscribe(
        { subscriberId: `plugin:${pluginId}:${prefix}`, typePrefix: prefix },
        (event) => { try { const r = inst.handler(event); if (r instanceof Promise) r.catch((e) => this._onError(inst, e)); } catch (e) { this._onError(inst, e); } },
      );
      unsubs.push(unsub);
    }
    inst.status = "active";
    inst.unsubscribe = () => unsubs.forEach((u) => u());
    telemetry.log("STORE", "PLUGIN_ACTIVATED", { pluginId });
  }

  disable(pluginId: string): void {
    const inst = this.plugins.get(pluginId);
    if (!inst) return;
    inst.unsubscribe?.();
    inst.status = "disabled";
  }

  unregister(pluginId: string): void {
    const inst = this.plugins.get(pluginId);
    if (!inst) return;
    inst.unsubscribe?.();
    this.plugins.delete(pluginId);
  }

  getPlugins(): readonly PluginInstance[] { return Array.from(this.plugins.values()); }
  getStatus(pluginId: string): PluginStatus | null { return this.plugins.get(pluginId)?.status ?? null; }

  private _onError(inst: PluginInstance, err: unknown): void {
    inst.errorCount++;
    inst.lastError = String(err);
    if (inst.errorCount >= this.MAX_ERRORS) { this.disable(inst.manifest.id); inst.status = "error"; }
    telemetry.log("STORE", "PLUGIN_ERROR", { pluginId: inst.manifest.id, error: inst.lastError, errorCount: inst.errorCount });
  }
}

export const pluginEngine = new PluginEngine();
