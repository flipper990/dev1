// ─────────────────────────────────────────────────────────────
// Builder Agent — generates the full-stack codebase from the spec.
// Re-runs in QA-feedback mode when QA verdict = 'needs-improvement'.
//
// Truncation hardening (added 2026-04):
//   1. Tolerant JSON extraction salvages complete `{path, content}` entries
//      from a truncated response instead of throwing.
//   2. `coreExecute` is overridden to:
//        a. detect truncation / parse failure and retry up to MAX_BUILDER_ATTEMPTS;
//        b. for "large" slices (many routes/components/apiIds/dbTables),
//           pre-split work into batches of FILES_PER_BATCH items and run
//           one LLM call per batch, merging the results;
//        c. log every retry / chunk decision under structured fields the
//           UI can surface (see `event:'builder:truncated' | 'builder:chunk' |
//           'builder:retry'` in the logger output).
// ─────────────────────────────────────────────────────────────

import { BaseAgent } from '../../../../packages/agent-core/src/base-agent.js';
import type {
  ExecutionContext,
  Task,
  MemoryEntry,
} from '../../../../packages/agent-core/src/types.js';
import { extractJSONTolerant, looksTruncated } from './utils.js';
import { UI_SYSTEM_PROMPT } from '../../../../packages/agent-core/src/ui-system.js';
import { normalizeTechStack, buildStackContract } from '../../../../packages/agent-core/src/tech-stack.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TokenBudget,
  estimateTokensFromFiles,
  estimateTokensFromText,
  type BudgetPhase,
} from '../pipeline/token-budget.js';
import { validateImportIntegrity } from '../../../../packages/agent-core/src/import-integrity.js';

interface FeatureSlice {
  id: string;
  purpose?: string;
  routes?: string[];
  apiIds?: string[];
  dbTables?: string[];
  components?: string[];
  acceptance?: string[];
}

interface BuilderFile {
  path: string;
  content: string;
  language?: string;
}

interface BuilderChunkHint {
  /** 1-based index of this batch within `total`. */
  index: number;
  /** Total number of batches the slice was split into. */
  total: number;
  /** Subset of slice deliverables this batch is responsible for. */
  scope: {
    routes: string[];
    apiIds: string[];
    dbTables: string[];
    components: string[];
  };
}

interface BuilderInput {
  spec: Record<string, unknown>;
  existingFiles?: BuilderFile[];
  /** Compact path/size manifest of files NOT included in `existingFiles`.
   *  Set by `buildAgentInput` when slice slimming filters out non-relevant
   *  prior files. The builder must treat these as present-and-correct. */
  existingFilesManifest?: Array<{ path: string; bytes: number; lines: number; kind: string; language?: string }>;
  qaFeedback?: Record<string, unknown>;
  iteration?: number;
  currentSlice?: FeatureSlice;
  sliceIndex?: number;
  totalSlices?: number;
  /** Markdown summary of all previously-completed slices (slice-planner). */
  sliceManifest?: string;
  // ── Truncation/chunking control (set by this class on retries) ──
  /** Set to a 1-based attempt number when the previous LLM call was truncated. */
  builderAttempt?: number;
  /** When set, the prompt asks the LLM to emit only files for this batch. */
  chunk?: BuilderChunkHint;
  /** When set, files in `_alreadyEmitted` were salvaged from a previous
   *  truncated response — the LLM should NOT regenerate them and should
   *  emit only the remaining files. */
  _alreadyEmitted?: string[];
  /** Files whose CONTENT was incomplete (mid-function, unbalanced JSX, etc.)
   *  in the previous attempt. The LLM MUST regenerate these from scratch —
   *  they are not in `_alreadyEmitted` because we discarded them. */
  _incompletePaths?: string[];
  /** Why the previous attempt failed — surfaced inline so the LLM corrects course. */
  _truncationHint?: string;
  /** Reduced-prompt last-resort retry. Set when normal retries returned
   *  zero usable files. Triggers a stripped-down prompt with no extra
   *  context (no qaFeedback, no manifest, minimal existingFiles) and an
   *  explicit "generate ONLY these files" target list. */
  _fallbackMode?: boolean;
  /** When `_fallbackMode` is set, this is the explicit list of paths the
   *  LLM must emit in this single call. */
  _fallbackTargetPaths?: string[];
  /** When `_fallbackMode` is set, the snapshot of the primary attempt(s)
   *  that returned zero files. Persisted in last-builder-empty-failure.json
   *  so a single dump file describes both the original and the fallback. */
  _primarySnapshot?: Record<string, unknown>;
  // ── Phased generation control ──
  /** When set, the LLM is asked to emit files only for this phase. */
  phase?: BuilderPhase;
  /** 1-based phase index (e.g. 2 of 5). */
  phaseIndex?: number;
  /** Total phases in this phased build. */
  phaseTotal?: number;
}

/**
 * Phased generation: split a non-sliced full build into ordered phases so
 * each LLM call is small enough to complete inside maxTokens. Each phase
 * receives prior phases' output as `existingFiles`. Order matters —
 * dependencies must be emitted BEFORE their consumers:
 *   1. skeleton    — minimum runnable shell (home + about, no features)
 *   2. backend     — API routes / DB schema (defined from spec.apiContracts)
 *   3. components  — reusable UI primitives (Button, Card, Form, …)
 *   4. pages       — feature pages that IMPORT components and CALL backend
 *   5. config      — package.json with every dep referenced above
 *   6. polish      — final integration sweep
 * Pages run AFTER backend & components so they can import real symbols
 * instead of inlining + later refactoring (which doubled rebuild cost).
 */
export type BuilderPhase = 'skeleton' | 'pages' | 'backend' | 'components' | 'config' | 'polish';

const PHASE_ORDER: BuilderPhase[] = ['skeleton', 'backend', 'components', 'pages', 'config', 'polish'];

const PHASE_INSTRUCTIONS: Record<BuilderPhase, string> = {
  skeleton:
    '🏗️ MINIMUM-RUNNABLE-APP PHASE — do NOT skip, do NOT over-build.\n' +
    '\n' +
    'Goal: produce the smallest possible set of files that lets `npm install && npm run dev` succeed and serve a single working page at `/`. The next phases flesh out features. If only THIS phase succeeds and every later phase fails, the user must still get a running dev server with one navigable page — that is the contract.\n' +
    '\n' +
    'EMIT EXACTLY THESE FILES (no more, no fewer):\n' +
    '  1. `package.json`           — only the dependencies needed to boot the chosen stack (e.g. for Next.js: next, react, react-dom + their @types and typescript). Use latest stable major versions. Include `dev` + `build` + `start` scripts.\n' +
    '  2. `tsconfig.json`          — standard Next.js / Vite tsconfig, strict mode on.\n' +
    '  3. Stack config             — e.g. `next.config.mjs` for Next.js, `vite.config.ts` for Vite. Tiny, no plugins beyond what the stack needs to start.\n' +
    '  4. `src/app/layout.tsx`     — root layout with `<html>`, `<body>`, and ONE simple `<nav>` containing a link to `/` and a link to `/about`. Plain HTML, no design system.\n' +
    '  5. `src/app/page.tsx`       — a real home page. Renders a heading, a short paragraph describing the product (from the spec), a clickable button with a `useState` counter to prove interactivity works, and a `<Link href="/about">` to a stub second page. Uses native HTML elements only.\n' +
    '  6. `src/app/about/page.tsx` — a tiny stub page proving routing works (one heading + one `<Link href="/">` back home).\n' +
    '  7. `src/app/globals.css`    — minimal CSS variables + body reset + link/button styles. NO Tailwind directives unless the stack contract requires it.\n' +
    '\n' +
    'STRICT RULES:\n' +
    '  • NO design system, NO theme files, NO `src/components/`, NO `src/lib/`, NO hooks. Inline everything.\n' +
    '  • NO backend code, NO API routes, NO Prisma schema, NO database wiring.\n' +
    '  • NO feature pages beyond the two above (home + about). Spec features are handled by the next phase.\n' +
    '  • EVERY import must resolve to either (a) a package in `package.json`, (b) a relative path you also emit, or (c) Node/Next built-ins.\n' +
    '  • NO TODOs. NO `// will be implemented`. NO `alert("TODO")`. The button must actually increment a counter.\n' +
    '\n' +
    'BUDGET RULE: Spend at most ~3 KB per file. The whole skeleton should fit in ~12 KB total. This phase has the smallest token allowance — use it to nail the minimum, not to flex.',
  pages:
    '\ud83d\udcc4 FEATURE-PAGES PHASE \u2014 the skeleton, backend, and components phases ALREADY ran. You are the LAST source-code phase before config.\n' +
    '\n' +
    'WHAT ALREADY EXISTS in `existingFiles` (use it, do not duplicate):\n' +
    '  \u2022 Skeleton: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/about/page.tsx`, `src/app/globals.css`.\n' +
    '  \u2022 Backend: API routes under `src/app/api/**/route.ts` (or `server/`), Prisma schema, services. CALL these via `fetch("/api/...")` \u2014 do not invent endpoints that are not present.\n' +
    '  \u2022 Components: reusable primitives under `src/components/**` (Button, Card, Input, Form, Layout, etc.) and helpers under `src/lib/**`. IMPORT them; do not inline.\n' +
    '\n' +
    'MUST EMIT (one file per primary feature in the spec):\n' +
    '  \u2022 One `src/app/<feature>/page.tsx` per feature/route declared in the spec (dashboard, listings, settings, auth/login, profile, etc.). Real content, not stubs.\n' +
    '  \u2022 An updated `src/app/layout.tsx` adding nav links to every new page (preserve home + about). Re-emit the full file.\n' +
    '  \u2022 The original `src/app/page.tsx` enriched with a real product landing section (hero, feature highlights, CTA buttons that link to the new feature pages). Re-emit the full file.\n' +
    '\n' +
    'IMPORT DISCIPLINE \u2014 the most common failure mode:\n' +
    '  \u2713 IMPORT components from `@/components/...` or `src/components/...` whenever a primitive exists for what you need (Button, Card, Input, Form, etc.). Do NOT inline native elements when a component is available.\n' +
    '  \u2713 IMPORT helpers / API clients from `@/lib/...` if the components phase emitted them.\n' +
    '  \u2713 CALL backend via `fetch("/api/<exact-path>")` matching a route file that already exists in `existingFiles`. Wrap with try/catch + placeholder fallback.\n' +
    '  \u2717 Do NOT import a path that does not exist in `existingFiles`. If the primitive you need is missing, fall back to native HTML rather than hallucinating an import.\n' +
    '  \u2717 Do NOT import bare-module packages that are not already used elsewhere in `existingFiles` (the config phase needs to know every dep).\n' +
    '\n' +
    'PAGES MUST BE FUNCTIONAL:\n' +
    '  \u2022 Use semantic HTML (<header>, <main>, <nav>, <ul>, <form>, <button>, <table>) wrapped with the design components when available.\n' +
    '  \u2022 Inline interactive logic: `useState` for local state, working `onClick` / `onSubmit` handlers, real-looking sample data so the page is not blank.\n' +
    '\n' +
    'DO NOT \u2014 strict prohibitions for THIS phase:\n' +
    '  \u2717 Do NOT touch `package.json`, `tsconfig`, `next.config`, or any config file. Config phase handles those.\n' +
    '  \u2717 Do NOT emit new files under `src/components/**`, `src/lib/**`, or hooks. Components phase already shipped those; if a primitive you need is missing, fall back to native HTML.\n' +
    '  \u2717 Do NOT emit backend routes, Prisma schema, or services. Backend phase already shipped those.\n' +
    '  \u2717 Do NOT replace `src/app/page.tsx` with a "Welcome" stub or runtime-fallback placeholder. That is treated as a hard failure.\n' +
    '\n' +
    'BUDGET RULE: Spend tokens on FEATURE COVERAGE, not on individual page polish. A boring 30-line dashboard + 30-line settings + 30-line listings beats a 300-line dashboard with no other pages.',
  backend:
    'Emit ONLY backend code: API route handlers (Next.js `src/app/api/**/route.ts` OR Fastify/Express `server.ts` depending on stack), Prisma schema, database models, server-side services, middleware, and auth logic. ' +
    'Pages do NOT exist yet — derive the endpoint surface from `spec.apiContracts`, `spec.frontendPages[].fetches[]`, and any data-shapes named in `spec.entities[]`. Emit one route per declared contract; the pages phase will fetch these by exact path. ' +
    'Endpoints MUST follow REST-ish path conventions (`/api/<resource>`, `/api/<resource>/[id]`) so the pages phase can call them deterministically. ' +
    'Do NOT re-emit skeleton files — they must stay byte-for-byte identical. Do NOT emit components, pages, or config.',
  components:
    'Emit ONLY shared frontend code: `src/components/**`, `src/lib/**`, hooks, utility helpers, and design tokens. ' +
    'Pages do NOT exist yet — pre-build the reusable primitives the pages phase will import. Cover at minimum: a `Button`, an `Input`, a `Card`/`Panel`, a `Form`/`FormField`, and any layout primitive (`Container`, `PageHeader`) implied by the spec. Add domain-specific components named in `spec.components[]` and any component referenced by `spec.frontendPages[].components[]`. ' +
    'You MAY emit a tiny API client under `src/lib/api.ts` that wraps `fetch` for the backend routes already present in `existingFiles` — pages will use it. ' +
    'Each component must be self-contained: no imports from `src/app/**` (pages do not exist), only from `src/components/**`, `src/lib/**`, or installable npm packages. ' +
    'Do NOT emit pages, backend code, or config.',
  config:
    'Emit ONLY project configuration: `package.json` (with EVERY dependency used by the codebase already in existingFiles), `tsconfig.json`, `next.config.{js,mjs}`, `tailwind.config.{ts,js}`, `postcss.config.js`, `.env.example`, `.gitignore`, and `prisma/schema.prisma` if not yet emitted. ' +
    'Cross-reference every import in existingFiles to confirm package.json declares it. ' +
    'Do NOT emit any source files (.ts/.tsx) other than config.',
  polish:
    'Final integration phase. Review every file in existingFiles for: missing imports, unused imports, broken cross-references, mismatched prop types, dangling TODOs, placeholder copy, and unwired buttons. ' +
    'Emit ONLY the files that need to change to fix integration issues. Do not introduce new features. Do not regenerate files that are already correct.',
};

const MAX_BUILDER_ATTEMPTS = 3;
/**
 * How many in-phase repair passes the builder gets before we abort the
 * build with the validation error. Each repair pass sends the issue list
 * back as part of the prompt and asks for fixes only.
 */
const MAX_PHASE_REPAIR_ATTEMPTS = 2;
/** A slice is "large" when total deliverables exceed this number. */
const LARGE_SLICE_THRESHOLD = 10;
/** When chunking, target this many deliverables per batch. */
const ITEMS_PER_BATCH = 6;

export class BuilderAgent extends BaseAgent {
  protected async buildPrompt(task: Task, memories: MemoryEntry[]): Promise<string> {
    const input = task.input as unknown as BuilderInput;
    const {
      spec, existingFiles, qaFeedback, iteration,
      currentSlice, sliceIndex, totalSlices, sliceManifest,
      builderAttempt, chunk, _alreadyEmitted, _incompletePaths, _truncationHint,
      _fallbackMode, _fallbackTargetPaths,
      phase, phaseIndex, phaseTotal,
    } = input;
    const iter = iteration ?? 1;

    let prompt = `## Build Iteration: ${iter}\n\n`;

    // ── Reduced-prompt fallback preamble (HIGHEST PRIORITY) ────────
    // When all normal retries have produced zero usable files, this last
    // attempt strips everything except the bare slice + an explicit file
    // list. The early-return below also drops qaFeedback/manifest/extra
    // context to maximise the chance the LLM produces SOMETHING valid.
    if (_fallbackMode && Array.isArray(_fallbackTargetPaths) && _fallbackTargetPaths.length > 0) {
      prompt += `## 🚨 LAST-RESORT REDUCED PROMPT — PRIOR ATTEMPTS PRODUCED ZERO FILES\n\n`;
      prompt += `Every previous attempt failed to return any usable files. This is the final retry with a minimal scope.\n\n`;
      prompt += `## 🎯 TARGET FILES (generate ONLY these, in this exact order)\n\n`;
      for (const p of _fallbackTargetPaths) prompt += `  • ${p}\n`;
      prompt += `\nSTRICT RULES:\n`;
      prompt += `  • Emit ONLY the files listed above. Do NOT emit anything else.\n`;
      prompt += `  • Each file MUST be complete and runnable as written.\n`;
      prompt += `  • Keep each file SHORT (~30 lines). Inline rather than abstract.\n`;
      prompt += `  • No TODOs. No placeholder copy. No "coming soon" alerts. No explanatory comments.\n`;
      prompt += `  • Use plain semantic HTML + minimal styling. Skip Tailwind theming if it adds tokens.\n`;
      prompt += `  • Output JSON: { "files": [ { "path": "...", "content": "..." }, ... ] }\n\n`;

      if (currentSlice) {
        prompt += `## Slice context\n\n`;
        prompt += '```json\n' + JSON.stringify({
          id: currentSlice.id,
          purpose: currentSlice.purpose,
          routes: currentSlice.routes,
          components: currentSlice.components,
        }, null, 2) + '\n```\n\n';
      }

      // Bare-minimum tech stack so file extensions / framework match.
      const stack = normalizeTechStack((spec as Record<string, unknown> | undefined)?.techStack);
      prompt += `## Tech stack (use exactly)\n\n`;
      prompt += '```json\n' + JSON.stringify(stack, null, 2) + '\n```\n\n';
      // Intentionally NO existingFiles, NO manifest, NO qaFeedback, NO sliceManifest.
      void existingFiles; void qaFeedback; void sliceManifest;
      void sliceIndex; void totalSlices;
      return prompt;
    }

    // ── Phase preamble (placed FIRST so it dominates the LLM's attention) ──
    if (phase) {
      const idx = phaseIndex ?? 1;
      const total = phaseTotal ?? PHASE_ORDER.length;
      prompt += `## 🎯 PHASE ${idx} OF ${total} — ${phase.toUpperCase()}\n\n`;
      prompt += `${PHASE_INSTRUCTIONS[phase]}\n\n`;
      prompt += `STRICT RULES:\n`;
      prompt += `  • Emit ONLY files belonging to this phase. Other phases handle the rest.\n`;
      prompt += `  • Every file in existingFiles below was produced by a prior phase — preserve it byte-for-byte unless this phase explicitly changes it.\n`;
      prompt += `  • Each emitted file MUST be complete and runnable. Prefer fewer, finished files over many half-done stubs.\n`;
      prompt += `  • Do NOT pad files with explanatory comments. Do NOT include TODO markers.\n\n`;
    }

    // ── Truncation / chunk preamble (placed FIRST so the LLM sees it before the spec dump) ──
    if (_truncationHint) {
      prompt += `## ⚠ PREVIOUS ATTEMPT TRUNCATED — RESPONSE WAS DISCARDED (clean retry, attempt ${builderAttempt ?? 2})\n\n`;
      prompt += `${_truncationHint}\n\n`;
      prompt += `The previous response was truncated and DISCARDED IN FULL — none of those files were kept. Start fresh.\n`;
      prompt += `To stay within the token cap this time:\n`;
      prompt += `  • Be concise. Prefer SHORT, COMPLETE files over long, half-finished ones.\n`;
      prompt += `  • Do not pad files with explanatory comments or repeat boilerplate.\n`;
      prompt += `  • If you cannot fit everything, emit fewer files but make each one fully complete.\n\n`;
      // NOTE: we intentionally do NOT pass `_alreadyEmitted` / `_incompletePaths`
      // any more. Telling the model "skip these files because they were
      // already emitted" caused it to omit dependencies that downstream
      // files imported, producing inconsistent codebases. The strict policy
      // is now: discard everything, regenerate the full scope cleanly.
    }
    void _alreadyEmitted; void _incompletePaths;

    if (chunk) {
      prompt += `## 🔢 BATCH ${chunk.index} OF ${chunk.total}\n\n`;
      prompt += `This slice was split into ${chunk.total} batches because of its size. `;
      prompt += `In THIS batch, emit files only for the following scope; the other batches handle the rest.\n\n`;
      prompt += '```json\n' + JSON.stringify(chunk.scope, null, 2) + '\n```\n\n';
      prompt += `Do NOT emit files outside this batch's scope. Other batches will. `;
      prompt += `Preserve all files in existingFiles byte-for-byte.\n\n`;
    }

    if (currentSlice && typeof sliceIndex === 'number' && typeof totalSlices === 'number') {
      prompt += `## ⚡ ACTIVE FEATURE SLICE — ${sliceIndex + 1} of ${totalSlices}: \`${currentSlice.id}\`\n\n`;
      prompt += `You are building ONLY this slice in this pass. Preserve every other file in existingFiles\n`;
      prompt += `byte-for-byte. Emit incremental output: only files this slice creates or modifies.\n\n`;
      prompt += '```json\n' + JSON.stringify(currentSlice, null, 2) + '\n```\n\n';
      prompt += `Implement this slice end-to-end:\n`;
      prompt += `  • Frontend route(s): ${(currentSlice.routes ?? []).join(', ') || '(none)'}\n`;
      prompt += `  • Backend API endpoints (apiIds): ${(currentSlice.apiIds ?? []).join(', ') || '(none)'}\n`;
      prompt += `  • Prisma model(s) / table(s): ${(currentSlice.dbTables ?? []).join(', ') || '(none)'}\n`;
      prompt += `  • Components: ${(currentSlice.components ?? []).join(', ') || '(none)'}\n`;
      prompt += `  • Acceptance criteria — every one MUST hold once this pass completes:\n`;
      for (const a of currentSlice.acceptance ?? []) prompt += `      - ${a}\n`;
      prompt += `\n`;
      prompt += `If this slice depends on tables/components owned by an earlier slice, USE them as-is\n`;
      prompt += `from existingFiles — do not redefine. If you discover the earlier slice's files are\n`;
      prompt += `missing or wrong, the QA agent will flag it; do not silently rewrite them here.\n\n`;
    }

    // Per-slice context manifest — compact summary of every previously
    // completed slice so the model can reference stable names (routes,
    // tables, components) across slices without re-reading every file.
    if (typeof sliceManifest === 'string' && sliceManifest.length > 0) {
      prompt += sliceManifest + '\n';
    }

    prompt += `## Product Specification\n\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\`\n\n`;

    // Inject the per-task tech-stack contract (derived from spec.techStack)
    // BEFORE the UI system block so the model anchors on backend/frontend/ORM
    // choices first. Stack-mismatched output is rejected by the pipeline.
    const stack = normalizeTechStack((spec as Record<string, unknown> | undefined)?.techStack);
    prompt += buildStackContract(stack) + '\n';

    // Inject the UI design-system contract before any QA / existing-files
    // dump so the model anchors on the rules. Compliance is enforced after
    // generation by validateUiSystemCompliance — output that violates the
    // contract is rejected and rebuilt.
    prompt += UI_SYSTEM_PROMPT + '\n';

    if (qaFeedback && Object.keys(qaFeedback).length > 0) {
      prompt += `## QA FEEDBACK — fix EVERY issue listed below\n\n\`\`\`json\n${JSON.stringify(qaFeedback, null, 2)}\n\`\`\`\n\n`;
    }

    if (Array.isArray(existingFiles) && existingFiles.length > 0) {
      prompt += `## Existing Codebase (${existingFiles.length} files) — patch in place where possible\n\n`;
      for (const f of existingFiles) {
        prompt += `### ${f.path}\n\`\`\`${f.language ?? ''}\n${f.content}\n\`\`\`\n\n`;
      }
    }

    const existingFilesManifest = input.existingFilesManifest;
    if (existingFilesManifest && existingFilesManifest.length > 0) {
      prompt += `## Other files in the existing codebase (manifest only — bodies omitted to save tokens)\n\n`;
      prompt += `These files exist and MUST be preserved byte-for-byte. They are owned by other slices/phases and were excluded from the prompt because they are not relevant to the active scope.\n`;
      prompt += `Rules:\n`;
      prompt += `  • Do NOT re-emit them.\n`;
      prompt += `  • Do NOT assume they are missing — assume they exist exactly as listed.\n`;
      prompt += `  • If you reference a symbol from one of them, IMPORT by path (you can trust the path is real).\n\n`;
      const byKind: Record<string, typeof existingFilesManifest> = {};
      for (const m of existingFilesManifest) (byKind[m.kind] ??= []).push(m);
      for (const kind of Object.keys(byKind).sort()) {
        prompt += `### ${kind} (${byKind[kind].length})\n`;
        for (const m of byKind[kind]) prompt += `- ${m.path} — ${m.bytes}B / ${m.lines} lines\n`;
        prompt += `\n`;
      }
    }

    prompt += this.formatMemoriesForPrompt(memories);

    if (chunk) {
      prompt += `Emit ONLY the files for batch ${chunk.index}/${chunk.total}. The merged build will combine all batches.`;
    } else if (phase) {
      prompt += `Emit ONLY files for phase ${phaseIndex ?? 1}/${phaseTotal ?? PHASE_ORDER.length} (${phase}). Subsequent phases will handle the rest. Preserve every file in existingFiles byte-for-byte unless this phase explicitly modifies it.`;
    } else if (currentSlice) {
      prompt += `Build slice "${currentSlice.id}" only. Emit only files this slice creates or modifies, plus an updated IMPLEMENTATION_CHECKLIST.md.`;
    } else {
      prompt += iter === 1
        ? `Generate the COMPLETE codebase per the spec. Emit IMPLEMENTATION_CHECKLIST.md last.`
        : `Address the QA feedback. Emit only changed/new files plus an updated IMPLEMENTATION_CHECKLIST.md.`;
    }

    return prompt;
  }

  /**
   * Strict parser. If ANY truncation is detected (JSON wrapper unbalanced
   * OR any single file's content looks incomplete), the ENTIRE response is
   * discarded and the task is flagged for a clean retry.
   *
   * Why: previously we salvaged the "complete" subset and merged it across
   * retries. That produced inconsistent codebases (e.g. a page importing a
   * helper that the truncated retry never re-emitted because we told the
   * model it was "already done"). Consistency wins over partial yield.
   *
   * Two layers of truncation detection:
   *   1. JSON-level — unbalanced braces / unterminated strings in the
   *      wrapper (extractJSONTolerant + looksTruncated).
   *   2. File-content-level — a `{path, content}` pair parsed cleanly
   *      but the `content` itself is incomplete code (unbalanced braces,
   *      unterminated string, dangling import).
   * Either condition discards `files[]` entirely.
   */
  protected async parseOutput(raw: string, _task: Task): Promise<Record<string, unknown>> {
    const input = (_task.input ?? {}) as unknown as BuilderInput;
    // Identity for every diagnostic event below. One log line should be
    // enough to answer "which builder call produced no files?" without
    // cross-referencing other timestamps.
    const ident = {
      taskId: _task.id,
      sliceId: input.currentSlice?.id ?? null,
      sliceIndex: input.sliceIndex ?? null,
      totalSlices: input.totalSlices ?? null,
      phase: input.phase ?? null,
      phaseIndex: input.phaseIndex ?? null,
      phaseTotal: input.phaseTotal ?? null,
      chunk: input.chunk ? { index: input.chunk.index, total: input.chunk.total } : null,
      builderAttempt: input.builderAttempt ?? null,
      iteration: input.iteration ?? null,
      hasQaFeedback: !!input.qaFeedback && Object.keys(input.qaFeedback).length > 0,
      existingFilesCount: Array.isArray(input.existingFiles) ? input.existingFiles.length : 0,
      existingManifestCount: Array.isArray(input.existingFilesManifest) ? input.existingFilesManifest.length : 0,
      stack: normalizeTechStack((input.spec as Record<string, unknown> | undefined)?.techStack),
      provider: this.definition.model.provider,
      model: this.definition.model.model,
    };

    const { object, truncated, salvagedCount, salvageStopReason, source: extractSource } = extractJSONTolerant(raw);

    // Stage A — raw .files extraction (BEFORE any filtering).
    const rawFilesAny = Array.isArray(object.files) ? (object.files as unknown[]) : [];
    const rawFileCount = rawFilesAny.length;

    // Stage B — type-filter: every entry must have string `path` AND string `content`.
    // Track every drop so we can answer "why was this file ignored?".
    const typeRejects: Array<{ index: number; reason: string; pathPreview?: string }> = [];
    const allFiles: BuilderFile[] = [];
    rawFilesAny.forEach((entry, idx) => {
      if (!entry || typeof entry !== 'object') {
        typeRejects.push({ index: idx, reason: 'not-an-object' });
        return;
      }
      const f = entry as Record<string, unknown>;
      const pathOk = typeof f.path === 'string' && (f.path as string).length > 0;
      const contentOk = typeof f.content === 'string';
      if (!pathOk || !contentOk) {
        typeRejects.push({
          index: idx,
          reason: !pathOk && !contentOk ? 'missing-path-and-content'
                : !pathOk ? 'missing-or-non-string-path'
                : 'missing-or-non-string-content',
          pathPreview: typeof f.path === 'string' ? (f.path as string).slice(0, 80) : undefined,
        });
        return;
      }
      allFiles.push(f as unknown as BuilderFile);
    });

    if (typeRejects.length > 0) {
      this.logger.warn(`[builder] Dropped ${typeRejects.length}/${rawFileCount} entries failing type filter`, {
        event: 'builder:parse-type-rejects',
        ...ident,
        rejects: typeRejects.slice(0, 20),
        totalRejects: typeRejects.length,
      });
    }

    // Stage C — content-incompleteness scan (per-file looksIncompleteCode).
    const incompletePaths: string[] = [];
    const incompleteReasons: Array<{ path: string; reason: string; bytes: number }> = [];
    for (const f of allFiles) {
      const reason = looksIncompleteCode(f.content, f.path);
      if (reason) {
        incompletePaths.push(f.path);
        incompleteReasons.push({ path: f.path, reason, bytes: f.content.length });
        this.logger.warn(`[builder] File content incomplete: ${f.path} — ${reason}`, {
          event: 'builder:file-incomplete',
          path: f.path,
          reason,
          contentLength: f.content.length,
        });
      }
    }

    const wasContentTruncated = incompletePaths.length > 0;
    const willDiscard = truncated || wasContentTruncated;

    // Stage D — final decision summary. ONE log line per builder call so
    // a tail of the API logs answers: was the response empty? malformed?
    // truncated? type-filtered? content-incomplete?
    this.logger.info('[builder] parse-summary', {
      event: 'builder:parse-summary',
      ...ident,
      promptRawLength: undefined, // populated by base agent at LLM call site
      rawOutputLength: raw.length,
      jsonTruncated: truncated,
      contentTruncated: wasContentTruncated,
      salvagedCount,
      salvageStopReason,
      extractSource,
      rawFileCount,
      typeRejectCount: typeRejects.length,
      typeAcceptedCount: allFiles.length,
      incompleteCount: incompletePaths.length,
      finalFileCount: willDiscard ? 0 : allFiles.length,
      discardedCount: willDiscard ? allFiles.length : 0,
      decision: willDiscard
        ? (truncated ? 'discard:json-truncated' : 'discard:content-incomplete')
        : allFiles.length === 0
          ? (rawFileCount === 0 ? 'empty:no-files-array' : 'empty:all-rejected-by-type-filter')
          : 'keep',
    });

    if (willDiscard) {
      this.logger.warn(
        `[builder] LLM output truncated — DISCARDING ENTIRE RESPONSE (${allFiles.length} file(s) thrown away, ${incompletePaths.length} content-incomplete) — clean retry will follow`,
        {
          event: 'builder:truncated',
          ...ident,
          rawLength: raw.length,
          jsonTruncated: truncated,
          contentTruncated: wasContentTruncated,
          discardedCount: allFiles.length,
          incompleteCount: incompletePaths.length,
          incompletePaths,
        },
      );
      object.files = [];
      object._truncated = true;
      object._discardedCount = allFiles.length;
      if (incompletePaths.length > 0) object._incompletePaths = incompletePaths;
    } else {
      object.files = allFiles;
    }

    // Stash the parse-stage diagnostic on the output so `validateOutput`
    // (and `writeLastBuilderEmptyFailure`) can write the canonical dump
    // without re-parsing. Stripped from `output` if validation passes.
    object._lastEmptyDiag = {
      ident,
      rawOutputLength: raw.length,
      raw,
      rawFileCount,
      jsonTruncated: truncated,
      contentTruncated: wasContentTruncated,
      salvagedCount,
      salvageStopReason,
      extractSource,
      typeRejects,
      incompleteReasons,
      acceptedPaths: allFiles.map((f) => f.path),
      decision: willDiscard
        ? (truncated ? 'discard:json-truncated' : 'discard:content-incomplete')
        : allFiles.length === 0
          ? (rawFileCount === 0 ? 'empty:no-files-array' : 'empty:all-rejected-by-type-filter')
          : 'keep',
    };

    // Persist a full debug bundle when running diagnostics. This is the
    // single most useful artefact when a slice/phase fails: it captures
    // input identity, raw response, parse stages, and reject reasons in
    // one JSON file so we can reproduce the failure offline.
    if (process.env.DIAGNOSTIC === '1' && (willDiscard || allFiles.length === 0)) {
      void persistBuilderParseDump({
        ident,
        raw,
        rawFileCount,
        truncated,
        salvagedCount,
        typeRejects,
        incompleteReasons,
        allPaths: allFiles.map((f) => f.path),
        decision: (object.files as unknown[]).length === 0 ? 'empty' : 'kept',
      }, this.logger);
    }

    return object;
  }

  protected async validateOutput(output: Record<string, unknown>, _task: Task): Promise<void> {
    const input = (_task.input ?? {}) as unknown as BuilderInput;
    if (!Array.isArray(output.files) || output.files.length === 0) {
      this.logger.error('[builder] validation: produced no files', {
        event: 'builder:validate-empty',
        taskId: _task.id,
        sliceId: input.currentSlice?.id ?? null,
        phase: input.phase ?? null,
        phaseIndex: input.phaseIndex ?? null,
        chunk: input.chunk ? { index: input.chunk.index, total: input.chunk.total } : null,
        builderAttempt: input.builderAttempt ?? null,
        truncatedFlag: output._truncated === true,
        discardedCount: typeof output._discardedCount === 'number' ? output._discardedCount : 0,
        incompletePaths: Array.isArray(output._incompletePaths) ? output._incompletePaths : [],
      });

      // Always-on canonical "last failure" dump. Overwritten on every
      // builder-empty failure so devs can `cat` one file to inspect the
      // most recent failing call without grep'ing logs or hunting
      // timestamped diagnostic dumps.
      void writeLastBuilderEmptyFailure({
        task: _task,
        input,
        output,
        agentModel: this.definition.model.model,
        agentProvider: this.definition.model.provider,
        validationRule: 'output.files must be a non-empty array',
        validationMessage: 'Validation: builder produced no files',
        logger: this.logger,
      });

      throw new Error('Validation: builder produced no files');
    }
    for (const f of output.files as Array<Record<string, unknown>>) {
      if (typeof f.path !== 'string' || typeof f.content !== 'string') {
        throw new Error('Validation: every file requires { path, content }');
      }
    }
    // Validation passed — strip the parse-stage diagnostic so it doesn't
    // leak into downstream artefacts.
    delete output._lastEmptyDiag;
  }

  // ── Override coreExecute: add chunking + retry-on-truncation ─────

  override async coreExecute(task: Task, ctx: ExecutionContext): Promise<Task> {
    const input = task.input as unknown as BuilderInput;

    // Don't recurse: if this task is already a chunk / phase / retry
    // dispatch from us, defer to the base class.
    if (input.chunk || input.phase || input.builderAttempt) {
      return super.coreExecute(task, ctx);
    }

    // Skip the wrapper for fallback re-entries to avoid infinite recursion.
    if (input._fallbackMode) {
      return super.coreExecute(task, ctx);
    }

    const primary = await this.runPrimary(task, ctx);

    // Detect "zero usable files" — covers both an outright failure AND a
    // task that completed with an empty/discarded files array.
    const primaryFiles = ((primary.output ?? {}).files as BuilderFile[] | undefined) ?? [];
    const primaryEmpty = primary.status !== 'completed' || primaryFiles.length === 0;
    if (!primaryEmpty) return primary;

    // Snapshot what the primary attempt did so we can persist BOTH attempts
    // on the final task even if the fallback succeeds. The diagnostic dump
    // (last-builder-empty-failure.json) was already written by validateOutput.
    const primarySnapshot = {
      status: primary.status,
      errorCode: primary.error?.code ?? null,
      errorMessage: primary.error?.message ?? null,
      fileCount: primaryFiles.length,
      truncated: (primary.output as Record<string, unknown> | undefined)?._truncated === true,
      discardedCount: ((primary.output as Record<string, unknown> | undefined)?._discardedCount as number | undefined) ?? 0,
      tokensIn: primary.metadata?.tokensIn ?? 0,
      tokensOut: primary.metadata?.tokensOut ?? 0,
    };

    this.logger.warn('[builder] Primary attempts produced 0 usable files — invoking reduced-prompt fallback', {
      event: 'builder:fallback-start',
      sliceId: input.currentSlice?.id ?? null,
      sliceIndex: input.sliceIndex ?? null,
      primary: primarySnapshot,
    });

    const fallback = await this.runReducedFallback(task, ctx, primarySnapshot);

    // Stamp both attempts onto the output (or error.metadata-equivalent
    // hint via message) so the upstream pipeline has a single artefact to
    // surface in project.warnings / project.error.
    const fbOutput = (fallback.output ?? {}) as Record<string, unknown>;
    fbOutput._primaryAttempt = primarySnapshot;
    fbOutput._fallbackUsed = true;
    fallback.output = fbOutput;

    if (fallback.status !== 'completed' || (((fallback.output ?? {}).files as BuilderFile[] | undefined)?.length ?? 0) === 0) {
      // Fail the slice immediately with a clear error referencing both
      // attempts so the pipeline's fail-fast guard records the truth.
      const fbErr = fallback.error?.message ?? 'fallback returned no files';
      fallback.status = 'failed';
      fallback.error = {
        code: 'BUILDER_EMPTY_AFTER_FALLBACK',
        message:
          `Builder produced 0 files in primary attempts ` +
          `(${primarySnapshot.errorCode ?? 'no-error-code'}: ${primarySnapshot.errorMessage ?? 'completed-empty'}) ` +
          `AND in the reduced-prompt fallback (${fbErr}). Slice cannot proceed.`,
        retryable: false,
      } as unknown as Task['error'];
      this.logger.error('[builder] Fallback also produced 0 files — failing slice immediately', {
        event: 'builder:fallback-empty',
        sliceId: input.currentSlice?.id ?? null,
        primary: primarySnapshot,
        fallbackError: fbErr,
      });
      return fallback;
    }

    this.logger.info('[builder] Reduced-prompt fallback recovered the slice', {
      event: 'builder:fallback-recovered',
      sliceId: input.currentSlice?.id ?? null,
      fallbackFileCount: (((fallback.output ?? {}).files as BuilderFile[] | undefined) ?? []).length,
      primary: primarySnapshot,
    });
    return fallback;
  }

  /**
   * Original coreExecute body — runs phased / batched / retry paths. Kept
   * separate so `coreExecute` can wrap it with the reduced-prompt
   * fallback without recursing into itself.
   */
  private async runPrimary(task: Task, ctx: ExecutionContext): Promise<Task> {
    const input = task.input as unknown as BuilderInput;

    // ── Phased mode (NO slice planned) ───────────────────────
    // When the slice planner produced no feature slices, we'd otherwise
    // generate the entire codebase in one giant LLM call and hit token
    // limits — exactly what caused empty `page.tsx` stubs. Run the build
    // as five sequential phases instead, each strictly scoped.
    if (!input.currentSlice) {
      this.logger.info('[builder] No slice — running phased generation (pages → backend → components → config → polish)', {
        event: 'builder:phased-start',
        phases: PHASE_ORDER,
      });
      return this.runPhased(task, ctx);
    }

    // ── Slice mode: chunk if oversized, otherwise single call ─
    const batches = this.planBatches(input);
    if (batches && batches.length > 1) {
      this.logger.info(`[builder] Slice "${input.currentSlice?.id ?? '(none)'}" is large — splitting into ${batches.length} batches`, {
        event: 'builder:chunk',
        sliceId: input.currentSlice?.id,
        batchCount: batches.length,
        itemsPerBatch: ITEMS_PER_BATCH,
      });
      return this.runBatched(task, ctx, batches);
    }

    return this.runWithRetry(task, ctx);
  }

  /**
   * Last-resort retry with a stripped-down prompt and an explicit file
   * target list. Single LLM call, no further chunking, no further retry.
   * Returns whatever it gets — caller is responsible for failing the
   * slice if this also returns zero files.
   */
  private async runReducedFallback(
    task: Task,
    ctx: ExecutionContext,
    primarySnapshot: Record<string, unknown>,
  ): Promise<Task> {
    const baseInput = task.input as unknown as BuilderInput;
    const targetPaths = deriveFallbackTargetPaths(baseInput);

    this.logger.info(`[builder] Fallback target list: ${targetPaths.length} file(s)`, {
      event: 'builder:fallback-plan',
      sliceId: baseInput.currentSlice?.id ?? null,
      targetPaths,
    });

    const fallbackInput: BuilderInput = {
      // Strip everything except the slice and tech stack. NO existingFiles,
      // NO manifest, NO qaFeedback, NO sliceManifest, NO chunk, NO phase.
      spec: { techStack: (baseInput.spec as Record<string, unknown> | undefined)?.techStack ?? {} } as Record<string, unknown>,
      currentSlice: baseInput.currentSlice,
      iteration: baseInput.iteration ?? 1,
      _fallbackMode: true,
      _fallbackTargetPaths: targetPaths,
      _primarySnapshot: primarySnapshot,
    };

    const fallbackTask: Task = {
      ...task,
      id: `${task.id}#fallback`,
      input: fallbackInput as unknown as Record<string, unknown>,
    };

    // Single attempt. If the BaseAgent throws (validation: produced no
    // files), we catch it here so the caller sees a populated Task with
    // `status='failed'` rather than an exception.
    try {
      const result = await super.coreExecute(fallbackTask, { ...ctx, spanId: `${ctx.spanId}#fallback` });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failed: Task = {
        ...fallbackTask,
        status: 'failed',
        error: {
          code: 'BUILDER_FALLBACK_THREW',
          message,
          retryable: false,
        } as unknown as Task['error'],
        output: { files: [], _primaryAttempt: primarySnapshot, _fallbackUsed: true } as Record<string, unknown>,
      };
      return failed;
    }
  }

  /**
   * Run the full build as ordered phases. Each phase is a separate LLM
   * call that receives every previously-emitted file as `existingFiles`
   * and is instructed to emit only its own slice of the codebase.
   *
   * Phases:
   *   1. pages       — application pages/layouts/route segments (CRITICAL)
   *   2. backend     — API handlers, Prisma schema, services
   *   3. components  — shared UI, hooks, lib utilities
   *   4. config      — package.json, tsconfig, next.config, tailwind, prisma
   *   5. polish      — integration fixes (missing imports, dangling refs)
   *
   * If any phase produces zero files, subsequent phases still run — the
   * accumulated output is returned as best-effort. Phase 1 (pages) failure
   * is treated as a hard failure because nothing else makes sense without
   * it.
   */
  private async runPhased(task: Task, ctx: ExecutionContext): Promise<Task> {
    const baseInput = task.input as unknown as BuilderInput;
    const seedFiles: BuilderFile[] = Array.isArray(baseInput.existingFiles) ? [...baseInput.existingFiles] : [];
    const accumulated = new Map<string, BuilderFile>();
    for (const f of seedFiles) accumulated.set(f.path, f);

    // ── Token budget for this phased build ─────────────────────
    // Reuse a budget already attached to the execution context if one
    // exists (project-generator may pass one through). Otherwise, create
    // a default budget scoped to this phased run.
    const ctxBudget = (ctx.variables?.tokenBudget ?? null) as TokenBudget | null;
    const budget    = ctxBudget instanceof TokenBudget
      ? ctxBudget
      : new TokenBudget();
    const modelMaxTokens = this.definition.model.maxTokens;

    this.logger.info('[builder] Phased build starting with token budget', {
      event: 'builder:budget-start',
      ...budget.snapshot(),
      modelMaxTokens,
    });

    let lastTask: Task = task;

    for (let i = 0; i < PHASE_ORDER.length; i++) {
      const phase = PHASE_ORDER[i] as BudgetPhase;
      const phaseIndex = i + 1;
      const phaseTotal = PHASE_ORDER.length;

      // ── Cost-aware execution gate ────────────────────────────
      // Before spending any tokens on this phase, check the project's
      // overall budget pressure. Skip non-critical phases entirely once
      // the project is near its budget cap.
      const pressure = budget.pressureLevel();
      const decision = budget.shouldRunPhase(phase);
      if (!decision.run) {
        this.logger.warn(
          `[builder] Phase ${phaseIndex}/${phaseTotal} (${phase}) SKIPPED — ${decision.reason}`,
          {
            event: 'builder:phase-skipped',
            phase, phaseIndex,
            pressure,
            reason: decision.reason,
            totalUsed: budget.totalUsed,
            totalBudget: budget.totalBudget,
          },
        );
        continue;
      }

      // ── Estimate this phase's input + planned output ─────────
      // The prompt size is dominated by `existingFiles` (every prior
      // phase's output) and the spec dump. Output is the new files
      // for this phase; we approximate using the spec size and a
      // phase-specific factor.
      const existing = Array.from(accumulated.values());
      const existingTokens = estimateTokensFromFiles(existing);
      const specTokens     = estimateTokensFromText(JSON.stringify(baseInput.spec ?? {}));
      const promptTokens   = existingTokens + specTokens + 2_000; // overhead
      let   estimatedOutput = estimatePhaseOutputTokens(phase, baseInput, existing);

      // Under pressure, shrink the estimate so we run fewer/smaller batches.
      if (decision.degraded) {
        estimatedOutput = Math.ceil(estimatedOutput * 0.6);
      }

      const perCallCap = budget.perCallOutputLimit(phase, modelMaxTokens);
      const batchCount = decision.degraded
        ? 1 // never sub-batch in degraded mode — just produce the essentials in one call
        : budget.recommendBatchCount(phase, estimatedOutput, modelMaxTokens);

      this.logger.info(
        `[builder] Phase ${phaseIndex}/${phaseTotal} (${phase}) — pressure=${pressure}${decision.degraded ? ' (DEGRADED)' : ''}, est promptTokens=${promptTokens}, est outputTokens=${estimatedOutput}, perCallCap=${perCallCap}, batches=${batchCount}, phaseRemaining=${budget.remaining(phase)}, totalRemaining=${budget.totalRemaining}`,
        {
          event: 'builder:phase-plan',
          phase, phaseIndex, phaseTotal,
          pressure,
          degraded: decision.degraded,
          existingTokens, specTokens, estimatedOutput,
          perCallCap, batchCount,
          phaseBudget: budget.getPhase(phase).budget,
          phaseUsed:   budget.getPhase(phase).used,
          totalRemaining: budget.totalRemaining,
        },
      );

      // Trim existingFiles when the prompt is dangerously large. Pages
      // and config phases need to see less context than components/polish.
      const trimmedExisting = trimExistingForPhase(existing, phase, perCallCap);

      // Run one or more sub-batches (default: 1).
      let phaseFiles: BuilderFile[] = [];
      let phaseFailed = false;

      for (let b = 0; b < batchCount; b++) {
        const subHint = batchCount > 1
          ? `\n## SUB-BATCH ${b + 1} / ${batchCount}\nThis phase was split because its estimated output (${estimatedOutput} tokens) exceeded the per-call cap (${perCallCap}). Emit roughly 1/${batchCount} of this phase's files in this call. Spread them so each batch covers a different feature/page/area. Other batches will produce the rest.\n`
          : '';

        const degradedHint = decision.degraded
          ? `\n## ⚠ COST-AWARE DEGRADED MODE — pressure=${pressure}\n` +
            `The project has consumed ${budget.totalUsed}/${budget.totalBudget} tokens (${Math.round(100 * budget.totalUsed / budget.totalBudget)}%). ` +
            `Reduce complexity dramatically:\n` +
            `  • Focus on FUNCTIONALITY only. No UI polish, no animations, no advanced styling.\n` +
            `  • Use plain semantic HTML + minimal inline styles. Skip Tailwind / design tokens.\n` +
            `  • Cover the CORE features in the spec; drop secondary nice-to-haves.\n` +
            `  • Prefer SHORT files (~30 lines). Inline rather than extract. No abstraction layers.\n` +
            `  • Skip tests, skip exhaustive error handling, skip docstrings.\n` +
            `Goal: ship a working, navigable app within the remaining budget. Polish is forfeit.\n`
          : '';

        const phaseInput: BuilderInput = {
          ...baseInput,
          existingFiles: trimmedExisting,
          phase,
          phaseIndex,
          phaseTotal,
          // Append the sub-batch + degraded hints to the truncation hint
          // slot so they appear at the top of the prompt.
          _truncationHint: (subHint || degradedHint)
            ? (baseInput._truncationHint ?? '') + degradedHint + subHint
            : baseInput._truncationHint,
        };
        const phaseTask: Task = {
          ...task,
          id: `${task.id}#p${phaseIndex}-${phase}${batchCount > 1 ? `-b${b + 1}` : ''}`,
          input: phaseInput as unknown as Record<string, unknown>,
        };

        // Per-call maxTokens override via ctx.variables.modelOverride.
        const phaseCtx: ExecutionContext = {
          ...ctx,
          spanId: `${ctx.spanId}#p${phaseIndex}${batchCount > 1 ? `b${b + 1}` : ''}`,
          variables: {
            ...(ctx.variables ?? {}),
            modelOverride: { maxTokens: perCallCap },
            tokenBudget: budget,
          },
        };

        const result = await this.runWithRetry(phaseTask, phaseCtx);
        lastTask = result;

        // Record actual usage from result.metadata if present.
        const meta = (result.metadata ?? {}) as { tokensIn?: number; tokensOut?: number };
        if (typeof meta.tokensIn === 'number' || typeof meta.tokensOut === 'number') {
          budget.record(phase, meta.tokensIn ?? 0, meta.tokensOut ?? 0);
        }

        const files = ((result.output ?? {}).files as BuilderFile[] | undefined) ?? [];
        if (result.status !== 'completed' || files.length === 0) {
          phaseFailed = true;
          this.logger.error(
            `[builder] Phase ${phaseIndex}/${phaseTotal} (${phase})${batchCount > 1 ? ` batch ${b + 1}/${batchCount}` : ''} produced no files`,
            { event: 'builder:phase-empty', phase, phaseIndex, batch: b + 1, error: result.error?.message },
          );
          continue;
        }
        phaseFiles = phaseFiles.concat(files);

        // Stop sub-batching early if the phase budget is exhausted.
        if (budget.remaining(phase) <= 0) {
          this.logger.warn(
            `[builder] Phase ${phaseIndex}/${phaseTotal} (${phase}) exhausted its token budget after batch ${b + 1}/${batchCount}`,
            { event: 'builder:phase-exhausted', phase, batch: b + 1, batchCount },
          );
          break;
        }
      }

      if (phaseFiles.length === 0) {
        // Hard fail on skeleton OR pages — both are load-bearing.
        if (phase === 'skeleton' || phase === 'pages') {
          lastTask.status = 'failed';
          lastTask.error = lastTask.error ?? ({
            code: phase === 'skeleton' ? 'BUILDER_PHASE_SKELETON_EMPTY' : 'BUILDER_PHASE_PAGES_EMPTY',
            message: `${phase} phase produced no files — cannot continue phased build`,
            retryable: true,
          } as unknown as Task['error']);
          return lastTask;
        }
        continue;
      }

      // ── Fail-fast post-phase validation ─────────────────────
      // Run ALL applicable validators against the merged codebase. If any
      // problem is detected, send the issue list back to the builder for
      // an in-phase repair pass. After MAX_REPAIR_ATTEMPTS the build aborts
      // so we don't compound errors across phases.
      let attempt = 0;
      while (attempt <= MAX_PHASE_REPAIR_ATTEMPTS) {
        const allSoFar = mergeFiles(Array.from(accumulated.values()), phaseFiles);
        const issues = validatePhaseOutput(phase, allSoFar);
        if (issues.length === 0) break;

        this.logger.error(
          `[builder] Phase ${phaseIndex}/${phaseTotal} (${phase}) failed validation (attempt ${attempt + 1}/${MAX_PHASE_REPAIR_ATTEMPTS + 1}): ${issues.length} issue(s)`,
          {
            event: 'builder:phase-validation-failed',
            phase, phaseIndex,
            attempt: attempt + 1,
            issueCount: issues.length,
            issues: issues.map(i => ({ severity: i.severity, code: i.code, message: i.message, file: i.file })),
          },
        );

        const blockers = issues.filter(i => i.severity === 'blocker');

        // No more repair attempts left → abort the build.
        if (attempt >= MAX_PHASE_REPAIR_ATTEMPTS) {
          // For non-load-bearing phases, allow soft failures (warnings only)
          // to pass through — we don't want polish quirks to abort the build.
          if (blockers.length === 0 && phase !== 'skeleton' && phase !== 'pages') {
            this.logger.warn(
              `[builder] Phase ${phaseIndex}/${phaseTotal} (${phase}) has ${issues.length} non-blocking issue(s) after repair attempts — proceeding with warnings`,
              { event: 'builder:phase-warnings', phase, issues: issues.map(i => i.message) },
            );
            break;
          }
          lastTask.status = 'failed';
          lastTask.error = {
            code: `BUILDER_PHASE_${phase.toUpperCase()}_INVALID`,
            message:
              `Phase ${phase} failed validation after ${MAX_PHASE_REPAIR_ATTEMPTS} repair attempt(s): ` +
              issues.slice(0, 3).map(i => `[${i.severity}] ${i.message}`).join('; ') +
              (issues.length > 3 ? ` (+ ${issues.length - 3} more)` : ''),
            retryable: true,
          } as unknown as Task['error'];
          return lastTask;
        }

        // Repair pass — send the issue list back to the builder.
        attempt++;
        this.logger.warn(
          `[builder] Phase ${phaseIndex}/${phaseTotal} (${phase}) requesting repair (attempt ${attempt}/${MAX_PHASE_REPAIR_ATTEMPTS}): ${blockers.length} blocker(s), ${issues.length - blockers.length} warning(s)`,
          { event: 'builder:phase-repair-start', phase, attempt, blockers: blockers.length },
        );

        const repairFiles = await this.runPhaseRepair(
          task, ctx, phase, phaseIndex, phaseTotal,
          allSoFar, issues, budget, modelMaxTokens, attempt,
        );
        if (repairFiles.length === 0) {
          this.logger.error(
            `[builder] Phase ${phaseIndex}/${phaseTotal} (${phase}) repair attempt ${attempt} produced no files`,
            { event: 'builder:phase-repair-empty', phase, attempt },
          );
          // Keep looping — next iteration will hit MAX_PHASE_REPAIR_ATTEMPTS.
          continue;
        }
        // Merge repaired files into the phase output. Newer wins.
        const merged = new Map<string, BuilderFile>();
        for (const f of phaseFiles) merged.set(f.path, f);
        for (const f of repairFiles) merged.set(f.path, f);
        phaseFiles = Array.from(merged.values());

        this.logger.info(
          `[builder] Phase ${phaseIndex}/${phaseTotal} (${phase}) repair attempt ${attempt} merged ${repairFiles.length} file(s)`,
          { event: 'builder:phase-repair-done', phase, attempt, repaired: repairFiles.length },
        );
      }

      for (const f of phaseFiles) accumulated.set(f.path, f);
      this.logger.info(
        `[builder] Phase ${phaseIndex}/${phaseTotal} (${phase}) emitted ${phaseFiles.length} file(s) — total now ${accumulated.size}, phaseUsed=${budget.getPhase(phase).used}/${budget.getPhase(phase).budget}, totalUsed=${budget.totalUsed}/${budget.totalBudget}`,
        {
          event: 'builder:phase-done',
          phase, phaseIndex,
          phaseFiles: phaseFiles.length,
          cumulative: accumulated.size,
          phaseUsed: budget.getPhase(phase).used,
          phaseBudget: budget.getPhase(phase).budget,
          totalUsed: budget.totalUsed,
          totalBudget: budget.totalBudget,
          partial: phaseFailed,
        },
      );

      // Hard stop if the overall budget is exhausted.
      if (budget.isExhausted()) {
        this.logger.warn(
          `[builder] Total token budget exhausted after phase ${phase} (${budget.totalUsed}/${budget.totalBudget}). Skipping remaining phases.`,
          { event: 'builder:budget-exhausted', ...budget.snapshot() },
        );
        break;
      }
    }

    this.logger.info('[builder] Phased build complete', {
      event: 'builder:budget-end',
      ...budget.snapshot(),
    });

    // Strip the seedFiles back out — they were existingFiles, not output.
    const seedPaths = new Set(seedFiles.map(f => f.path));
    const emitted = Array.from(accumulated.values()).filter(f => {
      // Keep files that were either newly emitted OR re-emitted (changed)
      // by a phase. Files identical to the seed are dropped — the orchestrator
      // already has them in previousFiles.
      const seed = seedFiles.find(s => s.path === f.path);
      return !seed || seed.content !== f.content || !seedPaths.has(f.path);
    });

    lastTask.status = 'completed';
    lastTask.output = {
      files: emitted.length > 0 ? emitted : Array.from(accumulated.values()),
      _phased: true,
      _phaseCount: PHASE_ORDER.length,
      _budget: budget.snapshot(),
    };
    lastTask.completedAt = new Date();
    lastTask.error = undefined;
    return lastTask;
  }

  /**
   * Send the validation issue list back to the builder and ask it to
   * repair the offending files only. The repair pass:
   *   • does NOT advance to the next phase
   *   • is exempt from sub-batching (always one call)
   *   • uses the same per-call cap as the phase
   *   • returns ONLY the repaired files (caller merges them)
   */
  private async runPhaseRepair(
    task: Task,
    ctx: ExecutionContext,
    phase: BudgetPhase,
    phaseIndex: number,
    phaseTotal: number,
    currentFiles: BuilderFile[],
    issues: PhaseIssue[],
    budget: TokenBudget,
    modelMaxTokens: number,
    attempt: number,
  ): Promise<BuilderFile[]> {
    const baseInput = task.input as unknown as BuilderInput;

    const issueList = issues
      .map((i, idx) => `  ${idx + 1}. [${i.severity.toUpperCase()}] ${i.code}${i.file ? ` — ${i.file}` : ''}: ${i.message}`)
      .join('\n');

    const offendingPaths = Array.from(new Set(issues.map(i => i.file).filter((f): f is string => !!f)));

    const repairHint =
      `\n## 🔧 PHASE ${phase.toUpperCase()} VALIDATION FAILED — REPAIR PASS ${attempt}/${MAX_PHASE_REPAIR_ATTEMPTS}\n` +
      `The previous output for this phase has the following ${issues.length} issue(s):\n` +
      `${issueList}\n\n` +
      `Repair instructions:\n` +
      `  • Emit ONLY the files needed to FIX the issues above. Do NOT re-emit unrelated files.\n` +
      `  • Each emitted file must be COMPLETE and SYNTACTICALLY VALID — no truncation, no "...", no TODO.\n` +
      `  • Preserve every other file in the existing codebase as-is.\n` +
      `  • If an issue says a file is missing, CREATE it. If a file is broken, REPLACE it in full.\n` +
      `  • Do not introduce new dependencies or stack changes.\n` +
      (offendingPaths.length > 0
        ? `  • Files most likely needing fixes: ${offendingPaths.slice(0, 8).map(p => `\`${p}\``).join(', ')}\n`
        : '') +
      `\nFailing the repair will abort the build. Take this seriously.\n`;

    // Use the existing phase per-call cap; repair runs as a single call.
    const perCallCap = budget.perCallOutputLimit(phase, modelMaxTokens);

    const repairInput: BuilderInput = {
      ...baseInput,
      existingFiles: currentFiles,
      phase,
      phaseIndex,
      phaseTotal,
      _truncationHint: (baseInput._truncationHint ?? '') + repairHint,
    };

    const repairTask: Task = {
      ...task,
      id: `${task.id}#p${phaseIndex}-${phase}-repair${attempt}`,
      input: repairInput as unknown as Record<string, unknown>,
    };

    const repairCtx: ExecutionContext = {
      ...ctx,
      spanId: `${ctx.spanId}#p${phaseIndex}-repair${attempt}`,
      variables: {
        ...(ctx.variables ?? {}),
        modelOverride: { maxTokens: perCallCap },
        tokenBudget: budget,
      },
    };

    const result = await this.runWithRetry(repairTask, repairCtx);
    if (result.status !== 'completed') return [];
    const out = (result.output ?? {}) as Record<string, unknown>;
    const files = Array.isArray(out.files) ? (out.files as BuilderFile[]) : [];
    return files;
  }

  /**
   * Run one builder pass with up to MAX_BUILDER_ATTEMPTS clean retries.
   *
   * Policy: when the previous attempt was truncated, we DISCARD its output
   * and retry with the same prompt plus a "be more concise / cap output"
   * hint. We never merge salvaged files across attempts — partial yield
   * produces inconsistent codebases (orphan imports, missing types, etc.).
   * Either an attempt completes cleanly or we surface failure so the
   * caller (phased build, slice loop) can react.
   */
  private async runWithRetry(task: Task, ctx: ExecutionContext): Promise<Task> {
    const baseInput = task.input as unknown as BuilderInput;
    let lastTask: Task = task;

    for (let attempt = 1; attempt <= MAX_BUILDER_ATTEMPTS; attempt++) {
      const attemptInput: BuilderInput = { ...baseInput, builderAttempt: attempt };
      if (attempt > 1) {
        attemptInput._truncationHint = buildTruncationHint(lastTask, /* salvaged */ 0, /* incomplete */ []);
        // Explicit policy: previous attempt was DISCARDED in full. Do not
        // pretend any files are "already emitted" — that caused the model
        // to skip dependencies and ship orphan imports.
        delete (attemptInput as { _alreadyEmitted?: string[] })._alreadyEmitted;
        delete (attemptInput as { _incompletePaths?: string[] })._incompletePaths;
        this.recordRetry();
        this.logger.warn(`[builder] Retry attempt ${attempt}/${MAX_BUILDER_ATTEMPTS} (clean — previous response discarded)`, {
          event: 'builder:retry',
          attempt,
          maxAttempts: MAX_BUILDER_ATTEMPTS,
          reason: lastTask.error?.code ?? 'truncation',
          message: lastTask.error?.message,
        });
      }

      const attemptTask: Task = { ...task, input: attemptInput as unknown as Record<string, unknown>, attempt };
      const result = await super.coreExecute(attemptTask, { ...ctx, attempt });
      lastTask = result;

      if (result.status === 'completed') {
        const out = (result.output ?? {}) as Record<string, unknown>;
        const truncated = out._truncated === true;
        const files = (out.files as BuilderFile[] | undefined) ?? [];

        if (!truncated && files.length > 0) {
          // Clean output — strip internal flags and return.
          delete out._truncated;
          delete out._discardedCount;
          delete out._incompletePaths;
          delete out._salvagedCount;
          return result;
        }

        // Truncated (or empty after discard) — retry with a fresh attempt.
        this.logger.warn(`[builder] Attempt ${attempt} discarded — retrying cleanly`, {
          event: 'builder:discard-and-retry',
          attempt,
          discarded: typeof out._discardedCount === 'number' ? out._discardedCount : 0,
        });
        continue;
      }

      // Hard failure (LLM error / parse failure / validation). Retry only if
      // it looks like a truncation-class failure — otherwise surface immediately.
      const errMsg = lastTask.error?.message ?? '';
      const looksLikeTruncation = /truncat|incomplete|builder produced no files|Failed to extract JSON/i.test(errMsg);
      if (!looksLikeTruncation) {
        return lastTask;
      }
    }

    // All attempts exhausted with truncation. DO NOT synthesize a salvaged
    // result — return the failure so the upstream phased/slice handler can
    // decide whether to retry the phase or fall back. Consistency over yield.
    this.logger.error(`[builder] All ${MAX_BUILDER_ATTEMPTS} attempts truncated — surfacing failure (no salvage merge)`, {
      event: 'builder:exhausted-truncated',
    });
    if (lastTask.status === 'completed') {
      // Override an empty/discarded "completed" task into a real failure so
      // upstream doesn't proceed with zero files.
      lastTask.status = 'failed';
      lastTask.error = {
        code: 'BUILDER_TRUNCATED_EXHAUSTED',
        message: `Builder produced truncated output on all ${MAX_BUILDER_ATTEMPTS} attempts; no consistent file set could be obtained.`,
        retryable: true,
      } as unknown as Task['error'];
    }
    return lastTask;
  }

  /**
   * Run one LLM call per batch, merging file outputs. If any individual
   * batch fails, runWithRetry is used for that batch so a single truncated
   * batch doesn't fail the entire slice.
   */
  private async runBatched(task: Task, ctx: ExecutionContext, batches: BuilderChunkHint[]): Promise<Task> {
    const baseInput = task.input as unknown as BuilderInput;
    const allFiles = new Map<string, BuilderFile>();
    let lastTask: Task = task;
    let anyFailed = false;

    for (const batch of batches) {
      const batchInput: BuilderInput = { ...baseInput, chunk: batch };
      const batchTask: Task = {
        ...task,
        id: `${task.id}#b${batch.index}`,
        input: batchInput as unknown as Record<string, unknown>,
      };
      this.logger.info(`[builder] Running batch ${batch.index}/${batch.total}`, {
        event: 'builder:chunk-start',
        batchIndex: batch.index,
        batchTotal: batch.total,
        scope: batch.scope,
      });

      const result = await this.runWithRetry(batchTask, { ...ctx, spanId: `${ctx.spanId}#b${batch.index}` });
      lastTask = result;

      if (result.status !== 'completed') {
        anyFailed = true;
        this.logger.error(`[builder] Batch ${batch.index}/${batch.total} failed after retries`, {
          event: 'builder:chunk-failed',
          batchIndex: batch.index,
          error: result.error?.message,
        });
        // Continue with remaining batches — partial output is better than nothing.
        continue;
      }

      const files = ((result.output ?? {}).files as BuilderFile[] | undefined) ?? [];
      for (const f of files) allFiles.set(f.path, f);
      this.logger.info(`[builder] Batch ${batch.index}/${batch.total} produced ${files.length} files (cumulative: ${allFiles.size})`, {
        event: 'builder:chunk-done',
        batchIndex: batch.index,
        batchFiles: files.length,
        cumulative: allFiles.size,
      });
    }

    if (allFiles.size === 0) {
      // Nothing usable — let the orchestrator see a failure.
      lastTask.status = 'failed';
      lastTask.error = lastTask.error ?? {
        code: 'BUILDER_BATCHED_EMPTY',
        message: 'All builder batches failed to produce files',
        retryable: true,
      } as unknown as Task['error'];
      return lastTask;
    }

    lastTask.status = 'completed';
    lastTask.output = {
      files: Array.from(allFiles.values()),
      _batched: true,
      _batchCount: batches.length,
      _batchPartial: anyFailed,
    };
    lastTask.completedAt = new Date();
    lastTask.error = undefined;
    return lastTask;
  }

  /**
   * Decide whether `input.currentSlice` is large enough to chunk, and if so
   * how to split its deliverables. Returns null when no chunking is needed.
   */
  private planBatches(input: BuilderInput): BuilderChunkHint[] | null {
    const slice = input.currentSlice;
    if (!slice) return null;
    const routes = slice.routes ?? [];
    const apiIds = slice.apiIds ?? [];
    const dbTables = slice.dbTables ?? [];
    const components = slice.components ?? [];
    const total = routes.length + apiIds.length + dbTables.length + components.length;
    if (total <= LARGE_SLICE_THRESHOLD) return null;

    // Distribute items round-robin into N batches of ~ITEMS_PER_BATCH.
    const batchCount = Math.max(2, Math.ceil(total / ITEMS_PER_BATCH));
    const buckets: BuilderChunkHint['scope'][] = Array.from({ length: batchCount }, () => ({
      routes: [], apiIds: [], dbTables: [], components: [],
    }));
    routes.forEach((r, i) => buckets[i % batchCount].routes.push(r));
    apiIds.forEach((r, i) => buckets[i % batchCount].apiIds.push(r));
    dbTables.forEach((r, i) => buckets[i % batchCount].dbTables.push(r));
    components.forEach((r, i) => buckets[i % batchCount].components.push(r));

    return buckets.map((scope, i) => ({ index: i + 1, total: batchCount, scope }));
  }

  // ── Memory ───────────────────────────────────────────────────────

  protected async extractLearnings(task: Task, output: Record<string, unknown>): Promise<MemoryEntry[]> {
    const files = (output.files as Array<{ path: string }>) ?? [];
    const input = task.input as unknown as BuilderInput;
    const iter = input.iteration ?? 1;
    const tags = ['builder'];
    if (output._batched) tags.push('chunked');
    if (output._phased) tags.push('phased');
    if (output._bestEffort) tags.push('best-effort');
    if (iter > 1) tags.push('qa-loop');
    return [{
      agentRole: 'builder',
      type: 'pattern',
      content: iter > 1
        ? `Re-build iteration ${iter}: produced ${files.length} files in response to QA feedback.`
        : `Initial build: ${files.length} files generated${output._phased ? ` across ${output._phaseCount as number} phases` : output._batched ? ` across ${output._batchCount as number} batches` : ''}.`,
      relevanceScore: 0.7,
      tags,
      metadata: {
        iteration: iter,
        fileCount: files.length,
        batched: output._batched === true,
        batchCount: output._batchCount,
        phased: output._phased === true,
        phaseCount: output._phaseCount,
        bestEffort: output._bestEffort === true,
      },
    } as unknown as MemoryEntry];
  }
}

// ── helpers ────────────────────────────────────────────────────────

function mergeFiles(prior: BuilderFile[], next: BuilderFile[]): BuilderFile[] {
  const map = new Map<string, BuilderFile>();
  for (const f of prior) map.set(f.path, f);
  // Newer entries win — the LLM may have re-emitted a previously-truncated file.
  for (const f of next) map.set(f.path, f);
  return Array.from(map.values());
}

/**
 * File-content-level truncation detector. Returns a non-empty reason
 * string when the content of a file looks incomplete, or `null` when it
 * looks fine.
 *
 * Detects:
 *   - Code files (.ts/.tsx/.js/.jsx/.mjs/.cjs/.json/.css)
 *       • Unbalanced { } [ ] ( )
 *       • Unterminated string / template literal
 *       • Dangling `import x from` with no `;`
 *       • Trailing comma + unclosed array/object
 *   - TSX/JSX
 *       • Unmatched JSX open vs close tags (excluding self-closing)
 *   - JSON files
 *       • Final char is not `}` / `]` after trim
 *
 * Markdown / plain-text files are always considered complete.
 */
function looksIncompleteCode(content: string, path: string): string | null {
  const trimmed = content.replace(/\s+$/u, '');
  if (trimmed.length === 0) return 'file is empty';

  const ext = (path.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
  const isCode = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext);
  const isTsx  = ext === 'tsx' || ext === 'jsx';
  const isJson = ext === 'json';
  const isCss  = ext === 'css' || ext === 'scss' || ext === 'less';

  if (!isCode && !isJson && !isCss) return null; // md / txt / etc.

  // Walk the content tracking brace/paren/bracket depth + string state.
  let curly = 0, square = 0, paren = 0;
  let inSingle = false, inDouble = false, inBacktick = false;
  let inLineComment = false, inBlockComment = false;
  let escape = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];
    if (escape) { escape = false; continue; }
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') { inBlockComment = false; i++; }
      continue;
    }
    if (inSingle) {
      if (ch === '\\') { escape = true; continue; }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inBacktick) {
      if (ch === '\\') { escape = true; continue; }
      if (ch === '`') inBacktick = false;
      continue;
    }
    if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (ch === "'")  { inSingle = true; continue; }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === '`') { inBacktick = true; continue; }
    if (ch === '{') curly++;
    else if (ch === '}') curly--;
    else if (ch === '[') square++;
    else if (ch === ']') square--;
    else if (ch === '(') paren++;
    else if (ch === ')') paren--;
  }

  if (inSingle || inDouble) return 'unterminated string literal';
  if (inBacktick)           return 'unterminated template literal';
  if (inBlockComment)       return 'unterminated block comment';
  if (curly  !== 0)         return `unbalanced braces (${curly > 0 ? `${curly} unclosed` : `${-curly} extra`})`;
  if (square !== 0)         return `unbalanced brackets (${square > 0 ? `${square} unclosed` : `${-square} extra`})`;
  if (paren  !== 0)         return `unbalanced parens (${paren > 0 ? `${paren} unclosed` : `${-paren} extra`})`;

  // JSON-specific: the trimmed content must end in `}` or `]`.
  if (isJson && !/[\}\]]\s*$/.test(trimmed)) {
    return 'JSON does not end with } or ]';
  }

  // TSX/JSX heuristic: count opening vs closing tags. Self-closing (`/>`)
  // and HTML void elements are excluded. False positives are possible but
  // the threshold (>2 mismatched) keeps it conservative.
  if (isTsx) {
    const opens  = (content.match(/<([A-Za-z][A-Za-z0-9]*)\b(?![^>]*\/>)[^>]*>/g) ?? []).length;
    const closes = (content.match(/<\/[A-Za-z][A-Za-z0-9]*\s*>/g) ?? []).length;
    if (opens - closes > 2) return `unbalanced JSX tags (${opens} open, ${closes} close)`;
  }

  // Dangling import statement — cut off mid-`from "..."`.
  //
  // Tightened to avoid false positives on ASI-style code (semicolon-less
  // imports are valid JS/TS). We only flag when the tail looks OBVIOUSLY
  // truncated mid-clause, i.e. ends with `,` `{` `from` or a bare
  // identifier without a closing string. A complete `import x from 'y'`
  // (semicolon or not) ends with a closing quote `'` or `"` and is fine.
  if (isCode) {
    const lastImport = content.lastIndexOf('\nimport ');
    const startIdx = lastImport === -1 && content.startsWith('import ')
      ? 0
      : lastImport === -1 ? -1 : lastImport + 1;
    if (startIdx !== -1) {
      const tail = content.slice(startIdx).trimEnd();
      // Must look like a single-line/multiline `import ...` statement with
      // no semicolon AND no closing quote on the last non-empty line.
      const lastLine = tail.split('\n').pop()!.trimEnd();
      const hasSemi = /;\s*$/.test(tail);
      const endsWithCloser = /['"`]\s*$/.test(lastLine) || /[)\]}]\s*$/.test(lastLine);
      const looksMidClause = /,\s*$/.test(lastLine) || /\{\s*$/.test(lastLine) || /\bfrom\s*$/.test(lastLine);
      if (!hasSemi && !endsWithCloser && looksMidClause) {
        return 'dangling import statement';
      }
    }
  }

  return null;
}

/**
 * Derive a small, explicit list of file paths the LLM MUST emit during
 * the reduced-prompt fallback. Conservative on purpose — prefer one
 * working page over five empty stubs.
 *
 * Priority:
 *   1. The slice's frontend routes (app/<route>/page.tsx)
 *   2. One simple component if the slice declares any
 *   3. One API route if the slice declares apiIds
 *   4. As a last resort: app/page.tsx (every Next.js project needs it)
 */
function deriveFallbackTargetPaths(input: BuilderInput): string[] {
  const paths: string[] = [];
  const slice = input.currentSlice;

  const routeToPagePath = (route: string): string => {
    const trimmed = route.replace(/^\/+|\/+$/g, '');
    if (trimmed === '' || trimmed === '/') return 'app/page.tsx';
    return `app/${trimmed}/page.tsx`;
  };

  if (slice) {
    for (const r of (slice.routes ?? []).slice(0, 2)) {
      paths.push(routeToPagePath(r));
    }
    const firstComponent = (slice.components ?? [])[0];
    if (firstComponent && /^[A-Za-z][\w-]*$/.test(firstComponent)) {
      paths.push(`components/${firstComponent}.tsx`);
    }
    const firstApi = (slice.apiIds ?? [])[0];
    if (firstApi && /^[A-Za-z][\w./-]*$/.test(firstApi)) {
      const seg = firstApi.replace(/^\/+|\/+$/g, '');
      paths.push(`app/api/${seg}/route.ts`);
    }
  }

  if (paths.length === 0) paths.push('app/page.tsx');
  return Array.from(new Set(paths)).slice(0, 4);
}

/**
 * Build a precise retry hint that tells the LLM what mode to operate in.
 * Combines the underlying error code with concrete file lists so the next
 * attempt has actionable instructions instead of a generic "try again".
 */
function buildTruncationHint(
  lastTask: Task,
  alreadyEmittedCount: number,
  incompletePaths: string[],
): string {
  const reason = lastTask.error?.message ?? 'previous response was incomplete';
  const mode = alreadyEmittedCount > 0 && incompletePaths.length === 0
    ? 'CONTINUE FROM LAST VALID FILE'
    : alreadyEmittedCount === 0 && incompletePaths.length > 0
    ? 'REGENERATE THE INCOMPLETE FILES'
    : alreadyEmittedCount > 0 && incompletePaths.length > 0
    ? 'CONTINUE + REGENERATE INCOMPLETE'
    : 'GENERATE ONLY MISSING FILES';

  const parts: string[] = [];
  parts.push(`Reason: ${reason}`);
  parts.push(`Mode: ${mode}`);
  if (alreadyEmittedCount > 0) {
    parts.push(`Already-complete files: ${alreadyEmittedCount} (listed below — do NOT regenerate).`);
  }
  if (incompletePaths.length > 0) {
    parts.push(`Files cut off mid-content: ${incompletePaths.length} (listed below — regenerate fully).`);
  }
  parts.push('Output must be valid JSON. Close every brace, bracket, and string. If running out of room, emit FEWER complete files rather than many half-finished ones.');
  return parts.join(' ');
}

/**
 * Skeleton-phase output validator. Returns a non-empty reason string when
 * the output is NOT a runnable minimum app, or `null` when it is.
 *
 * The contract: after this phase, `npm install && npm run dev` must
 * succeed and serve at least two reachable routes. Every later phase
 * builds on top.
 */
function validateSkeletonPhaseOutput(files: BuilderFile[]): string | null {
  // 1. package.json must exist and be parseable JSON with a `dev` script.
  const pkg = files.find((f) => /^package\.json$/i.test(f.path));
  if (!pkg) return 'no package.json was emitted';
  let parsed: { scripts?: Record<string, string>; dependencies?: Record<string, string> } | null = null;
  try {
    parsed = JSON.parse(pkg.content);
  } catch {
    return 'package.json is not valid JSON';
  }
  if (!parsed || typeof parsed !== 'object') return 'package.json did not parse to an object';
  if (!parsed.scripts || typeof parsed.scripts.dev !== 'string') {
    return 'package.json is missing a `dev` script';
  }

  // 2. A stack config (next.config.* OR vite.config.*) must exist.
  const stackConfig = files.find((f) =>
    /^(next\.config|vite\.config)\.(js|mjs|ts|cjs)$/i.test(f.path),
  );
  if (!stackConfig) return 'no stack config (next.config.* or vite.config.*) was emitted';

  // 3. Root layout must exist (App Router) OR _app.tsx (Pages Router) OR main.tsx (Vite).
  const hasLayout = files.some((f) =>
    /^(src\/)?app\/layout\.(tsx|jsx)$/i.test(f.path)
    || /^(src\/)?pages\/_app\.(tsx|jsx)$/i.test(f.path)
    || /^src\/main\.(tsx|jsx)$/i.test(f.path),
  );
  if (!hasLayout) return 'no root layout (src/app/layout.tsx, _app.tsx, or main.tsx) was emitted';

  // 4. Entry-point page.
  const homePage = files.find((f) =>
    /^(src\/)?app\/page\.(tsx|jsx)$/i.test(f.path)
    || /^(src\/)?pages\/index\.(tsx|jsx)$/i.test(f.path),
  );
  if (!homePage) return 'no entry-point page (src/app/page.tsx or src/pages/index.tsx) was emitted';
  if (homePage.content.trim().length < 200) return `entry-point page is too small (${homePage.content.trim().length} chars) — likely a stub`;
  if (/scaffolded by the runtime fallback|This page was scaffolded/i.test(homePage.content)) {
    return 'entry-point page contains the runtime-fallback marker';
  }

  // 5. At least one additional route must exist (proves routing works).
  const otherRoutes = files.filter((f) => {
    if (f.path === homePage.path) return false;
    return /^(src\/)?app\/.+\/page\.(tsx|jsx)$/i.test(f.path)
        || /^(src\/)?pages\/(?!_app|_document|index).+\.(tsx|jsx)$/i.test(f.path);
  });
  if (otherRoutes.length === 0) return 'no second route emitted — routing cannot be proven';

  // 6. Every emitted file must pass the per-content truncation check.
  for (const f of files) {
    const reason = looksIncompleteCode(f.content, f.path);
    if (reason) return `file ${f.path} is incomplete (${reason})`;
  }

  return null;
}

/**
 * Pages-phase output validator. Returns a non-empty reason string when
 * the output is invalid (missing entry point, only fallback stubs, no
 * navigation), or `null` when the output is acceptable.
 *
 * The contract: even if every later phase fails, the user must be able
 * to load `/` and click around. This function enforces that.
 */
function validatePagesPhaseOutput(files: BuilderFile[]): string | null {
  const FALLBACK_MARKERS = [
    /scaffolded by the runtime fallback/i,
    /Replace it with your real homepage/i,
    /This page was scaffolded/i,
  ];
  const isFallback = (c: string): boolean => FALLBACK_MARKERS.some((re) => re.test(c));
  const isStub = (c: string): boolean => {
    const trimmed = c.trim();
    if (trimmed.length < 400) {
      // Reject "Welcome" / "Hello world" stubs that have no interactivity
      // and no internal links.
      const hasNav = /<a |next\/link|<Link|href=/i.test(c);
      const hasInteractivity = /useState|onClick|onSubmit|<form/i.test(c);
      if (!hasNav && !hasInteractivity) return true;
    }
    return false;
  };

  // 1. Find the entry-point page. Accept both App Router and Pages Router.
  const homePage = files.find(
    (f) =>
      /^src\/app\/page\.(tsx|jsx)$/i.test(f.path)
      || /^src\/pages\/index\.(tsx|jsx)$/i.test(f.path)
      || /^app\/page\.(tsx|jsx)$/i.test(f.path)
      || /^pages\/index\.(tsx|jsx)$/i.test(f.path),
  );
  if (!homePage) {
    return 'no entry-point page (src/app/page.tsx or src/pages/index.tsx) was emitted';
  }
  if (isFallback(homePage.content)) {
    return `the entry-point page (${homePage.path}) is a runtime-fallback placeholder`;
  }
  if (isStub(homePage.content)) {
    return `the entry-point page (${homePage.path}) is a near-empty stub (${homePage.content.length} chars, no nav, no interactivity)`;
  }

  // 2. Require navigation. Either a layout.tsx or the home page itself
  //    must contain at least 2 <Link> / <a href="/..."> references.
  const navSources = files.filter((f) =>
    /^(src\/)?app\/layout\.(tsx|jsx)$/i.test(f.path)
    || /^(src\/)?app\/_nav\.(tsx|jsx)$/i.test(f.path)
    || f.path === homePage.path,
  );
  const linkCount = navSources.reduce((acc, f) => {
    const matches = f.content.match(/(<Link\s|<a\s+href=|next\/link)/g);
    return acc + (matches?.length ?? 0);
  }, 0);
  if (linkCount < 2) {
    return `no navigation detected (only ${linkCount} <Link>/<a href> reference across layout + home)`;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Generic post-phase validation — runs after EVERY phase
// ─────────────────────────────────────────────────────────────────────

/**
 * A single problem found by the post-phase validator.
 *
 *   severity 'blocker' — build cannot continue. Pipeline aborts after
 *                       MAX_PHASE_REPAIR_ATTEMPTS.
 *   severity 'warning' — non-fatal for non-load-bearing phases. Logged
 *                       but allowed to pass after repair attempts exhaust.
 */
interface PhaseIssue {
  severity: 'blocker' | 'warning';
  code: string;
  message: string;
  /** Optional file path the issue applies to (for repair targeting). */
  file?: string;
}

/**
 * Run the full validation suite against the merged codebase after a phase
 * completes. The checks below mirror the user's intent:
 *
 *   1. Does the app still compile?     → looksIncompleteCode on every file
 *   2. Are pages still present?        → entry-point page must exist & not stub
 *   3. Are critical files missing?     → skeleton contract still satisfied
 *
 * The same validators run after every phase, not just skeleton/pages — so
 * a later phase that accidentally truncates a page or removes a config
 * file is caught immediately instead of compounding into the next phase.
 */
function validatePhaseOutput(phase: BudgetPhase, files: BuilderFile[]): PhaseIssue[] {
  const issues: PhaseIssue[] = [];

  // ── 1. Compile check — every file must be syntactically complete ──
  for (const f of files) {
    const reason = looksIncompleteCode(f.content, f.path);
    if (reason) {
      issues.push({
        severity: 'blocker',
        code: 'FILE_INCOMPLETE',
        message: `${f.path}: ${reason}`,
        file: f.path,
      });
    }
  }

  // ── 2. Critical-file check — skeleton contract must still hold ────
  // We only run the skeleton contract check from the pages phase onward
  // (the skeleton phase itself runs its own dedicated check below).
  if (phase !== 'skeleton') {
    const skeletonProblem = validateSkeletonPhaseOutput(files);
    if (skeletonProblem) {
      issues.push({
        severity: 'blocker',
        code: 'SKELETON_CONTRACT_BROKEN',
        message: `skeleton contract regressed: ${skeletonProblem}`,
      });
    }
  } else {
    // For the skeleton phase itself, run the dedicated validator.
    const skeletonProblem = validateSkeletonPhaseOutput(files);
    if (skeletonProblem) {
      issues.push({
        severity: 'blocker',
        code: 'SKELETON_INVALID',
        message: skeletonProblem,
      });
    }
  }

  // ── 3. Pages presence check — runs from `pages` phase onward ──────
  if (phase !== 'skeleton') {
    const pagesProblem = validatePagesPhaseOutput(files);
    if (pagesProblem) {
      issues.push({
        severity: 'blocker',
        code: 'PAGES_MISSING_OR_REGRESSED',
        message: pagesProblem,
      });
    }
  }

  // ── 4. Phase-specific lightweight checks ──────────────────────────
  if (phase === 'backend') {
    // After backend, expect at least one API/route/server file.
    const hasBackend = files.some((f) =>
      /^(src\/)?app\/api\//i.test(f.path)
      || /^(src\/)?pages\/api\//i.test(f.path)
      || /^(src\/)?server\//i.test(f.path)
      || /^(src\/)?lib\/(db|prisma|api)\b/i.test(f.path)
      || /\bprisma\/schema\.prisma$/i.test(f.path),
    );
    if (!hasBackend) {
      issues.push({
        severity: 'warning',
        code: 'BACKEND_NO_OUTPUT',
        message: 'backend phase produced no recognizable API route, server, or schema file',
      });
    }
  }

  if (phase === 'config') {
    // After config, expect package.json and at least one tooling config.
    const hasPkg = files.some((f) => /(^|\/)package\.json$/i.test(f.path));
    if (!hasPkg) {
      issues.push({
        severity: 'blocker',
        code: 'CONFIG_NO_PACKAGE_JSON',
        message: 'config phase did not retain or emit a package.json',
        file: 'package.json',
      });
    }
  }

  // ── 5. Import-integrity check ─────────────────────────────────────
  // After each phase, every relative / `@/` import must resolve to a
  // file we have already emitted. Bare-module imports (npm packages)
  // are validated by the config phase via dependency-validator.
  //
  // We skip this for the skeleton phase because it is intentionally
  // minimal and only imports bare modules. We DO run it after backend,
  // components, pages, config, and polish — that is precisely where
  // hallucinated cross-phase imports show up. A missing import becomes
  // a blocker so `runPhaseRepair` is invoked with the offending list.
  if (phase !== 'skeleton') {
    const missing = validateImportIntegrity(files);
    if (missing.length > 0) {
      // De-duplicate by `${importer}::${specifier}` and cap message size.
      const seen = new Set<string>();
      const unique = missing.filter((m) => {
        const k = `${m.importer}::${m.specifier}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      const preview = unique.slice(0, 8)
        .map((m) => `${m.importer} → '${m.specifier}'`)
        .join('; ');
      issues.push({
        severity: 'blocker',
        code: 'IMPORT_INTEGRITY_MISSING',
        message:
          `${unique.length} unresolved import${unique.length === 1 ? '' : 's'}: ${preview}` +
          (unique.length > 8 ? ` (+ ${unique.length - 8} more)` : ''),
      });
    }
  }

  return issues;
}

/**
 * Crude per-phase output estimator. The numbers are tuned from observed
 * builder runs on small/medium SaaS spec sizes.
 *
 *   pages       — ~1.2× spec size (one page per primary feature)
 *   backend     — ~1.0× spec size (route + service per feature + Prisma schema)
 *   components  — ~1.5× spec size (design system + shared components)
 *   config      — fixed ~1 500 tokens (package.json + tsconfig + a few)
 *   polish      — ~30% of accumulated codebase (re-emitted fixes)
 */
function estimatePhaseOutputTokens(
  phase: BudgetPhase,
  input: BuilderInput,
  existing: ReadonlyArray<BuilderFile>,
): number {
  const specTokens = estimateTokensFromText(JSON.stringify(input.spec ?? {}));
  const accTokens  = estimateTokensFromFiles(existing);
  switch (phase) {
    case 'skeleton':   return 3_500;  // 7 small files, ~500 tokens each
    case 'pages':      return Math.max(2_500, Math.ceil(specTokens * 1.2));
    case 'backend':    return Math.max(2_500, Math.ceil(specTokens * 1.0));
    case 'components': return Math.max(3_000, Math.ceil(specTokens * 1.5));
    case 'config':     return 1_500;
    case 'polish':     return Math.max(2_000, Math.ceil(accTokens * 0.3));
    default:           return 4_000;
  }
}

/**
 * Trim `existingFiles` for the prompt when the accumulated codebase is
 * larger than what we want in a single call. Strategy is phase-aware:
 *
 *   - `pages`    needs the spec + nothing else (no prior files yet, but
 *                if any seed exists keep page-related ones only).
 *   - `backend`  needs page imports/types — keep pages + lib types.
 *   - `components` needs everything (it re-imports across the codebase).
 *   - `config`   only needs file paths to dedupe deps; file bodies are
 *                trimmed aggressively to ~80 chars each.
 *   - `polish`   needs everything but is bounded by perCallCap.
 *
 * We never silently drop files — when content is trimmed for `config`,
 * we replace the body with a short summary so the model still sees the
 * path and can avoid duplicate emissions.
 */
function trimExistingForPhase(
  existing: ReadonlyArray<BuilderFile>,
  phase: BudgetPhase,
  perCallCap: number,
): BuilderFile[] {
  // Soft input budget: ~3× the output cap. Keeps the total call bounded.
  const targetTokens = perCallCap * 3;

  const isPage      = (f: BuilderFile) => /(^|\/)(app|pages|routes)\//i.test(f.path) && /\.(tsx|jsx|ts)$/i.test(f.path);
  const isBackend   = (f: BuilderFile) => /(^|\/)(api|server|backend|prisma|lib\/db)/i.test(f.path);
  const isComponent = (f: BuilderFile) => /(^|\/)(components|lib|hooks|design)\//i.test(f.path);
  const isConfig    = (f: BuilderFile) => /(^|\/)(package\.json|tsconfig|next\.config|tailwind\.config|postcss\.config|prisma\/schema)/i.test(f.path);

  let kept: BuilderFile[];
  switch (phase) {
    case 'skeleton':   kept = []; break; // skeleton starts fresh — no prior context needed
    case 'pages':      kept = existing.filter(f => isPage(f) || isConfig(f)); break;
    case 'backend':    kept = existing.filter(f => isPage(f) || isBackend(f) || isConfig(f)); break;
    case 'components': kept = existing.slice(); break;
    case 'config': {
      // Just file paths + size hint — bodies are too noisy here.
      kept = existing.map(f => ({
        ...f,
        content: `// ${f.content.length} bytes (trimmed for config phase)`,
      }));
      break;
    }
    case 'polish':     kept = existing.slice(); break;
    default:           kept = existing.slice();
  }

  // Enforce a hard input cap by dropping the longest files first.
  let total = estimateTokensFromFiles(kept);
  if (total <= targetTokens) return kept;

  kept.sort((a, b) => b.content.length - a.content.length);
  const trimmed: BuilderFile[] = [];
  for (const f of kept) {
    const tk = estimateTokensFromFiles([f]);
    if (total - tk < targetTokens && trimmed.length > 0) {
      // Replace the body with a stub so the model still sees the path.
      trimmed.push({ ...f, content: `// (trimmed: ${f.content.length} bytes — preserve byte-for-byte)` });
      total -= tk;
    } else {
      trimmed.push(f);
    }
    if (total <= targetTokens) break;
  }
  return trimmed;
}

// Re-export for any callers still referencing the heuristic externally.
export { looksTruncated };

// ── Project-context registry ────────────────────────────────────────
// Side-channel from the pipeline so builder dumps can include `projectId`
// (which is NOT carried on Task or ExecutionContext). Project-generator
// registers each session it creates; the builder reads by `task.sessionId`.
interface BuilderProjectContext { projectId: string }
const _builderProjectCtx = new Map<string, BuilderProjectContext>();
export function setBuilderProjectContext(sessionId: string, ctx: BuilderProjectContext): void {
  if (!sessionId) return;
  _builderProjectCtx.set(sessionId, ctx);
}
export function clearBuilderProjectContext(sessionId: string): void {
  _builderProjectCtx.delete(sessionId);
}
function getBuilderProjectContext(sessionId: string | undefined): BuilderProjectContext | null {
  if (!sessionId) return null;
  return _builderProjectCtx.get(sessionId) ?? null;
}

// ── Diagnostic dump ──────────────────────────────────────────────────
// Persisted only when DIAGNOSTIC=1 AND the parse decision discarded files
// or returned an empty file list. Captures everything needed to reproduce
// the failure offline: input identity, raw response, parse stages, and
// per-file reject reasons. One file per failing builder call.
interface BuilderParseDumpInput {
  ident: Record<string, unknown>;
  raw: string;
  rawFileCount: number;
  truncated: boolean;
  salvagedCount: number;
  typeRejects: Array<{ index: number; reason: string; pathPreview?: string }>;
  incompleteReasons: Array<{ path: string; reason: string; bytes: number }>;
  allPaths: string[];
  decision: string;
}

// ── Last-failure dump ───────────────────────────────────────────────
// Always writes (no DIAGNOSTIC gate) to a single canonical file:
//   apps/api/src/testing/last-builder-empty-failure.json
// Overwrites on every empty-validation failure so the latest failure is
// always one `cat` away. Includes everything needed to reproduce: project
// & session ids, phase/slice identity, model/provider, prompt-size estimate,
// raw response length, parse counters, per-file discard reasons, manifest,
// stack, and the exact validation rule that tripped.
const LAST_FAILURE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'testing',
  'last-builder-empty-failure.json',
);

interface LastFailureArgs {
  task: Task;
  input: BuilderInput;
  output: Record<string, unknown>;
  agentModel: string;
  agentProvider: string;
  validationRule: string;
  validationMessage: string;
  logger: { info: (m: string, meta?: Record<string, unknown>) => void; warn: (m: string, meta?: Record<string, unknown>) => void };
}

async function writeLastBuilderEmptyFailure(args: LastFailureArgs): Promise<void> {
  try {
    const { task, input, output, agentModel, agentProvider, validationRule, validationMessage, logger } = args;
    const diag = (output._lastEmptyDiag ?? null) as null | {
      ident: Record<string, unknown>;
      rawOutputLength: number;
      raw: string;
      rawFileCount: number;
      jsonTruncated: boolean;
      contentTruncated: boolean;
      salvagedCount: number;
      salvageStopReason?: string | null;
      extractSource?: string;
      typeRejects: Array<{ index: number; reason: string; pathPreview?: string }>;
      incompleteReasons: Array<{ path: string; reason: string; bytes: number }>;
      acceptedPaths: string[];
      decision: string;
    };

    const projectCtx = getBuilderProjectContext(task.sessionId);
    const spec = (input.spec ?? {}) as Record<string, unknown>;
    const stack = normalizeTechStack(spec.techStack);
    const slice = input.currentSlice ?? null;

    // Rough prompt-size estimate: serialized BuilderInput byte length.
    // Cheaper than re-rendering the prompt and accurate enough to flag
    // "the input is huge" vs "input is normal but model still bailed".
    let promptSizeEstimate = 0;
    try { promptSizeEstimate = JSON.stringify(input).length; } catch { /* ignore */ }

    // Build the discard list with reasons.
    const discarded: Array<{ path: string | null; reason: string; bytes?: number; index?: number }> = [];
    if (diag) {
      for (const r of diag.typeRejects) {
        discarded.push({ path: r.pathPreview ?? null, reason: `type-filter:${r.reason}`, index: r.index });
      }
      for (const r of diag.incompleteReasons) {
        discarded.push({ path: r.path, reason: `content-incomplete:${r.reason}`, bytes: r.bytes });
      }
    }

    const manifest = Array.isArray(input.existingFilesManifest)
      ? input.existingFilesManifest.map((m) => ({ path: m.path, bytes: m.bytes, lines: m.lines, kind: m.kind }))
      : [];
    const previousFileCount = Array.isArray(input.existingFiles) ? input.existingFiles.length : 0;

    const payload = {
      timestamp: new Date().toISOString(),
      validation: {
        rule: validationRule,
        message: validationMessage,
        location: 'apps/api/src/agents/builder-agent.ts → BuilderAgent.validateOutput',
      },
      projectId: projectCtx?.projectId ?? null,
      sessionId: task.sessionId ?? null,
      taskId: task.id,
      agentRole: task.agentRole,
      attempt: task.attempt,
      phase: input.phase ?? null,
      phaseIndex: input.phaseIndex ?? null,
      phaseTotal: input.phaseTotal ?? null,
      slice: slice ? { id: slice.id, name: ((slice as unknown as unknown as unknown as Record<string, unknown>).name as string | undefined) ?? null, purpose: slice.purpose ?? null } : null,
      sliceIndex: input.sliceIndex ?? null,
      totalSlices: input.totalSlices ?? null,
      chunk: input.chunk ? { index: input.chunk.index, total: input.chunk.total } : null,
      builderAttempt: input.builderAttempt ?? null,
      iteration: input.iteration ?? null,
      model: agentModel,
      provider: agentProvider,
      promptSizeEstimateBytes: promptSizeEstimate,
      rawResponseLength: diag?.rawOutputLength ?? 0,
      parsedFileCount: diag?.rawFileCount ?? 0,
      filteredFileCount: diag ? diag.acceptedPaths.length - diag.incompleteReasons.length : 0,
      acceptedPaths: diag?.acceptedPaths ?? [],
      discarded,
      jsonTruncated: diag?.jsonTruncated ?? false,
      contentTruncated: diag?.contentTruncated ?? false,
      salvagedFromTruncation: diag?.salvagedCount ?? 0,
      salvageStopReason: diag?.salvageStopReason ?? null,
      extractSource: diag?.extractSource ?? null,
      decision: diag?.decision ?? 'unknown',
      manifestFileCount: manifest.length,
      manifest,
      previousFileCount,
      currentStack: stack,
      qaFeedbackPresent: !!input.qaFeedback && Object.keys(input.qaFeedback).length > 0,
      // Fallback bookkeeping — present when this dump describes the
      // reduced-prompt fallback attempt; `primaryAttempt` summarises the
      // earlier attempt(s) that returned zero usable files.
      isFallbackAttempt: input._fallbackMode === true,
      fallbackTargetPaths: input._fallbackMode ? (input._fallbackTargetPaths ?? []) : null,
      primaryAttempt: input._fallbackMode ? (input._primarySnapshot ?? null) : null,
      // Raw response head/tail for inspection — capped to keep file size sane.
      rawResponseHead: diag ? diag.raw.slice(0, 4096) : null,
      rawResponseTail: diag && diag.raw.length > 4096 ? diag.raw.slice(-4096) : null,
    };

    await mkdir(dirname(LAST_FAILURE_PATH), { recursive: true });
    await writeFile(LAST_FAILURE_PATH, JSON.stringify(payload, null, 2), 'utf8');
    logger.info('[builder] wrote last-builder-empty-failure dump', {
      event: 'builder:last-empty-dump',
      path: LAST_FAILURE_PATH,
      projectId: payload.projectId,
      sessionId: payload.sessionId,
      phase: payload.phase,
      sliceId: payload.slice?.id ?? null,
      decision: payload.decision,
    });
  } catch (e) {
    args.logger.warn('[builder] failed to write last-builder-empty-failure dump', {
      event: 'builder:last-empty-dump-failed',
      error: (e as Error).message,
    });
  }
}

async function persistBuilderParseDump(
  bundle: BuilderParseDumpInput,
  logger: { info: (msg: string, meta?: Record<string, unknown>) => void; warn: (msg: string, meta?: Record<string, unknown>) => void },
): Promise<void> {
  try {
    const dir = join(process.cwd(), 'data', 'diagnostics', 'builder');
    await mkdir(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const tag = String(bundle.ident.taskId ?? 'unknown').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80);
    const filePath = join(dir, `${ts}_${tag}.json`);
    const payload = {
      timestamp: new Date().toISOString(),
      ...bundle,
      // Cap raw at 200KB; full text is rarely needed past that and an
      // unbounded write can saturate disk during a noisy run.
      raw: bundle.raw.length > 200_000 ? bundle.raw.slice(0, 200_000) + '\n…[truncated for dump]' : bundle.raw,
      rawLength: bundle.raw.length,
    };
    await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
    logger.info('[builder] persisted parse dump (DIAGNOSTIC=1)', {
      event: 'builder:parse-dump',
      path: filePath,
      decision: bundle.decision,
    });
  } catch (e) {
    logger.warn('[builder] failed to persist parse dump', {
      event: 'builder:parse-dump-failed',
      error: (e as Error).message,
    });
  }
}
