export type PromptTierClassification =
  | 'TIER_1_FRONTEND_ONLY'
  | 'TIER_2_STRUCTURED_APP'
  | 'TIER_3_FULLSTACK';

export interface PromptTierClassifierResult {
  tier: PromptTierClassification;
  reasons: string[];
}

const TIER3_TERMS: RegExp[] = [
  /\bauth\b/i,
  /\blogin\b/i,
  /\bsign[\s-]?up\b/i,
  /\bpermission(s)?\b/i,
  /\brole(s)?\b/i,
  /\bdatabase\b/i,
  /\bpostgres\b/i,
  /\bmysql\b/i,
  /\bmongo(db)?\b/i,
  /\bprisma\b/i,
  /\bmigration(s)?\b/i,
  /\bbackend\b/i,
  /\bapi\b/i,
  /\bendpoint(s)?\b/i,
  /\bfull[\s-]?stack\b/i,
  /\bpayment(s)?\b/i,
  /\bstripe\b/i,
  /\bintegration(s)?\b/i,
  /\bpersist(ent|ence|ed)\b/i,
  /\bcrud\b.*\b(db|database|api|backend)\b/i,
];

const TIER1_TERMS: RegExp[] = [
  /\blanding page\b/i,
  /\bpricing page\b/i,
  /\bmarketing\b/i,
  /\bwaitlist\b/i,
  /\bportfolio\b/i,
  /\bdocs?\b/i,
  /\bhelp page\b/i,
  /\bsimple dashboard\b/i,
  /\bmock data\b/i,
  /\bhero\b/i,
  /\bcta\b/i,
];

const TIER2_TERMS: RegExp[] = [
  /\bmulti[\s-]?page\b/i,
  /\bcrud\b/i,
  /\badmin dashboard\b/i,
  /\bmulti[\s-]?step form(s)?\b/i,
  /\bcomplex form(s)?\b/i,
  /\bform validation\b/i,
  /\bcomplex state\b/i,
  /\bcrm\b/i,
  /\binventory\b/i,
  /\bproject management\b/i,
];

export function classifyPromptTier(prompts: string[]): PromptTierClassifierResult {
  const text = prompts.join('\n').trim();
  const reasons: string[] = [];

  const tier3Hits = TIER3_TERMS.filter((re) => re.test(text));
  if (tier3Hits.length > 0) {
    reasons.push(`tier3-signals=${tier3Hits.length}`);
    return { tier: 'TIER_3_FULLSTACK', reasons };
  }

  const tier1Hits = TIER1_TERMS.filter((re) => re.test(text));
  const tier2Hits = TIER2_TERMS.filter((re) => re.test(text));

  if (tier1Hits.length > 0 && tier2Hits.length === 0) {
    reasons.push(`tier1-signals=${tier1Hits.length}`);
    return { tier: 'TIER_1_FRONTEND_ONLY', reasons };
  }

  if (tier2Hits.length > 0) {
    reasons.push(`tier2-signals=${tier2Hits.length}`);
    return { tier: 'TIER_2_STRUCTURED_APP', reasons };
  }

  // Conservative fallback: non-backend simple UI prompts default to tier1.
  reasons.push('default-tier1');
  return { tier: 'TIER_1_FRONTEND_ONLY', reasons };
}
