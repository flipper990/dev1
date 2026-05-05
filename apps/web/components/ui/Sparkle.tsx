import type { SVGProps } from 'react';

/**
 * 4-point sparkle motif used throughout the dashboard.
 * Inherits color via `currentColor` so it works on any surface.
 */
export function Sparkle({
  size = 14,
  ...rest
}: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      {...rest}
    >
      <path d="M12 1.5l1.78 7.05a3.5 3.5 0 0 0 2.67 2.6L23.5 13l-7.05 1.85a3.5 3.5 0 0 0-2.67 2.6L12 24.5l-1.78-7.05a3.5 3.5 0 0 0-2.67-2.6L0.5 13l7.05-1.85a3.5 3.5 0 0 0 2.67-2.6L12 1.5z" />
    </svg>
  );
}
