/** Single labeled gold progress bar for the Agent Progression card. */
export function SkillBar({
  label,
  value,
}: {
  label: string;
  value: number; // 0..1
}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="cn-skill">
      <span className="cn-skill__label">{label}</span>
      <span className="cn-skill__track">
        <span className="cn-skill__fill block" style={{ width: `${pct}%` }} />
      </span>
      <span className="cn-skill__pct">{pct}%</span>
    </div>
  );
}
