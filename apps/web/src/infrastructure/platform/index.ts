// apps/web/src/infrastructure/platform/index.ts
// Barrel export for the Platform layer (Phase 9).

export { eventBus, PlatformEventBus } from "./eventBus";
export type { BusEvent, BusEventKind, BusSubscriber, SubscriptionOptions } from "./eventBus";

export { pluginEngine, PluginEngine } from "./pluginEngine";
export type { PluginManifest, PluginInstance, PluginStatus } from "./pluginEngine";

export { automationEngine, AutomationEngine } from "./automationEngine";
export type { AutomationRule, TriggerCondition, AutomationAction } from "./automationEngine";

export { aiAgentLayer, AIAgentLayer } from "./aiAgentLayer";
export type { AgentManifest, AgentSuggestion, AgentHandler, AgentStatus } from "./aiAgentLayer";

export { crdtEngine, CrdtEngine } from "./crdtEngine";
export type { CrdtChar, CrdtDocument, CrdtOp } from "./crdtEngine";

export { OfflineSyncManager } from "./offlineSync";
export type { OfflineSnapshot, PendingOfflineOp, OfflineStorage } from "./offlineSync";

export { multiTenantManager, MultiTenantManager } from "./multiTenantManager";
export type { TenantContext } from "./multiTenantManager";
