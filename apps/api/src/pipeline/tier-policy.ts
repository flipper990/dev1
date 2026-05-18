import type { PromptTierClassification } from './prompt-tier-classifier.js';
import {
  classifyTier1RuntimeExclusion,
  isAllowedTier1RuntimePath,
  normalizeArtifactPath,
} from './test-artifact-policy.js';

const TIER2_FORBIDDEN_RE =
  /^(?:apps\/api\/|server\/|routes\/|db\/|migrations\/|src\/server\/|src\/routes\/|src\/db\/|src\/migrations\/)/i;

const TIER2_ALLOWED_RE =
  /^(?:package\.json|package-lock\.json|tsconfig\.json|next\.config\.(?:js|mjs|ts)|postcss\.config\.(?:js|mjs|cjs)|tailwind\.config\.(?:js|ts)|next-env\.d\.ts|src\/app\/.+|src\/components\/.+|src\/lib\/.+|src\/hooks\/.+|src\/styles\/.+|public\/.+)$/i;

export const TIER3_REQUIRED_CONTRACT_PATHS = [
  'src/contracts/api-contract.ts',
  'src/contracts/data-model-contract.ts',
  'src/contracts/route-contract.ts',
  'src/contracts/boundary-contract.ts',
] as const;

export function isAllowedPathForTier(tier: PromptTierClassification, path: string): boolean {
  const normalized = normalizeArtifactPath(path);
  if (!normalized) return false;

  if (tier === 'TIER_1_FRONTEND_ONLY') {
    return isAllowedTier1RuntimePath(normalized);
  }

  if (tier === 'TIER_2_STRUCTURED_APP') {
    if (classifyTier1RuntimeExclusion(normalized) === 'generated-test-artifact') return false;
    if (TIER2_FORBIDDEN_RE.test(normalized)) return false;
    return TIER2_ALLOWED_RE.test(normalized);
  }

  return true;
}

export function validateTierPolicyFileScope(
  tier: PromptTierClassification,
  files: Array<{ path: string }>,
): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  for (const file of files) {
    if (!isAllowedPathForTier(tier, file.path)) {
      violations.push(`${tier} disallows path: ${normalizeArtifactPath(file.path)}`);
    }
  }
  return { ok: violations.length === 0, violations };
}

export function validateTier3RequiredContracts(
  files: Array<{ path: string }>,
): { ok: boolean; missing: string[] } {
  const set = new Set(files.map((f) => normalizeArtifactPath(f.path)));
  const missing = TIER3_REQUIRED_CONTRACT_PATHS.filter((p) => !set.has(p));
  return { ok: missing.length === 0, missing: [...missing] };
}
