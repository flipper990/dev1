# Multi-Tier Canary Results

## Run constraints
- Capped prompts run: 6 total
- Tier distribution executed: Tier1=3, Tier2=2, Tier3=1
- No extra prompts beyond cap

## Result
- total: 6
- succeeded: 6
- failed: 0
- successRate: 100%
- averageCompletionMs: 59115
- retryFrequency: 0
- previewStartupSuccess: 100%
- exportSuccessRate: 100%

## Prompt outcomes
1. Tier1 landing page -> pass
2. Tier1 dashboard (mock) -> pass
3. Tier1 pricing page -> pass
4. Tier2 CRUD app -> pass
5. Tier2 admin dashboard forms/state -> pass
6. Tier3 fullstack SaaS contract-first -> pass

## Artifact source
- JSON source of truth: `reports/current/multi-tier-canary-results.json`