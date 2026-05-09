export type TelemetryEventName =
  | 'ui_variant_exposed'
  | 'shell_loaded'
  | 'project_opened'
  | 'workspace_status_viewed'
  | 'preview_opened'
  | 'preview_retry_clicked'
  | 'build_timeline_opened'
  | 'command_submitted'
  | 'empty_state_action_clicked'
  | 'keyboard_navigation_detected';

export interface TelemetryEventBase {
  route?: string;
  theme?: 'light' | 'dark';
  variant?: string;
  project_stage?: 'decide' | 'build' | 'verify' | 'launch';
  preview_state?: 'idle' | 'starting' | 'ready' | 'failed' | 'stale';
  health_state?: 'healthy' | 'degraded' | 'failed' | 'unknown';
  action_source?: string;
  retry_count?: number;
  lcp_ms?: number;
  inp_ms?: number;
  cls?: number;
}

export type TelemetryEventPayloadMap = {
  ui_variant_exposed: TelemetryEventBase;
  shell_loaded: TelemetryEventBase;
  project_opened: TelemetryEventBase & { project_stage: 'decide' | 'build' | 'verify' | 'launch' };
  workspace_status_viewed: TelemetryEventBase & { project_stage: 'decide' | 'build' | 'verify' | 'launch' };
  preview_opened: TelemetryEventBase & { preview_state: 'idle' | 'starting' | 'ready' | 'failed' | 'stale' };
  preview_retry_clicked: TelemetryEventBase & { retry_count: number };
  build_timeline_opened: TelemetryEventBase;
  command_submitted: TelemetryEventBase & { action_source: string };
  empty_state_action_clicked: TelemetryEventBase & { action_source: string };
  keyboard_navigation_detected: TelemetryEventBase & { action_source: string };
};

export type TelemetryEvent<K extends TelemetryEventName = TelemetryEventName> = {
  name: K;
  ts: string;
  payload: TelemetryEventPayloadMap[K];
};

export const TELEMETRY_ENDPOINT = '/api/telemetry/events';

export function buildTelemetryEvent<K extends TelemetryEventName>(
  name: K,
  payload: TelemetryEventPayloadMap[K],
): TelemetryEvent<K> {
  return {
    name,
    ts: new Date().toISOString(),
    payload,
  };
}

export function sanitizeTelemetryPayload(payload: TelemetryEventBase): TelemetryEventBase {
  const next: TelemetryEventBase = {};

  const keys = Object.keys(payload) as Array<keyof TelemetryEventBase>;
  for (const key of keys) {
    const value = payload[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    next[key] = value;
  }

  return next;
}
