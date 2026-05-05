/**
 * Implementation-completeness validator.
 *
 * Pure, zero-LLM scan over builder output. Flags every artefact that is the
 * hallmark of an incomplete / stubbed implementation:
 *
 *   • Stub markers     — TODO / FIXME / XXX / HACK / "implement later"
 *   • Throw-stubs      — throw new Error('not implemented' | 'todo' | …)
 *   • Placeholder copy — "Lorem ipsum", "Coming soon", "Under construction"
 *   • Placeholder URLs — placehold.co, via.placeholder.com, /path/to/…
 *   • Mock fixtures    — top-level `const mock…/fake…/dummy…/demo… = [ … ]`
 *                        living in a UI file when a real API exists for that
 *                        data domain.
 *   • Empty handlers   — onClick={() => {}}, onSubmit={() => null}
 *   • No-op handlers   — onClick={() => alert('coming soon')}
 *   • Unwired buttons  — <button> with no onClick / type=submit / form /
 *                        href / link wrapper. (best-effort heuristic)
 *
 * Each rule emits a structured violation that the project-generator turns
 * into a synthetic QA issue, forcing the rebuild loop to produce a real
 * implementation rather than declaring victory on stubs.
 */

export interface CompletenessViolation {
  rule: CompletenessRule;
  file: string;
  line?: number;
  evidence: string;
  /** human-readable fix instruction surfaced to the LLM via QA feedback. */
  message: string;
}

export type CompletenessRule =
  | 'stub-marker'
  | 'throw-not-implemented'
  | 'placeholder-copy'
  | 'placeholder-image'
  | 'mock-fixture-in-ui'
  | 'empty-handler'
  | 'noop-alert-handler'
  | 'unwired-button';

export interface CompletenessReport {
  inspected: number;
  failed: boolean;
  violations: CompletenessViolation[];
  totalCount: number;
}

interface FileLike {
  path: string;
  content: string;
  language?: string;
}

const SOURCE_EXTENSIONS = /\.(t|j)sx?$|\.(vue|svelte|astro|mts|cts)$/i;
const TEST_PATH = /(^|\/)(tests?|__tests__|e2e|spec)\/|\.(test|spec)\.[^./]+$/i;
const NON_SOURCE_PATH = /(^|\/)(public|assets|fixtures|seed|seeds)\//i;
const MARKDOWN = /\.md$/i;

const STUB_MARKER = /\b(TODO|FIXME|XXX|HACK)\b/;
const STUB_PHRASE =
  /\/\/\s*(implement(ation)?\s+later|rest of (the )?code|stub|placeholder)|\/\*\s*(implement(ation)?\s+later|stub|placeholder)/i;
const THROW_NOT_IMPL =
  /throw\s+new\s+Error\s*\(\s*['"`](not\s+implemented|unimplemented|todo|coming\s+soon|stub)/i;

const LOREM_IPSUM = /lorem\s+ipsum/i;
// "Coming soon" / "under construction" only counts as a violation when it
// appears inside JSX/HTML body text, not in a feature spec or a string
// literal inside an alert call (handled separately). We approximate that by
// requiring the phrase to sit between '>' and '<' on the same line.
const PLACEHOLDER_COPY_JSX =
  />[^<]*\b(coming\s+soon|under\s+construction|work\s+in\s+progress)\b[^<]*</i;

const PLACEHOLDER_IMAGE_HOST =
  /\bsrc\s*=\s*["'`](?:https?:)?\/\/(?:placehold(?:er)?\.co|via\.placeholder\.com|placekitten\.com|placeimg\.com|fakeimg\.pl|dummyimage\.com)/i;
const PLACEHOLDER_IMAGE_PATH =
  /\bsrc\s*=\s*["'`](?:\/path\/to\/[^"'`]+|YOUR_IMAGE_URL[^"'`]*|REPLACE_ME[^"'`]*)["'`]/i;
const EMPTY_IMAGE_SRC = /\bsrc\s*=\s*["'`]\s*["'`]/;

const EMPTY_ARROW_HANDLER =
  /\b(on[A-Z]\w+)\s*=\s*\{\s*\(\s*\)\s*=>\s*(?:\{\s*\}|null|undefined|void\s+0)\s*\}/;
const NOOP_ALERT_HANDLER =
  /\b(on[A-Z]\w+)\s*=\s*\{\s*\(\s*\)\s*=>\s*(alert|console\.(log|info|warn))\s*\(\s*['"`][^'"`]*\b(coming\s+soon|todo|placeholder|not\s+implemented|wip)\b/i;

const MOCK_FIXTURE_DECL =
  /\b(?:const|let|var)\s+(mock\w+|fake\w+|dummy\w+|demo\w+|sample\w+|placeholder\w+|fixture\w+|hardcoded\w+)\s*(?::\s*[^=]+)?=\s*\[/i;

/**
 * Tokens extracted from the spec that signal "a real backend API exists for
 * this domain". When a UI file contains `mockPosts = [...]` AND the spec has
 * a posts API, the fixture is a violation; without a backing API it's just
 * static seed data and we let it pass.
 */
export interface CompletenessContext {
  /** Lowercased domain tokens drawn from spec.apiContracts / featureSlices. */
  apiDomains?: string[];
  /** When true, suppress the unwired-button heuristic (it has the highest
   *  false-positive rate and some apps legitimately use buttons inside
   *  forms). Default: false. */
  suppressUnwiredButton?: boolean;
}

const RULE_LIMIT_PER_FILE = 6;
const TOTAL_VIOLATION_LIMIT = 80;

export function validateImplementationCompleteness(
  files: FileLike[],
  ctx: CompletenessContext = {},
): CompletenessReport {
  const violations: CompletenessViolation[] = [];
  let inspected = 0;
  const apiDomains = (ctx.apiDomains ?? []).map((d) => d.toLowerCase()).filter(Boolean);

  for (const f of files) {
    if (!isSourceFile(f.path)) continue;
    if (TEST_PATH.test(f.path)) continue;
    if (NON_SOURCE_PATH.test(f.path)) continue;
    inspected++;

    const lines = f.content.split('\n');
    let perFile = 0;
    const push = (rule: CompletenessRule, line: number, evidence: string, message: string): void => {
      if (perFile >= RULE_LIMIT_PER_FILE) return;
      if (violations.length >= TOTAL_VIOLATION_LIMIT) return;
      violations.push({ rule, file: f.path, line, evidence: trim(evidence), message });
      perFile++;
    };

    const isUiFile = /\.(t|j)sx$/.test(f.path) || /\/components\/|\/app\//.test(f.path);

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const ln = i + 1;

      // Skip pure-comment "section banner" lines that contain the literal
      // word TODO inside ASCII art or doc-string headers — only flag when
      // the marker is followed by content (a real outstanding task).
      if (STUB_MARKER.test(raw) && /\b(TODO|FIXME|XXX|HACK)\b\s*[:\-(]?\s*\S/i.test(raw)) {
        push('stub-marker', ln, raw,
          'Remove the TODO/FIXME marker and ship a real implementation. The builder contract forbids placeholders.');
      }
      if (STUB_PHRASE.test(raw)) {
        push('stub-marker', ln, raw,
          'Remove the "// implement later" / "// rest of code" placeholder and emit the full implementation.');
      }
      if (THROW_NOT_IMPL.test(raw)) {
        push('throw-not-implemented', ln, raw,
          'Replace the not-implemented throw with a real implementation. Every code path must execute correctly.');
      }
      if (LOREM_IPSUM.test(raw)) {
        push('placeholder-copy', ln, raw,
          'Replace lorem-ipsum filler with real copy from the spec. No placeholder text in shipped UI.');
      }
      if (PLACEHOLDER_COPY_JSX.test(raw)) {
        push('placeholder-copy', ln, raw,
          'Replace "Coming soon" / "Under construction" placeholder with the real, functional UI for this section.');
      }
      if (PLACEHOLDER_IMAGE_HOST.test(raw) || PLACEHOLDER_IMAGE_PATH.test(raw) || EMPTY_IMAGE_SRC.test(raw)) {
        push('placeholder-image', ln, raw,
          'Replace placeholder image src with a real asset path or a deterministic seeded image service. No empty src="" / "/path/to/…" / placehold.co URLs.');
      }
      if (EMPTY_ARROW_HANDLER.test(raw)) {
        push('empty-handler', ln, raw,
          'Wire this event handler to the real apiId / navigation / state action declared in the spec. No empty () => {} / () => null handlers.');
      }
      if (NOOP_ALERT_HANDLER.test(raw)) {
        push('noop-alert-handler', ln, raw,
          'Replace the "coming soon" alert with the real interaction (call the spec apiId, navigate, or open the declared modal).');
      }
    }

    // Mock-fixture rule is whole-file (top-level declaration only).
    if (isUiFile && apiDomains.length > 0) {
      const fixtureMatch = scanTopLevelFixtures(f.content);
      for (const m of fixtureMatch) {
        const domainHit = apiDomains.find((d) => m.varName.toLowerCase().includes(d));
        if (domainHit) {
          push(
            'mock-fixture-in-ui',
            m.line,
            m.evidence,
            `'${m.varName}' is a mock fixture in a UI file but a real API exists for the '${domainHit}' domain. Delete the fixture and call the apiContract via lib/api-client.ts instead.`,
          );
        }
      }
    }

    // Unwired-button rule (heuristic, opt-out via ctx.suppressUnwiredButton).
    if (!ctx.suppressUnwiredButton && /\.(t|j)sx$/.test(f.path)) {
      const unwired = scanUnwiredButtons(f.content);
      for (const u of unwired) {
        push(
          'unwired-button',
          u.line,
          u.evidence,
          'This <button> has no onClick, type="submit", form attr, or wrapping <Link>. Wire it to the real interaction (apiId / navigation / modal) declared in the spec.',
        );
      }
    }

    if (violations.length >= TOTAL_VIOLATION_LIMIT) break;
  }

  return {
    inspected,
    failed: violations.length > 0,
    violations,
    totalCount: violations.length,
  };
}

/**
 * Convert a completeness report into the synthetic QA-issue shape used by
 * the rebuild loop. Mirrors the helpers next to the other static gates so
 * the project-generator can splice these into the QA artifact.
 */
export function completenessViolationsAsIssues(
  report: CompletenessReport,
): Array<Record<string, unknown>> {
  return report.violations.map((v) => ({
    severity: severityFor(v.rule),
    category: 'implementation-completeness',
    rule: v.rule,
    file: v.file,
    line: v.line,
    evidence: v.evidence,
    description: v.message,
    suggestion: v.message,
  }));
}

/**
 * Extract API-domain tokens from a spec payload — used to scope the
 * mock-fixture-in-ui rule. Looks at apiContracts[].path / apiContracts[].id
 * and featureSlices[].apiIds / featureSlices[].dbTables for stable nouns
 * (posts, users, comments, …).
 */
export function extractApiDomains(spec: unknown): string[] {
  const out = new Set<string>();
  const s = spec as
    | { apiContracts?: Array<{ id?: string; path?: string }>; featureSlices?: Array<{ apiIds?: string[]; dbTables?: string[] }> }
    | undefined;
  if (!s) return [];
  for (const c of s.apiContracts ?? []) {
    addDomainTokens(c?.id, out);
    addDomainTokens(c?.path, out);
  }
  for (const slice of s.featureSlices ?? []) {
    for (const id of slice.apiIds ?? []) addDomainTokens(id, out);
    for (const t of slice.dbTables ?? []) addDomainTokens(t, out);
  }
  return Array.from(out);
}

// ─── helpers ───────────────────────────────────────────────────────────────

function isSourceFile(path: string): boolean {
  if (MARKDOWN.test(path)) return false;
  return SOURCE_EXTENSIONS.test(path);
}

function trim(s: string): string {
  const t = s.trim();
  return t.length > 200 ? t.slice(0, 197) + '…' : t;
}

function severityFor(rule: CompletenessRule): 'critical' | 'high' | 'medium' {
  switch (rule) {
    case 'throw-not-implemented':
    case 'mock-fixture-in-ui':
    case 'noop-alert-handler':
      return 'critical';
    case 'stub-marker':
    case 'empty-handler':
    case 'placeholder-copy':
    case 'placeholder-image':
      return 'high';
    case 'unwired-button':
    default:
      return 'medium';
  }
}

interface FixtureHit {
  varName: string;
  line: number;
  evidence: string;
}

/** Find top-level `const mockX = [ … ]` style declarations. Skips ones
 *  inside functions by requiring the line to start with optional `export`
 *  + the keyword at column 0. */
function scanTopLevelFixtures(content: string): FixtureHit[] {
  const out: FixtureHit[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!/^(export\s+)?(const|let|var)\s+/.test(raw)) continue;
    const m = raw.match(MOCK_FIXTURE_DECL);
    if (!m) continue;
    out.push({ varName: m[1], line: i + 1, evidence: raw });
  }
  return out;
}

interface ButtonHit {
  line: number;
  evidence: string;
}

/**
 * Find <button> tags lacking any wiring. Heuristic — opens a button tag,
 * walks forward until the closing '>' (best-effort same-line), and checks
 * for onClick / type="submit" / form= / aria-controls / formAction.
 */
function scanUnwiredButtons(content: string): ButtonHit[] {
  const out: ButtonHit[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Find each <button on this line. Skip the design-system <Button>
    // primitive — capital B — its wiring lives in the import site.
    const startIdx = raw.search(/<button\b/);
    if (startIdx === -1) continue;
    // Collect the opening tag spanning up to 4 lines.
    let tag = '';
    for (let j = i; j < Math.min(i + 4, lines.length); j++) {
      tag += lines[j];
      if (lines[j].includes('>')) break;
      tag += ' ';
    }
    const opener = tag.slice(startIdx).split('>')[0] + '>';
    if (
      /\bonClick\s*=/.test(opener) ||
      /\btype\s*=\s*["'`]submit["'`]/.test(opener) ||
      /\bform\s*=/.test(opener) ||
      /\bformAction\s*=/.test(opener) ||
      /\baria-controls\s*=/.test(opener) ||
      /\bdisabled\b/.test(opener)
    ) continue;
    // Allow `<button {...props}>` — the wiring is forwarded.
    if (/\{\.\.\.[\w$]+\}/.test(opener)) continue;
    out.push({ line: i + 1, evidence: opener.slice(0, 200) });
  }
  return out;
}

const STOP_TOKENS = new Set([
  'api', 'v1', 'v2', 'get', 'post', 'put', 'delete', 'patch', 'list', 'create',
  'update', 'destroy', 'index', 'show', 'edit', 'new', 'health', 'auth', 'me',
  'all', 'one', 'item', 'items', 'route', 'routes', 'endpoint', 'endpoints',
]);

function addDomainTokens(value: string | undefined, out: Set<string>): void {
  if (!value) return;
  for (const tok of value.toLowerCase().split(/[^a-z0-9]+/)) {
    if (tok.length < 3) continue;
    if (STOP_TOKENS.has(tok)) continue;
    out.add(tok);
  }
}
