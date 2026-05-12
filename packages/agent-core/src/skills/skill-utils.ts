import type { SkillSelectionContext } from './types';

export function hasObjectKeys(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && Object.keys(value as Record<string, unknown>).length > 0);
}

export function hasApiContracts(ctx: SkillSelectionContext): boolean {
  const contracts = ctx.spec?.apiContracts;
  return (Array.isArray(contracts) && contracts.length > 0) ||
    Boolean(ctx.currentSlice?.apiIds?.length) ||
    Boolean(ctx.currentSlice?.dbTables?.length);
}

export function hasDependencySignals(ctx: SkillSelectionContext): boolean {
  const phase = String(ctx.phase ?? '').toLowerCase();
  if (phase === 'config' || phase === 'polish') return true;
  const feedback = JSON.stringify(ctx.qaFeedback ?? ctx.runtimeFeedback ?? {}).toLowerCase();
  if (/\b(dependency|dependencies|package\.json|module not found|cannot find module|eresolve|peer dep|npm install|missing import|import)\b/.test(feedback)) {
    return true;
  }
  return (ctx.files ?? []).some((f) =>
    /(^|\/)package\.json$/i.test(f.path) ||
    /\bfrom\s+['"][^.'"/][^'"]*['"]/.test(f.content ?? '') ||
    /\bimport\s*\([^)]*['"][^.'"/][^'"]*['"]/.test(f.content ?? ''),
  );
}

export function hasPreviewSignals(ctx: SkillSelectionContext): boolean {
  if (hasObjectKeys(ctx.runtimeFeedback)) return true;
  const serialized = JSON.stringify(ctx.qaFeedback ?? {}).toLowerCase();
  return /\b(preview|runtime|container|docker|health|http probe|blank page|dev server)\b/.test(serialized);
}

export function hasTestGapSignals(ctx: SkillSelectionContext): boolean {
  const files = ctx.files ?? [];
  const sourceCount = files.filter((f) => /\.(tsx?|jsx?)$/i.test(f.path) && !isTestPath(f.path)).length;
  if (sourceCount === 0) return false;
  const testCount = files.filter((f) => isTestPath(f.path)).length;
  return testCount === 0 || testCount < Math.ceil(sourceCount / 8);
}

export function hasExportReadinessSignals(ctx: SkillSelectionContext): boolean {
  const files = ctx.files ?? [];
  if (files.length === 0) return false;
  return files.some((f) =>
    /(^|\/)(package\.json|README\.md|Dockerfile|docker-compose\.ya?ml|\.env\.example|next\.config|vite\.config|tsconfig\.json)$/i.test(f.path),
  ) || files.length >= 5;
}

export function hasBudgetSignals(ctx: SkillSelectionContext): boolean {
  return Boolean(ctx.budget?.enabled && typeof ctx.budget.percentUsed === 'number' && ctx.budget.percentUsed >= 0.5);
}

function isTestPath(path: string): boolean {
  return /(^|\/)(__tests__|tests?)\//i.test(path) ||
    /\.(test|spec)\.(tsx?|jsx?)$/i.test(path);
}
