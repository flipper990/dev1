export type StatusTone = 'neutral' | 'info' | 'active' | 'success' | 'warning' | 'error';

export type ProductStatusKey =
  | 'idle'
  | 'generating'
  | 'build-complete'
  | 'preview-starting'
  | 'preview-ready'
  | 'preview-failed'
  | 'stale'
  | 'verification-pending'
  | 'launch-ready';

export interface StatusPresentation {
  key: ProductStatusKey;
  label: string;
  tone: StatusTone;
  description: string;
}

export const statusPresentation: Record<ProductStatusKey, StatusPresentation> = {
  idle: {
    key: 'idle',
    label: 'Idle',
    tone: 'neutral',
    description: 'No active build is running.',
  },
  generating: {
    key: 'generating',
    label: 'Generating',
    tone: 'active',
    description: 'Build generation is currently running.',
  },
  'build-complete': {
    key: 'build-complete',
    label: 'Build complete',
    tone: 'success',
    description: 'Build artifacts are complete.',
  },
  'preview-starting': {
    key: 'preview-starting',
    label: 'Preview starting',
    tone: 'active',
    description: 'Preview runtime is starting.',
  },
  'preview-ready': {
    key: 'preview-ready',
    label: 'Preview ready',
    tone: 'success',
    description: 'Preview runtime is healthy.',
  },
  'preview-failed': {
    key: 'preview-failed',
    label: 'Preview failed',
    tone: 'error',
    description: 'Preview runtime failed to start.',
  },
  stale: {
    key: 'stale',
    label: 'Out of sync',
    tone: 'warning',
    description: 'Data is stale or out of sync.',
  },
  'verification-pending': {
    key: 'verification-pending',
    label: 'Verification pending',
    tone: 'warning',
    description: 'Verification checks still need review.',
  },
  'launch-ready': {
    key: 'launch-ready',
    label: 'Launch ready',
    tone: 'success',
    description: 'Project is ready to launch.',
  },
};

