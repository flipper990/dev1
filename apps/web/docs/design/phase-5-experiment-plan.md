# Phase 5 Experiment Plan

## Experiment 1: Theme default
- Variants: `light-first` vs `dark-first`
- Primary metric: project creation rate
- Guardrail: LCP/INP regressions and JS error rate

## Experiment 2: Status presentation
- Variants: `unified-summary` vs `legacy-badge-row`
- Primary metric: contradictory status rate (lower is better)
- Guardrail: support tickets for confusion

## Experiment 3: Command surface
- Variants: `command-dock` vs `legacy-prompt-composer`
- Primary metric: command submission rate and time to next meaningful state
- Guardrail: preview retry spikes

## Experiment 4: Activity presentation
- Variants: `production-timeline` vs `legacy-agent-feed`
- Primary metric: project reopen rate and activity exploration depth
- Guardrail: a11y violation rate and JS errors

## Launch readiness rules
- No experiment launches without primary + guardrail metrics.
- Experiments are disabled by flag if regressions are detected.
- Variant exposure tracked via `ui_variant_exposed`.
