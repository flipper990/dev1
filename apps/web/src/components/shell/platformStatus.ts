import type { BadgeVariant } from '../../../components/ui';

export type PlatformHealthState = 'checking' | 'online' | 'reachable-degraded' | 'offline';

interface PlatformHealthBadge {
  label: string;
  variant: BadgeVariant;
  title: string;
}

export function platformHealthToBadge(state: PlatformHealthState): PlatformHealthBadge {
  if (state === 'online') {
    return {
      label: 'API online',
      variant: 'success',
      title: 'Core backend API is reachable. Page-level feature availability is shown separately.',
    };
  }

  if (state === 'reachable-degraded') {
    return {
      label: 'Backend reachable',
      variant: 'warning',
      title: 'Backend responded, but at least one core API request returned an error. Check page-level availability details.',
    };
  }

  if (state === 'offline') {
    return {
      label: 'Backend offline',
      variant: 'error',
      title: 'Core backend API is unreachable. Page-level actions may be unavailable.',
    };
  }

  return {
    label: 'Checking API',
    variant: 'neutral',
    title: 'Checking core backend API reachability.',
  };
}
