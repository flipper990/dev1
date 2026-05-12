// ─────────────────────────────────────────────────────────────
// QA Agent — reviews codebase, applies fixes, returns verdict.
// Verdict 'needs-improvement' triggers a Builder re-run loop.
// ─────────────────────────────────────────────────────────────

import { BaseAgent } from '../../../../packages/agent-core/src/base-agent.js';
import type { Task, MemoryEntry } from '../../../../packages/agent-core/src/types.js';
import { renderSkillsForPrompt } from '../../../../packages/agent-core/src/skills/index.js';
import { extractJSON } from './utils.js';
import { runQaStaticChecks, formatStaticIssuesForPrompt, type StaticIssue } from './qa-static-checks.js';

interface FeatureSlice {
  id: string;
  purpose?: string;
  routes?: string[];
  apiIds?: string[];
  dbTables?: string[];
  components?: string[];
  acceptance?: string[];
}

interface QaInput {
  spec: Record<string, unknown>;
  files: Array<{ path: string; content: string; language?: string }>;
  filesManifest?: Array<{ path: string; bytes: number; lines: number; kind: string; language?: string }>;
  runtimeFeedback?: {
    issues?: { category: string; message: string; hint?: string; rootCause?: string }[];
    log?: string;
    bodySample?: string;
    systemChecks?: {
      frontend?: { ok: boolean; status?: number; note?: string };
      backendHealth?: { ok: boolean; status?: number; note?: string };
      database?: { ok: boolean; note?: string };
      apiEndpoints?: Array<{ id: string; method: string; path: string; status?: number; ok: boolean; note?: string }>;
      scenarios?: Array<{ name: string; ok: boolean; steps: Array<{ step: string; ok: boolean; note?: string }> }>;
    };
  };
  currentSlice?: FeatureSlice;
  sliceIndex?: number;
  totalSlices?: number;
}

export class QaAgent extends BaseAgent {
  // Stash of static findings from the most recent buildPrompt call. Used by
  // the post-LLM verdict override so we don't have to re-scan the files.
  private lastStaticIssues: StaticIssue[] = [];

  protected async buildPrompt(task: Task, memories: MemoryEntry[]): Promise<string> {
    const { spec, files, filesManifest, runtimeFeedback, currentSlice, sliceIndex, totalSlices } =
      task.input as unknown as QaInput;

    // Run mechanical preflight FIRST so its findings are surfaced as forced
    // criticals at the top of the prompt. The LLM is far more reliable when
    // told exactly what to look for than when asked to hunt blind.
    const staticIssues = runQaStaticChecks(files);
    this.lastStaticIssues = staticIssues;

    let prompt = '';
    prompt += renderSkillsForPrompt({
      role: 'qa',
      spec,
      files,
      filesManifest,
      runtimeFeedback: runtimeFeedback as Record<string, unknown> | undefined,
      currentSlice,
    });
    prompt += `## Product Specification\n\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\`\n\n`;

    if (staticIssues.length > 0) {
      prompt += formatStaticIssuesForPrompt(staticIssues) + '\n';
    }

    if (currentSlice && typeof sliceIndex === 'number' && typeof totalSlices === 'number') {
      prompt += `## ⚡ ACTIVE SLICE UNDER REVIEW — ${sliceIndex + 1} of ${totalSlices}: \`${currentSlice.id}\`\n\n`;
      prompt += `This QA pass is GATING the slice loop. Verdict must be "pass" before BUILDER\n`;
      prompt += `moves to the next slice. Scope your review:\n`;
      prompt += `  • Slice's frontend route(s):  ${(currentSlice.routes ?? []).join(', ') || '(none)'}\n`;
      prompt += `  • Slice's API endpoints:      ${(currentSlice.apiIds ?? []).join(', ') || '(none)'}\n`;
      prompt += `  • Slice's DB table(s):        ${(currentSlice.dbTables ?? []).join(', ') || '(none)'}\n`;
      prompt += `  • Slice's components:         ${(currentSlice.components ?? []).join(', ') || '(none)'}\n`;
      prompt += `  • Acceptance criteria — every one MUST hold:\n`;
      for (const a of currentSlice.acceptance ?? []) prompt += `      - ${a}\n`;
      prompt += `\n`;
      prompt += `Only fail this slice on issues caused BY this slice. Do not fail it because a\n`;
      prompt += `later (not-yet-built) slice is missing — those are expected gaps. DO still flag\n`;
      prompt += `regressions to earlier slices' files.\n\n`;
    }

    // Runtime feedback (when present) MUST be addressed before any verdict
    // of "pass". Surface it prominently above the file list.
    if (runtimeFeedback && Array.isArray(runtimeFeedback.issues) && runtimeFeedback.issues.length > 0) {
      prompt += `## ⚠ LIVE-PREVIEW RUNTIME FAILURES (treat each as CRITICAL)\n\n`;
      for (const iss of runtimeFeedback.issues.slice(0, 25)) {
        const rc = iss.rootCause ? `\n      ROOT CAUSE: ${iss.rootCause}` : '';
        prompt += `- [${iss.category}] ${iss.message}${iss.hint ? `  (hint: ${iss.hint})` : ''}${rc}\n`;
      }
      if (runtimeFeedback.systemChecks) {
        const s = runtimeFeedback.systemChecks;
        prompt += `\n### System check matrix\n`;
        if (s.frontend)      prompt += `- frontend:        ${s.frontend.ok ? 'PASS' : 'FAIL'} (status=${s.frontend.status ?? 'n/a'}${s.frontend.note ? `, ${s.frontend.note}` : ''})\n`;
        if (s.backendHealth) prompt += `- backend /health: ${s.backendHealth.ok ? 'PASS' : 'FAIL'} (status=${s.backendHealth.status ?? 'n/a'}${s.backendHealth.note ? `, ${s.backendHealth.note}` : ''})\n`;
        if (s.database)      prompt += `- database:        ${s.database.ok ? 'PASS' : 'FAIL'}${s.database.note ? ` (${s.database.note})` : ''}\n`;
        if (s.apiEndpoints && s.apiEndpoints.length > 0) {
          prompt += `- api endpoints:\n`;
          for (const ep of s.apiEndpoints) prompt += `    · ${ep.method.padEnd(6)} ${ep.path} → ${ep.ok ? 'PASS' : 'FAIL'}${ep.note ? ` (${ep.note})` : ''}\n`;
        }
        if (s.scenarios && s.scenarios.length > 0) {
          prompt += `- integration scenarios:\n`;
          for (const sc of s.scenarios) {
            prompt += `    · ${sc.name}: ${sc.ok ? 'PASS' : 'FAIL'}\n`;
            for (const st of sc.steps) prompt += `        - ${st.step} → ${st.ok ? 'ok' : 'FAIL'}${st.note ? ` (${st.note})` : ''}\n`;
          }
        }
      }
      if (runtimeFeedback.log) {
        prompt += `\n### Container log tail\n\`\`\`\n${runtimeFeedback.log.slice(-2000)}\n\`\`\`\n`;
      }
      prompt += `\nMANDATORY GATING RULES — verdict CANNOT be "pass" while ANY of these are true:\n`;
      prompt += `  • Any runtime/system issue above is unresolved.\n`;
      prompt += `  • Backend /health is not 2xx.\n`;
      prompt += `  • Database check is FAIL.\n`;
      prompt += `  • Any api endpoint above is FAIL (excluding ones marked "skipped").\n`;
      prompt += `  • Any integration scenario above is FAIL.\n`;
      prompt += `Address EVERY failing item via patches[] / newFiles[]. Fix root causes, not symptoms.\n\n`;
    }

    prompt += `## Codebase (${files.length} files)\n\n`;
    for (const f of files) {
      prompt += `### ${f.path}\n\`\`\`${f.language ?? ''}\n${f.content}\n\`\`\`\n\n`;
    }

    if (filesManifest && filesManifest.length > 0) {
      prompt += `## Other files in the project (manifest only — bodies omitted to save tokens)\n\n`;
      prompt += `These files EXIST in the codebase but were not loaded for this review because they are not part of the active slice. They are managed by other slices and are presumed correct.\n`;
      prompt += `Rules:\n`;
      prompt += `  • Do NOT flag them as missing.\n`;
      prompt += `  • Do NOT include them in patches[] / newFiles[].\n`;
      prompt += `  • If a file in the loaded set imports from one of these, treat the import as resolved.\n`;
      prompt += `  • If you SUSPECT a regression in one of them caused by this slice, request it by path in your "issues[]" with a 'needs-review' note instead of guessing.\n\n`;
      // Group by kind for readability and cap to a reasonable size.
      const byKind: Record<string, typeof filesManifest> = {};
      for (const m of filesManifest) (byKind[m.kind] ??= []).push(m);
      for (const kind of Object.keys(byKind).sort()) {
        prompt += `### ${kind} (${byKind[kind].length})\n`;
        for (const m of byKind[kind]) {
          prompt += `- ${m.path} — ${m.bytes}B / ${m.lines} lines\n`;
        }
        prompt += `\n`;
      }
    }

    prompt += this.formatMemoriesForPrompt(memories);

    prompt += `Review the entire codebase. Produce the JSON verdict per your system prompt.`;
    return prompt;
  }

  protected async parseOutput(raw: string, _task: Task): Promise<Record<string, unknown>> {
    return extractJSON(raw);
  }

  protected async validateOutput(output: Record<string, unknown>, _task: Task): Promise<void> {
    const verdict = String(output.verdict ?? '').toLowerCase();
    if (verdict !== 'pass' && verdict !== 'needs-improvement') {
      throw new Error(`Validation: verdict must be 'pass' or 'needs-improvement', got "${output.verdict}"`);
    }
    if (!Array.isArray(output.issues))  throw new Error('Validation: issues must be an array');
    if (!Array.isArray(output.patches)) throw new Error('Validation: patches must be an array');
    if (!output.scores || typeof output.scores !== 'object') {
      throw new Error('Validation: scores object missing');
    }

    // newFiles[] entry-shape validation. The QA agent occasionally emits
    // entries like { path: "…", description: "…" } without a `content`
    // field. Such entries enter the artifact map, get spread into the file
    // tree by assembleProject, then get JSON-stringified — at which point
    // the undefined content key is silently dropped. The corrupted entry
    // resurfaces only at preview-staging time as a low-level Node throw.
    // Reject at the source instead so the agent re-runs cleanly.
    if (output.newFiles !== undefined) {
      if (!Array.isArray(output.newFiles)) {
        throw new Error('Validation: newFiles must be an array');
      }
      const nf = output.newFiles as Array<Record<string, unknown>>;
      for (let i = 0; i < nf.length; i++) {
        const f = nf[i];
        if (!f || typeof f !== 'object') {
          throw new Error(`Validation: newFiles[${i}] must be an object`);
        }
        if (typeof f.path !== 'string' || f.path.length === 0) {
          throw new Error(`Validation: newFiles[${i}].path must be a non-empty string`);
        }
        if (typeof f.content !== 'string') {
          throw new Error(
            `Validation: newFiles[${i}].content must be a string for "${f.path}" (got ${typeof f.content}). ` +
            'Every QA newFile MUST include the full file body as a string.',
          );
        }
      }
    }

    // ── Verdict override gate ────────────────────────────────────────────
    // The LLM occasionally rubber-stamps obviously broken builds. We refuse
    // to let "pass" through when:
    //   (a) any static-check critical was raised but the QA output did not
    //       acknowledge it (id missing from issues[] AND no matching patch),
    //   (b) any LLM-reported critical issue is unpatched.
    // In both cases we forcibly downgrade the verdict so BUILDER re-runs.
    if (verdict === 'pass') {
      const reportedIds = new Set(
        ((output.issues ?? []) as Array<Record<string, unknown>>)
          .map((i) => String(i.id ?? ''))
          .filter(Boolean),
      );
      const patchedFiles = new Set(
        ((output.patches ?? []) as Array<Record<string, unknown>>)
          .map((p) => String(p.file ?? ''))
          .filter(Boolean),
      );
      const newFilePaths = new Set(
        ((output.newFiles ?? []) as Array<Record<string, unknown>>)
          .map((f) => String(f.path ?? ''))
          .filter(Boolean),
      );

      const ignoredStaticCriticals = this.lastStaticIssues.filter((i) => {
        if (i.severity !== 'critical' && i.severity !== 'high') return false;
        // Acceptable acknowledgement: same id, or a patch/newFile touching
        // the offending path. Codebase-wide issues (no file) require an id.
        if (reportedIds.has(i.id)) return false;
        if (i.file && (patchedFiles.has(i.file) || newFilePaths.has(i.file))) return false;
        return true;
      });

      const llmCriticalUnpatched = ((output.issues ?? []) as Array<Record<string, unknown>>)
        .filter((iss) => {
          const sev = String(iss.severity ?? '').toLowerCase();
          if (sev !== 'critical') return false;
          const file = String(iss.file ?? '');
          if (!file) return true; // codebase-wide critical needs explicit handling
          return !patchedFiles.has(file) && !newFilePaths.has(file);
        });

      if (ignoredStaticCriticals.length > 0 || llmCriticalUnpatched.length > 0) {
        const reasons: string[] = [];
        if (ignoredStaticCriticals.length > 0) {
          reasons.push(
            `${ignoredStaticCriticals.length} static-check critical/high issue(s) not addressed (e.g. ${ignoredStaticCriticals
              .slice(0, 3)
              .map((i) => i.id)
              .join(', ')})`,
          );
        }
        if (llmCriticalUnpatched.length > 0) {
          reasons.push(`${llmCriticalUnpatched.length} self-reported critical issue(s) not patched`);
        }

        // Mutate the output: downgrade verdict + append synthetic issues so
        // the builder re-run loop sees them.
        output.verdict = 'needs-improvement';
        const synthIssues = [
          ...ignoredStaticCriticals.map((i) => ({
            id: i.id,
            severity: i.severity,
            category: i.category,
            file: i.file,
            line: i.line,
            description: i.description,
            rootCause: 'Static QA check raised this — must be addressed.',
            suggestedFix: i.suggestedFix,
          })),
        ];
        const merged = ([...(output.issues as unknown[]), ...synthIssues]) as unknown[];
        output.issues = merged;
        const summary = String(output.summary ?? '');
        output.summary =
          `[Verdict downgraded by QA gate: ${reasons.join('; ')}] ` + summary;
      }
    }
  }

  protected async extractLearnings(_task: Task, output: Record<string, unknown>): Promise<MemoryEntry[]> {
    const verdict = String(output.verdict ?? '').toLowerCase();
    const issueCount  = Array.isArray(output.issues)  ? output.issues.length  : 0;
    const patchCount  = Array.isArray(output.patches) ? output.patches.length : 0;
    return [{
      agentRole: 'qa',
      type: 'pattern',
      content: `QA verdict ${verdict}: ${issueCount} issues, ${patchCount} patches applied.`,
      relevanceScore: 0.7,
      tags: ['qa', verdict],
      metadata: { verdict, issueCount, patchCount },
    } as unknown as MemoryEntry];
  }
}
