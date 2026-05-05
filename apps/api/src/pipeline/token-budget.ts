// ─────────────────────────────────────────────────────────────
// Token Budget — per-project token allocation, estimation, and
// per-call cap derivation. Used by the BuilderAgent's phased mode
// to keep total spend bounded (~$50 default) while preventing any
// single LLM call from exceeding the model's safe output cap.
//
// Allocation (default share of total tokens):
//   pages       25%
//   backend     25%
//   components  20%
//   config      10%
//   polish      20%   (also used for QA-rebuild loops)
// ─────────────────────────────────────────────────────────────

export type BudgetPhase = 'skeleton' | 'pages' | 'backend' | 'components' | 'config' | 'polish';

export interface PhaseAllocation {
  /** Tokens allocated to this phase (input + output combined). */
  budget: number;
  /** Tokens consumed so far. */
  used: number;
}

export interface TokenBudgetOptions {
  /**
   * Total tokens (input + output) allowed for the whole phased build.
   * Default 800,000 ≈ ~$50 at gpt-4o blended pricing
   * (input $2.50 / 1M, output $10 / 1M).
   */
  totalTokens?: number;
  /**
   * The largest output (`maxTokens`) any single LLM call is allowed to
   * request. Most providers cap completions at 16 384 tokens; some
   * deployments allow 32 768. Defaults to 16 384.
   */
  perCallOutputCap?: number;
  /**
   * Reserved headroom inside `perCallOutputCap` so the salvager has
   * margin if the model talks slightly past its target. Default 1024.
   */
  perCallHeadroom?: number;
}

/** Default phase shares — must sum to 1.0. */
const DEFAULT_ALLOCATION: Record<BudgetPhase, number> = {
  skeleton:   0.05,  // tiny — minimum runnable app, validated to boot
  pages:      0.25,
  backend:    0.25,
  components: 0.20,
  config:     0.10,
  polish:     0.15,  // shaved 5% to fund skeleton
};

const DEFAULT_TOTAL_TOKENS    = 800_000;
const DEFAULT_PER_CALL_CAP    = 16_384;
const DEFAULT_PER_CALL_HEAD   = 1_024;

/** Rough char→token estimate. 1 token ≈ 4 chars of English code/JSON. */
export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}

export function estimateTokensFromText(text: string): number {
  return estimateTokensFromChars(text.length);
}

export function estimateTokensFromFiles(files: ReadonlyArray<{ path: string; content: string }>): number {
  let total = 0;
  for (const f of files) total += estimateTokensFromChars(f.path.length + f.content.length + 8);
  return total;
}

export class TokenBudget {
  private readonly total: number;
  private readonly perCallCap: number;
  private readonly perCallHeadroom: number;
  private readonly phases: Map<BudgetPhase, PhaseAllocation>;
  private spent = 0;

  constructor(opts: TokenBudgetOptions = {}) {
    this.total           = opts.totalTokens     ?? DEFAULT_TOTAL_TOKENS;
    this.perCallCap      = opts.perCallOutputCap ?? DEFAULT_PER_CALL_CAP;
    this.perCallHeadroom = opts.perCallHeadroom  ?? DEFAULT_PER_CALL_HEAD;

    this.phases = new Map();
    for (const [phase, share] of Object.entries(DEFAULT_ALLOCATION) as [BudgetPhase, number][]) {
      this.phases.set(phase, { budget: Math.floor(this.total * share), used: 0 });
    }
  }

  /** Total tokens allocated for the entire build. */
  get totalBudget(): number { return this.total; }

  /** Tokens consumed across all phases so far. */
  get totalUsed(): number { return this.spent; }

  /** Remaining tokens across the entire build. */
  get totalRemaining(): number { return Math.max(0, this.total - this.spent); }

  /** Get the allocation for a phase. */
  getPhase(phase: BudgetPhase): PhaseAllocation {
    return this.phases.get(phase) ?? { budget: 0, used: 0 };
  }

  /** Tokens still available in this phase. */
  remaining(phase: BudgetPhase): number {
    const p = this.getPhase(phase);
    return Math.max(0, p.budget - p.used);
  }

  /**
   * Compute the safe per-call output cap for the next call in this phase:
   *   min(model maxTokens, perCallCap, phaseRemaining, totalRemaining) − headroom
   * Floor at 1 024 to keep the call viable.
   */
  perCallOutputLimit(phase: BudgetPhase, modelMaxTokens?: number): number {
    const phaseRemaining = this.remaining(phase);
    const cap = Math.min(
      modelMaxTokens ?? Number.POSITIVE_INFINITY,
      this.perCallCap,
      phaseRemaining > 0 ? phaseRemaining : this.perCallCap,
      this.totalRemaining > 0 ? this.totalRemaining : this.perCallCap,
    );
    return Math.max(1_024, cap - this.perCallHeadroom);
  }

  /**
   * Decide how many sub-batches a phase needs, given the estimated total
   * output for the phase. Returns 1 when one call suffices.
   */
  recommendBatchCount(phase: BudgetPhase, estimatedOutputTokens: number, modelMaxTokens?: number): number {
    const cap = this.perCallOutputLimit(phase, modelMaxTokens);
    if (estimatedOutputTokens <= cap) return 1;
    return Math.min(8, Math.max(2, Math.ceil(estimatedOutputTokens / cap)));
  }

  /** Record actual usage after an LLM call completes. */
  record(phase: BudgetPhase, tokensIn: number, tokensOut: number): void {
    const p = this.phases.get(phase);
    const total = (tokensIn || 0) + (tokensOut || 0);
    if (p) p.used += total;
    this.spent += total;
  }

  /** Has the project exhausted its overall budget? */
  isExhausted(): boolean {
    return this.spent >= this.total;
  }

  /**
   * Cost-pressure tier for cost-aware execution. As the project consumes
   * its budget, downstream phases should degrade gracefully rather than
   * push the project into overspend or truncation.
   *
   *   ok        — < 50% of total budget consumed; run all phases at full quality.
   *   warn      — 50–75%; reduce complexity, drop optional polish details.
   *   critical  — 75–95%; skip non-critical phases (components/polish refinement).
   *               Focus remaining tokens on functional correctness only.
   *   exhausted — ≥ 95% or any single phase has gone over budget; abort
   *               remaining phases entirely. Ship what already works.
   */
  pressureLevel(): 'ok' | 'warn' | 'critical' | 'exhausted' {
    const ratio = this.total > 0 ? this.spent / this.total : 0;
    if (ratio >= 0.95) return 'exhausted';
    if (ratio >= 0.75) return 'critical';
    if (ratio >= 0.50) return 'warn';
    // Also flag exhausted if any phase has overrun by 25% or more — that
    // signals the estimator is off and we should not commit further calls.
    for (const p of this.phases.values()) {
      if (p.budget > 0 && p.used / p.budget >= 1.25) return 'critical';
    }
    return 'ok';
  }

  /**
   * Whether a given phase should run at all given the current pressure.
   * Returns `{ run: false, reason }` when the phase should be skipped, or
   * `{ run: true, degraded }` when it should run, possibly in degraded mode.
   *
   * Priority order (highest first):
   *   skeleton  — ALWAYS runs. Without it there is no app.
   *   pages     — ALWAYS runs. Core feature coverage.
   *   backend   — ALWAYS runs unless exhausted. Core data plumbing.
   *   config    — ALWAYS runs unless exhausted. Required for `npm run dev`.
   *   components — Skipped at `critical`. Pages already inline native JSX.
   *   polish    — Skipped at `warn` or worse. Purely cosmetic refinements.
   */
  shouldRunPhase(phase: BudgetPhase): { run: boolean; reason?: string; degraded: boolean } {
    const level = this.pressureLevel();

    if (phase === 'skeleton' || phase === 'pages') {
      return { run: true, degraded: level === 'critical' || level === 'exhausted' };
    }

    if (level === 'exhausted') {
      return { run: false, degraded: false, reason: `total budget exhausted (${this.spent}/${this.total} tokens)` };
    }

    if (phase === 'polish') {
      // Polish is the first thing to drop under any meaningful pressure.
      if (level === 'warn' || level === 'critical') {
        return { run: false, degraded: false, reason: `polish skipped under ${level} pressure — functional output already shipped` };
      }
    }

    if (phase === 'components') {
      // Components extracts shared UI. Pages remain functional without it.
      if (level === 'critical') {
        return { run: false, degraded: false, reason: `components skipped under critical pressure — pages already use inline JSX` };
      }
      if (level === 'warn') {
        return { run: true, degraded: true };
      }
    }

    if (phase === 'backend' && level === 'critical') {
      // Backend still runs but in degraded mode — only the critical routes.
      return { run: true, degraded: true };
    }

    return { run: true, degraded: false };
  }

  /** Snapshot for logging / persisting on the project. */
  snapshot(): {
    totalTokens: number;
    totalUsed: number;
    totalRemaining: number;
    phases: Record<BudgetPhase, PhaseAllocation>;
  } {
    const phases = {} as Record<BudgetPhase, PhaseAllocation>;
    for (const [k, v] of this.phases.entries()) phases[k] = { budget: v.budget, used: v.used };
    return {
      totalTokens: this.total,
      totalUsed: this.spent,
      totalRemaining: this.totalRemaining,
      phases,
    };
  }
}
