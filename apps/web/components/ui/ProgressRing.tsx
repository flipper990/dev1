/**
 * Circular progress ring used for production-level diagnostics.
 * `value` is a 0..1 fraction.
 */
export function ProgressRing({
  value,
  level,
  size = 96,
  stroke = 6,
}: {
  value: number;
  level: number;
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * Math.max(0, Math.min(1, value));
  const id = `cn-ring-grad`;
  return (
    <div className="cn-ring" style={{ width: size, height: size }}>
      <svg className="cn-ring__svg" viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--color-brand-secondary)" />
            <stop offset="100%" stopColor="var(--color-brand-primary)" />
          </linearGradient>
        </defs>
        <circle className="cn-ring__bg" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        <circle
          className="cn-ring__fg"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
        />
      </svg>
      <div className="cn-ring__label">
        <div className="flex flex-col items-center leading-none">
          <span className="text-[10px] uppercase tracking-[0.18em] text-text-muted">Lv</span>
          <span className="cn-ring__label-num">{level}</span>
        </div>
      </div>
    </div>
  );
}
