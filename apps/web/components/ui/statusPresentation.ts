import {
  statusPresentation,
  type ProductStatusKey,
  type StatusTone as ProductStatusTone,
} from '../../src/design/tokens';

export type { ProductStatusKey };

export type BadgeTone = 'neutral' | 'info' | 'active' | 'success' | 'warning' | 'error';
export type DotTone = 'neutral' | 'info' | 'active' | 'success' | 'warning' | 'error';

export function getStatusPresentation(key: ProductStatusKey) {
  return statusPresentation[key];
}

export function mapProductToneToBadgeTone(tone: ProductStatusTone): BadgeTone {
  if (tone === 'active') return 'active';
  return tone;
}

export function mapProductToneToDotTone(tone: ProductStatusTone): DotTone {
  if (tone === 'active') return 'active';
  return tone;
}
