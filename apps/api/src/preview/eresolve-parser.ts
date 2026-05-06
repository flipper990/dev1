// ─────────────────────────────────────────────────────────────
// npm ERESOLVE parser
//
// Parses the npm peer-dependency-resolution error format that
// `npm install` writes to stderr (and to a sidecar
// `*-eresolve-report.txt` in the npm cache `_logs/` folder) when it
// cannot satisfy a peer-dependency constraint.
//
// The raw format we parse looks like this (npm 10 / npm 11):
//
//   npm error code ERESOLVE
//   npm error ERESOLVE unable to resolve dependency tree
//   npm error
//   npm error While resolving: generated-app@0.0.0
//   npm error Found: react@18.3.1
//   npm error node_modules/react
//   npm error   react@"^18.3.0" from the root project
//   npm error   peer react@"^18.2.0 || ^19.0.0" from next@15.5.15
//   npm error   node_modules/next
//   npm error     next@"^15.0.0" from the root project
//   npm error
//   npm error Could not resolve dependency:
//   npm error peer react@"^19.2.5" from react-dom@19.2.5
//   npm error node_modules/react-dom
//   npm error   peer react-dom@"^18.2.0 || ^19.0.0" from next@15.5.15
//   npm error   node_modules/next
//   npm error     next@"^15.0.0" from the root project
//   npm error
//   npm error Fix the upstream dependency conflict, ...
//   npm error For a full report see:
//   npm error <path>-eresolve-report.txt
//   npm error A complete log of this run can be found in:
//   npm error <path>-debug-0.log
//
// The sidecar `-eresolve-report.txt` file contains the same body
// without the `npm error ` prefix. We accept either flavour and
// strip the prefix uniformly.
//
// The output is a structured `EresolveReport` consumed by
// `local-runner.runInstall` to (a) persist a postmortem under
// apps/api/src/testing/last-npm-eresolve.json and (b) build a
// human-readable headline used as `previewError`.
// ─────────────────────────────────────────────────────────────

import { readFile } from 'node:fs/promises';

export interface EresolveConflict {
  /** Package whose installed version is being challenged.
   *  In the example above: `react`. */
  conflictingPackage: string;
  /** Version npm picked for `conflictingPackage` before the conflict
   *  was detected. e.g. `18.3.1`. May be empty when the report does
   *  not include a `Found:` line for this conflict. */
  foundVersion: string;
  /** Range the *root project* (or the dependency immediately above the
   *  failing peer) requested. e.g. `^18.3.0`. */
  rootRequest: string;
  /** Package@version that emitted the unsatisfied peer requirement.
   *  e.g. `react-dom@19.2.5`. */
  peerRequester: string;
  /** Range that peer requirement asked for. e.g. `^19.2.5`. */
  peerRequirement: string;
  /** Dependency chain leading to the peer requirement, root → leaf.
   *  e.g. ['the root project', 'next@15.5.15', 'react-dom@19.2.5'].
   *  Always at least 2 entries (root + the package emitting the peer). */
  introducedBy: string[];
}

export interface EresolveReport {
  /** Always 'ERESOLVE' once parsing has confirmed it; absent when the
   *  installer failure was unrelated. */
  errorCode: 'ERESOLVE';
  /** The package npm was resolving when the conflict occurred, e.g.
   *  `generated-app@0.0.0`. May be empty if the report header was
   *  truncated. */
  resolvingFor: string;
  /** Each conflict the report describes. npm writes one block per
   *  unsatisfied peer; large dependency graphs may produce several. */
  conflicts: EresolveConflict[];
  /** A heuristic, human-readable single-line recommendation derived
   *  from the conflict (e.g. "Pin react-dom to a version compatible
   *  with react ^18.3.0; current 19.2.5 requires react ^19.2.5."). */
  recommendedFix: string;
  /** Filesystem path to the `-eresolve-report.txt` sidecar (extracted
   *  from the npm output's "For a full report see:" line) or null when
   *  npm did not report one. */
  reportPath: string | null;
  /** Filesystem path to npm's `-debug-0.log`, or null. */
  debugLogPath: string | null;
  /** Raw block we parsed (post-prefix-stripping, lines joined with \n).
   *  Useful for the postmortem dump so a human can verify the parse. */
  raw: string;
}

/** Regex for stripping the `npm error ` / `npm WARN ` prefix npm
 *  prepends to every stderr line in npm 10+. */
const NPM_PREFIX_RE = /^(?:npm\s+(?:error|ERR!|WARN|notice)\s+)/i;

function stripNpmPrefix(line: string): string {
  return line.replace(NPM_PREFIX_RE, '');
}

/** Pull the `-eresolve-report.txt` body out of a combined stdout+stderr
 *  capture, normalising line prefixes. Returns the cleaned ERESOLVE
 *  block (start = "While resolving:" line, end = blank line before
 *  "Fix the upstream dependency conflict") or null when the input
 *  doesn't carry an ERESOLVE failure. */
function extractEresolveBlock(combined: string): string | null {
  if (!isEresolveLike(combined)) return null;
  const cleanedLines = combined.split(/\r?\n/).map(stripNpmPrefix);
  const startIdx = cleanedLines.findIndex((l) => /^While resolving:/.test(l));
  if (startIdx < 0) return null;
  // End at the "Fix the upstream dependency conflict" line, or EOF.
  let endIdx = cleanedLines.findIndex((l, i) => i > startIdx && /^Fix the upstream dependency conflict/.test(l));
  if (endIdx < 0) endIdx = cleanedLines.length;
  return cleanedLines.slice(startIdx, endIdx).join('\n').trim();
}

/** True when the captured text looks like an npm peer-resolution
 *  failure. Matches both the stderr flavour (`ERESOLVE` token present)
 *  AND the sidecar `-eresolve-report.txt` flavour (the file body does
 *  NOT include the literal `ERESOLVE` token — just the structural
 *  `While resolving:` / `Could not resolve dependency:` markers). */
function isEresolveLike(s: string): boolean {
  if (/ERESOLVE/.test(s)) return true;
  return /^While resolving:/m.test(s) && /^Could not resolve dependency:/m.test(s);
}

/** Extract the "For a full report see: <path>" and
 *  "A complete log of this run can be found in: <path>" paths from
 *  npm's output. The path is on the line *immediately following* the
 *  marker. Returns { reportPath, debugLogPath }, either null when the
 *  marker was absent. */
function extractAuxPaths(combined: string): { reportPath: string | null; debugLogPath: string | null } {
  const lines = combined.split(/\r?\n/).map(stripNpmPrefix).map((l) => l.trim());
  let reportPath: string | null = null;
  let debugLogPath: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (/^For a full report see:?$/i.test(lines[i]) && i + 1 < lines.length) {
      const next = lines[i + 1].trim();
      if (next) reportPath = next;
    } else if (/^A complete log of this run can be found in:?$/i.test(lines[i]) && i + 1 < lines.length) {
      const next = lines[i + 1].trim();
      if (next) debugLogPath = next;
    }
    // Some npm versions put the path on the same line as the marker.
    const inline1 = lines[i].match(/^For a full report see:\s+(.+)$/i);
    if (inline1 && !reportPath) reportPath = inline1[1].trim();
    const inline2 = lines[i].match(/^A complete log of this run can be found in:\s+(.+)$/i);
    if (inline2 && !debugLogPath) debugLogPath = inline2[1].trim();
  }
  return { reportPath, debugLogPath };
}

/** Parse `<name>@"<range>" from <who>` or `<name>@"<range>" from the root project`. */
const PEER_LINE_RE = /^(?:peer\s+)?([@\w][\w./-]*?)@"([^"]+)"\s+from\s+(.+)$/;

/** Parse `Found: <name>@<ver>`. */
const FOUND_RE = /^Found:\s+([@\w][\w./-]*?)@(\S+)\s*$/;

/** Parse `Could not resolve dependency:` block — the next non-empty
 *  line is the failing peer. */
const COULD_NOT_RESOLVE_RE = /^Could not resolve dependency:\s*$/;

/** Parse `While resolving: <name>@<ver>`. */
const WHILE_RESOLVING_RE = /^While resolving:\s+(.+)$/;

/** Parse a structured ERESOLVE block into one or more conflicts.
 *
 *  npm emits two kinds of conflict shapes:
 *
 *    A)  Found: <pkg>@<ver>
 *        node_modules/<pkg>
 *          <pkg>@"<range>" from the root project
 *          peer <pkg>@"<range>" from <other>@<ver>
 *
 *    B)  Could not resolve dependency:
 *        peer <pkg>@"<range>" from <other>@<ver>
 *        node_modules/<other>
 *          <other>@"<range>" from the root project
 *
 *  We collapse both into a single `EresolveConflict` shape. When we
 *  see an A-block we keep it open while subsequent indented lines feed
 *  it (`introducedBy`), then close it on the next blank line or new
 *  block marker. */
/** Parse a structured ERESOLVE block into one or more conflicts.
 *
 *  npm's ERESOLVE output is built from two layered sections:
 *
 *    A) "Found: X@<ver>" — npm tells us what it had picked for X
 *       before the conflict was detected. Followed by an indented
 *       chain showing every requester of X, each ending with "from
 *       the root project" or "from <pkg>@<ver>".
 *
 *    B) "Could not resolve dependency:" anchor, followed by exactly
 *       one "peer X@\"<range>\" from <pkg>@<ver>" line — THIS is the
 *       failing peer requirement. The indented chain that follows
 *       attributes <pkg>@<ver> back to the root project.
 *
 *  We treat (B) as the canonical conflict source and use (A) only to
 *  enrich `foundVersion`. `rootRequest` is found by searching the
 *  ENTIRE block for an "X@\"<range>\" from the root project" entry
 *  whose package name matches the conflicting package — this is
 *  reliable because the package name is repeated alongside every
 *  request line and disambiguates by name (not by indentation).
 *
 *  Multiple conflicts: npm emits one ERESOLVE failure at a time, so a
 *  single ERESOLVE block contains exactly one (B) section. We still
 *  return an array for forward-compat with multi-conflict reports
 *  some npm versions can emit when running `npm install --json`.
 */
function parseConflicts(block: string): EresolveConflict[] {
  const lines = block.split('\n').map((l) => l.trim());

  // 1. Collect every "Found: X@<ver>" entry, keyed by package name.
  const foundByName = new Map<string, string>();
  for (const line of lines) {
    const m = line.match(FOUND_RE);
    if (m) foundByName.set(m[1], m[2]);
  }

  // 2. Collect every "X@\"<range>\" from the root project" entry,
  //    keyed by package name. Used to populate `rootRequest`.
  const rootRequestByName = new Map<string, string>();
  for (const line of lines) {
    const m = line.match(PEER_LINE_RE);
    if (m && /^the root project$/.test(m[3].trim())) {
      // PEER_LINE_RE matches both "X@<r> from the root project" and
      // "peer X@<r> from <pkg>". The "from the root project" check
      // restricts to the former.
      rootRequestByName.set(m[1], m[2]);
    }
  }

  // 3. Find each "Could not resolve dependency:" anchor and parse the
  //    failing peer requirement that follows.
  const conflicts: EresolveConflict[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!COULD_NOT_RESOLVE_RE.test(lines[i])) continue;
    // The next non-empty line should be `peer X@"<range>" from Y@<ver>`.
    let peerLineIdx = i + 1;
    while (peerLineIdx < lines.length && !lines[peerLineIdx]) peerLineIdx++;
    if (peerLineIdx >= lines.length) continue;
    const peerMatch = lines[peerLineIdx].match(PEER_LINE_RE);
    if (!peerMatch || !/^peer\s/.test(lines[peerLineIdx])) continue;
    const conflictingPackage = peerMatch[1];
    const peerRequirement = peerMatch[2];
    const peerRequester = peerMatch[3].trim();

    // Build the dependency chain by reading subsequent indented lines
    // until we hit a blank line, EOF, or a new top-level marker.
    const chain: string[] = [];
    chain.push(`${conflictingPackage}@"${peerRequirement}" required by ${peerRequester}`);
    for (let j = peerLineIdx + 1; j < lines.length; j++) {
      const l = lines[j];
      if (!l) break;
      if (FOUND_RE.test(l) || COULD_NOT_RESOLVE_RE.test(l) || /^Fix the upstream/.test(l)) break;
      if (l.startsWith('node_modules/')) continue;
      const cm = l.match(PEER_LINE_RE);
      if (!cm) continue;
      const [, name, range, fromWho] = cm;
      const fromTrim = fromWho.trim();
      chain.push(
        fromTrim === 'the root project'
          ? `${name}@"${range}" from the root project`
          : `${name}@"${range}" from ${fromTrim}`,
      );
    }

    conflicts.push({
      conflictingPackage,
      foundVersion: foundByName.get(conflictingPackage) ?? '',
      rootRequest: rootRequestByName.get(conflictingPackage) ?? '',
      peerRequester,
      peerRequirement,
      introducedBy: chain,
    });
  }

  return conflicts;
}

/** Pull the package name out of a `<name>@<ver>` string, including
 *  scoped names (`@scope/name@ver`). */
function extractPeerPkgName(spec: string): string | null {
  if (!spec) return null;
  if (spec.startsWith('@')) {
    const m = spec.match(/^(@[^/]+\/[^@]+)@/);
    return m ? m[1] : null;
  }
  const m = spec.match(/^([^@]+)@/);
  return m ? m[1] : null;
}

/** Build a one-line recommendation for the user. Heuristic — we
 *  recognise a few common shapes (mismatched react/react-dom majors
 *  is the dominant generator failure mode) and otherwise fall back
 *  to a generic "use --legacy-peer-deps or pin <X> to satisfy <Y>". */
function buildRecommendation(conflicts: EresolveConflict[]): string {
  if (conflicts.length === 0) return 'See npm ERESOLVE log for details.';
  const c = conflicts[0];
  const peerPkg = extractPeerPkgName(c.peerRequester);
  if (
    c.conflictingPackage === 'react' &&
    peerPkg === 'react-dom'
  ) {
    return (
      `Pin react-dom to a version that matches react ${c.rootRequest || c.foundVersion || '^18'}. ` +
      `Current react-dom (${c.peerRequester}) requires react ${c.peerRequirement}, ` +
      `but root requested react ${c.rootRequest || c.foundVersion}. ` +
      `Either downgrade react-dom (e.g. "react-dom": "${c.rootRequest || '^18.3.0'}") ` +
      `or upgrade react to ${c.peerRequirement}.`
    );
  }
  if (
    c.conflictingPackage === 'react-dom' &&
    peerPkg === 'react'
  ) {
    return (
      `Align react and react-dom majors. ` +
      `${c.peerRequester} requires react-dom ${c.peerRequirement}, but root has react-dom ${c.rootRequest || c.foundVersion}.`
    );
  }
  return (
    `Resolve peer-dependency conflict on ${c.conflictingPackage}: ` +
    `${c.peerRequester} requires ${c.conflictingPackage} ${c.peerRequirement}, ` +
    `but root has ${c.conflictingPackage} ${c.rootRequest || c.foundVersion || '(unspecified)'}. ` +
    `Pin ${c.conflictingPackage} to a range satisfying both, ` +
    `or remove/downgrade ${c.peerRequester}.`
  );
}

/** Synchronous parse from a captured stderr/stdout buffer. Returns
 *  `null` when the input is not an ERESOLVE failure. */
export function parseEresolveFromCombinedOutput(combined: string): EresolveReport | null {
  if (!combined || !isEresolveLike(combined)) return null;
  const block = extractEresolveBlock(combined);
  if (!block) {
    // ERESOLVE was mentioned but we couldn't isolate the structured
    // block — return a minimal report so the caller still has SOMETHING
    // to persist.
    const aux = extractAuxPaths(combined);
    return {
      errorCode: 'ERESOLVE',
      resolvingFor: '',
      conflicts: [],
      recommendedFix: 'Run with --legacy-peer-deps or inspect the full report.',
      reportPath: aux.reportPath,
      debugLogPath: aux.debugLogPath,
      raw: combined.slice(-4000),
    };
  }
  const headerMatch = block.split('\n').map(stripNpmPrefix)[0]?.match(WHILE_RESOLVING_RE);
  const resolvingFor = headerMatch ? headerMatch[1].trim() : '';
  const conflicts = parseConflicts(block);
  const aux = extractAuxPaths(combined);
  return {
    errorCode: 'ERESOLVE',
    resolvingFor,
    conflicts,
    recommendedFix: buildRecommendation(conflicts),
    reportPath: aux.reportPath,
    debugLogPath: aux.debugLogPath,
    raw: block,
  };
}

/** Async parse that opportunistically reads the npm sidecar
 *  `-eresolve-report.txt` file when the in-stream block was truncated.
 *  The sidecar is canonical (npm always writes it) so we prefer it
 *  whenever it's accessible. */
export async function parseEresolveAsync(combinedOutput: string): Promise<EresolveReport | null> {
  const initial = parseEresolveFromCombinedOutput(combinedOutput);
  if (!initial) return null;
  if (initial.conflicts.length > 0) return initial;
  // Try to enrich from the sidecar.
  if (initial.reportPath) {
    try {
      const body = await readFile(initial.reportPath, 'utf8');
      const enriched = parseEresolveFromCombinedOutput(body);
      if (enriched && enriched.conflicts.length > 0) {
        return {
          ...enriched,
          reportPath: initial.reportPath,
          debugLogPath: initial.debugLogPath ?? enriched.debugLogPath,
        };
      }
    } catch { /* sidecar missing/unreadable — fall through */ }
  }
  return initial;
}

/** Build a single-line, human-friendly headline suitable for use as
 *  `project.preview.previewError`. Includes the conflicting package
 *  names + versions so a developer reading the dashboard sees exactly
 *  what is wrong. */
export function buildEresolveHeadline(report: EresolveReport): string {
  if (report.conflicts.length === 0) {
    return 'npm install failed: ERESOLVE peer-dependency conflict (see last-npm-eresolve.json).';
  }
  const c = report.conflicts[0];
  const head =
    `npm install failed: ERESOLVE on ${c.conflictingPackage}` +
    (c.foundVersion ? `@${c.foundVersion}` : '') +
    ` — ${c.peerRequester} requires ${c.conflictingPackage} ${c.peerRequirement}` +
    (c.rootRequest ? `, but root requested ${c.conflictingPackage} ${c.rootRequest}` : '') +
    '.';
  const more =
    report.conflicts.length > 1
      ? ` (+${report.conflicts.length - 1} more conflict(s))`
      : '';
  return head + more;
}
