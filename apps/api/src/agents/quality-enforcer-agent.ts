// ─────────────────────────────────────────────────────────────
// Quality Enforcement Agent — final quality gate
// Evaluates merged codebase against the expanded spec and
// emits patches when any dimension falls below the bar.
// ─────────────────────────────────────────────────────────────

import { BaseAgent } from '../../../../packages/agent-core/src/base-agent.js';
import type { Task, MemoryEntry } from '../../../../packages/agent-core/src/types.js';
import { extractJSON } from './utils.js';

const VALID_DIMENSIONS = new Set(['uiQuality', 'functionalQuality', 'codeQuality', 'consistency']);
const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const VALID_VERDICTS = new Set(['pass', 'needs-improvement']);
const PASS_THRESHOLD = 80;

export class QualityEnforcerAgent extends BaseAgent {
  protected async buildPrompt(task: Task, memories: MemoryEntry[]): Promise<string> {
    const { expandedSpec, files, reviewReport, unresolvedIssues } = task.input as {
      expandedSpec: Record<string, unknown>;
      files: Array<{ path: string; content: string }>;
      reviewReport?: Record<string, unknown>;
      unresolvedIssues?: unknown[];
    };

    // Send only the quality-relevant slice of the spec to keep token usage bounded.
    const specSlice = {
      productName:      (expandedSpec as any)?.productName,
      productCategory:  (expandedSpec as any)?.productCategory,
      features:         (expandedSpec as any)?.features,
      uiExpectations:   (expandedSpec as any)?.uiExpectations,
      qualityStandards: (expandedSpec as any)?.qualityStandards,
    };

    const sections: string[] = [];
    sections.push('## Expanded Product Specification\n\n```json\n' + JSON.stringify(specSlice, null, 2) + '\n```');

    sections.push(`## Current Codebase (${files.length} files)`);
    for (const file of files) {
      sections.push(`### ${file.path}\n\`\`\`\n${file.content}\n\`\`\``);
    }

    if (reviewReport) {
      sections.push('## Reviewer Report (signal only — do not blindly trust)\n\n```json\n' +
        JSON.stringify(reviewReport) + '\n```');
    }
    if (Array.isArray(unresolvedIssues) && unresolvedIssues.length > 0) {
      sections.push('## Unresolved Issues from Debugger\n\n```json\n' +
        JSON.stringify(unresolvedIssues) + '\n```');
    }

    sections.push(this.formatMemoriesForPrompt(memories));

    sections.push(
      'Score the codebase on every rubric dimension. If any dimension is below ' + PASS_THRESHOLD +
      ', emit patches and/or newFiles that raise it above the bar. Return ONLY the JSON object.',
    );
    return sections.join('\n\n');
  }

  protected async parseOutput(raw: string, _task: Task): Promise<Record<string, unknown>> {
    return extractJSON(raw);
  }

  protected async validateOutput(output: Record<string, unknown>, _task: Task): Promise<void> {
    const scores = output.scores as Record<string, unknown> | undefined;
    if (!scores || typeof scores !== 'object') {
      throw new Error('Validation: missing scores object');
    }
    for (const dim of ['uiQuality', 'functionalQuality', 'codeQuality', 'consistency', 'overall']) {
      const v = scores[dim];
      if (typeof v !== 'number' || v < 0 || v > 100) {
        throw new Error(`Validation: scores.${dim} must be a number 0–100`);
      }
    }

    if (typeof output.verdict !== 'string' || !VALID_VERDICTS.has(output.verdict)) {
      throw new Error("Validation: verdict must be 'pass' or 'needs-improvement'");
    }

    if (!Array.isArray(output.findings)) {
      throw new Error('Validation: findings must be an array');
    }
    for (const f of output.findings as Array<Record<string, unknown>>) {
      if (typeof f.dimension !== 'string' || !VALID_DIMENSIONS.has(f.dimension)) {
        throw new Error(`Validation: finding.dimension invalid: ${String(f.dimension)}`);
      }
      if (typeof f.severity !== 'string' || !VALID_SEVERITIES.has(f.severity)) {
        throw new Error(`Validation: finding.severity invalid: ${String(f.severity)}`);
      }
      if (typeof f.description !== 'string' || f.description.length === 0) {
        throw new Error('Validation: finding.description required');
      }
    }

    if (!Array.isArray(output.patches)) {
      throw new Error('Validation: patches must be an array');
    }
    for (const p of output.patches as Array<Record<string, unknown>>) {
      if (typeof p.file !== 'string' || p.file.length === 0) {
        throw new Error('Validation: patch.file required');
      }
      if (typeof p.newContent !== 'string') {
        throw new Error('Validation: patch.newContent required');
      }
      if (typeof p.oldContent !== 'string') {
        throw new Error('Validation: patch.oldContent required (use empty string for new files)');
      }
    }

    if (output.newFiles !== undefined) {
      if (!Array.isArray(output.newFiles)) {
        throw new Error('Validation: newFiles must be an array when present');
      }
      for (const nf of output.newFiles as Array<Record<string, unknown>>) {
        if (typeof nf.path !== 'string' || typeof nf.content !== 'string') {
          throw new Error('Validation: newFile.path and newFile.content required');
        }
      }
    }

    if (typeof output.summary !== 'string' || output.summary.length === 0) {
      throw new Error('Validation: summary required');
    }

    // Enforce the contract: if any dimension fails the bar, the verdict MUST reflect it.
    const anyFailing = Object.entries(scores)
      .filter(([k]) => k !== 'overall')
      .some(([, v]) => (v as number) < PASS_THRESHOLD);
    if (anyFailing && output.verdict !== 'needs-improvement') {
      throw new Error('Validation: verdict must be "needs-improvement" when any dimension is below ' + PASS_THRESHOLD);
    }
  }

  protected async extractLearnings(_task: Task, output: Record<string, unknown>): Promise<MemoryEntry[]> {
    const scores = (output.scores ?? {}) as Record<string, number>;
    const verdict = output.verdict as string | undefined;
    const patchCount = Array.isArray(output.patches) ? output.patches.length : 0;
    const newFileCount = Array.isArray(output.newFiles) ? output.newFiles.length : 0;
    return [
      {
        agentRole: 'quality_enforcer',
        type: verdict === 'pass' ? 'pattern' : 'failure',
        content: `Quality verdict=${verdict} overall=${scores.overall ?? 'n/a'} patches=${patchCount} newFiles=${newFileCount}`,
        relevanceScore: 0.85,
        tags: ['quality', verdict === 'pass' ? 'pass' : 'needs-improvement'],
        metadata: { scores, patchCount, newFileCount },
      } as unknown as MemoryEntry,
    ];
  }
}
