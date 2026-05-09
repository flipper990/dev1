export interface UiRedesignFlags {
  ui_redesign_foundations: boolean;
  ui_redesign_shell: boolean;
  ui_redesign_workspace: boolean;
  ui_redesign_status_system: boolean;
  ui_redesign_dark_mode: boolean;
}

export type ExperimentAssignment = {
  light_default_variant: 'light-first' | 'dark-first';
  status_summary_variant: 'unified-summary' | 'legacy-badge-row';
  command_dock_variant: 'command-dock' | 'legacy-prompt-composer';
  activity_timeline_variant: 'production-timeline' | 'legacy-agent-feed';
};

const DEFAULT_FLAGS: UiRedesignFlags = {
  ui_redesign_foundations: true,
  ui_redesign_shell: true,
  ui_redesign_workspace: true,
  ui_redesign_status_system: true,
  ui_redesign_dark_mode: true,
};

const DEFAULT_EXPERIMENTS: ExperimentAssignment = {
  light_default_variant: 'light-first',
  status_summary_variant: 'unified-summary',
  command_dock_variant: 'command-dock',
  activity_timeline_variant: 'production-timeline',
};

function parseBoolean(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  if (value === '1' || value.toLowerCase() === 'true') return true;
  if (value === '0' || value.toLowerCase() === 'false') return false;
  return undefined;
}

export function getUiRedesignFlags(): UiRedesignFlags {
  if (typeof window === 'undefined') return DEFAULT_FLAGS;

  const params = new URLSearchParams(window.location.search);
  const next: UiRedesignFlags = { ...DEFAULT_FLAGS };

  (Object.keys(DEFAULT_FLAGS) as Array<keyof UiRedesignFlags>).forEach((key) => {
    const queryOverride = parseBoolean(params.get(key));
    const storageOverride = parseBoolean(window.localStorage.getItem(`flag:${key}`));

    if (queryOverride !== undefined) {
      next[key] = queryOverride;
      return;
    }

    if (storageOverride !== undefined) {
      next[key] = storageOverride;
    }
  });

  return next;
}

export function getExperimentAssignments(): ExperimentAssignment {
  if (typeof window === 'undefined') return DEFAULT_EXPERIMENTS;

  const params = new URLSearchParams(window.location.search);
  const next: ExperimentAssignment = { ...DEFAULT_EXPERIMENTS };

  const light = params.get('exp_light_default_variant') ?? window.localStorage.getItem('exp:light_default_variant');
  if (light === 'light-first' || light === 'dark-first') next.light_default_variant = light;

  const status = params.get('exp_status_summary_variant') ?? window.localStorage.getItem('exp:status_summary_variant');
  if (status === 'unified-summary' || status === 'legacy-badge-row') next.status_summary_variant = status;

  const dock = params.get('exp_command_dock_variant') ?? window.localStorage.getItem('exp:command_dock_variant');
  if (dock === 'command-dock' || dock === 'legacy-prompt-composer') next.command_dock_variant = dock;

  const timeline = params.get('exp_activity_timeline_variant') ?? window.localStorage.getItem('exp:activity_timeline_variant');
  if (timeline === 'production-timeline' || timeline === 'legacy-agent-feed') next.activity_timeline_variant = timeline;

  return next;
}

export function isFlagEnabled(flag: keyof UiRedesignFlags): boolean {
  return getUiRedesignFlags()[flag];
}
