// ─────────────────────────────────────────────────────────────
// preview-file-validator — pre-flight validation for preview
// staging. Catches malformed file entries (undefined content,
// non-string paths, traversal attempts, etc.) BEFORE we touch
// the filesystem so a single bad record can never throw a
// low-level "data argument must be of type string …" error
// out of fs.writeFile.
//
// The validator is conservative: it accepts BOTH legacy
// `{ path, content }` and current `{ path, contents }` shapes
// and reports per-file diagnostics so the failing entry is
// always identifiable.
// ─────────────────────────────────────────────────────────────

export interface ValidatableFile {
  path?: unknown;
  content?: unknown;
  contents?: unknown;
}

export interface NormalizedPreviewFile {
  path: string;
  contents: string;
}

export interface PreviewFileIssue {
  index: number;
  path: string;
  reason:
    | 'invalid-path'
    | 'empty-path'
    | 'path-traversal'
    | 'absolute-path'
    | 'invalid-content'
    | 'duplicate-path'
    | 'missing-critical-file'
    | 'empty-critical-file'
    | 'empty-input'
    | 'invalid-package-json'
    | 'missing-dev-script'
    | 'missing-build-script'
    | 'undeterminable-preview-command'
    | 'missing-next-layout'
    | 'missing-next-page'
    | 'missing-next-globals-css'
    | 'invalid-global-css-import'
    | 'invalid-css-syntax'
    | 'invalid-postcss-config-module-format';
  typeofContent: string;
  typeofContents: string;
  /** First 200 chars of content if it WAS a string, otherwise null. */
  preview: string | null;
  /** Optional human-readable detail (parse error message, missing script names, …). */
  detail?: string;
}

export interface PreviewFileValidationResult {
  ok: boolean;
  /** Files that passed validation, ready to hand to the runner. */
  staged: NormalizedPreviewFile[];
  /** Files that failed validation. */
  issues: PreviewFileIssue[];
  /** First issue's path, for the user-facing error message. */
  firstFailingPath: string | null;
}

const MAX_PATH_LEN = 1024;

/**
 * Files whose absence or empty content makes the project unrunnable.
 * `oneOf` groups list path alternatives — ANY one of them satisfies the
 * group. Patterns are matched literally (no globs) so that the validator
 * stays cheap and predictable.
 *
 * NB: We do NOT enforce a Dockerfile here — the local runner doesn't need
 * one, and the docker path injects a default Dockerfile via
 * `getDockerfile(stack)` when none is present in the project.
 */
const CRITICAL_FILES: ReadonlyArray<{ id: string; oneOf: string[] }> = [
  { id: 'package.json', oneOf: ['package.json', 'apps/web/package.json'] },
  {
    id: 'app entry',
    oneOf: [
      'app/page.tsx', 'app/page.jsx', 'app/page.ts', 'app/page.js',
      'src/app/page.tsx', 'src/app/page.jsx', 'src/app/page.ts', 'src/app/page.js',
      'pages/index.tsx', 'pages/index.jsx', 'pages/index.ts', 'pages/index.js',
      'src/pages/index.tsx', 'src/pages/index.jsx', 'src/pages/index.ts', 'src/pages/index.js',
      'apps/web/app/page.tsx', 'apps/web/app/page.jsx',
      'apps/web/src/app/page.tsx', 'apps/web/src/app/page.jsx',
      'apps/web/pages/index.tsx', 'apps/web/pages/index.jsx',
    ],
  },
];

function hasBalancedCssBraces(input: string): boolean {
  let depth = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/**
 * Validate every file entry. Returns ok=true ONLY when:
 *   - the input is a non-empty array, AND
 *   - EVERY entry has a string path AND string content (under either key),
 *   - no two entries share the same normalized path,
 *   - every CRITICAL_FILES group has at least one non-empty match.
 *
 * Even a single invalid entry produces ok=false. Callers should fail
 * the preview start with a structured error rather than partial-stage
 * — partial staging produces broken builds that are harder to debug
 * than a clean upfront refusal.
 */
export function validateProjectFilesForPreview(
  files: ReadonlyArray<ValidatableFile> | null | undefined,
): PreviewFileValidationResult {
  const staged: NormalizedPreviewFile[] = [];
  const issues: PreviewFileIssue[] = [];

  if (!Array.isArray(files) || files.length === 0) {
    return {
      ok: false,
      staged,
      issues: [{
        index: -1,
        path: '<none>',
        reason: 'empty-input',
        typeofContent: 'undefined',
        typeofContents: 'undefined',
        preview: null,
      }],
      firstFailingPath: '<none>',
    };
  }

  for (let i = 0; i < files.length; i++) {
    const raw = files[i] ?? {};
    const path = raw.path;
    const typeofContent  = typeof raw.content;
    const typeofContents = typeof raw.contents;
    const text =
      typeof raw.content === 'string'  ? raw.content  :
      typeof raw.contents === 'string' ? raw.contents : null;

    const pushIssue = (reason: PreviewFileIssue['reason']) => {
      issues.push({
        index: i,
        path: typeof path === 'string' ? path : `<${typeof path}>`,
        reason,
        typeofContent,
        typeofContents,
        preview: text === null ? null : text.slice(0, 200),
      });
    };

    if (typeof path !== 'string')                  { pushIssue('invalid-path');   continue; }
    if (path.length === 0)                          { pushIssue('empty-path');     continue; }
    if (path.length > MAX_PATH_LEN)                 { pushIssue('invalid-path');   continue; }
    if (path.includes('..'))                        { pushIssue('path-traversal'); continue; }
    if (path.startsWith('/') || path.startsWith('\\')) { pushIssue('absolute-path');  continue; }
    if (text === null)                              { pushIssue('invalid-content');continue; }

    staged.push({ path, contents: text });
  }

  // ── Duplicate-path detection ──
  // Two entries with the same path produce non-deterministic disk state
  // (later writes silently overwrite earlier ones) and almost always
  // indicate a merge bug upstream. Fail closed.
  if (issues.length === 0) {
    const seen = new Map<string, number>();
    for (let i = 0; i < staged.length; i++) {
      const norm = staged[i]!.path.replace(/\\/g, '/');
      const prev = seen.get(norm);
      if (prev !== undefined) {
        issues.push({
          index: i,
          path: staged[i]!.path,
          reason: 'duplicate-path',
          typeofContent: 'string',
          typeofContents: 'string',
          preview: staged[i]!.contents.slice(0, 200),
        });
      } else {
        seen.set(norm, i);
      }
    }
  }

  // ── Critical-file presence + non-empty content checks ──
  // We only check these when per-file validation passed; a malformed
  // entry already produces a clearer error message.
  if (issues.length === 0) {
    const byPath = new Map<string, string>();
    for (const f of staged) byPath.set(f.path.replace(/\\/g, '/'), f.contents);
    for (const group of CRITICAL_FILES) {
      let foundPath: string | null = null;
      let foundContent: string | null = null;
      for (const candidate of group.oneOf) {
        const c = byPath.get(candidate);
        if (c !== undefined) { foundPath = candidate; foundContent = c; break; }
      }
      if (foundPath === null) {
        issues.push({
          index: -1,
          path: group.oneOf[0]!,
          reason: 'missing-critical-file',
          typeofContent: 'undefined',
          typeofContents: 'undefined',
          preview: null,
        });
      } else if (foundContent !== null && foundContent.trim().length === 0) {
        issues.push({
          index: -1,
          path: foundPath,
          reason: 'empty-critical-file',
          typeofContent: 'string',
          typeofContents: 'string',
          preview: '',
        });
      }
    }
  }

  // ── package.json deep validation (parse + required scripts) ──
  // The earlier critical-file check only verifies the file exists and
  // is non-empty. Now we parse it and confirm a runnable script
  // exists — without this the preview backend would happily build a
  // container that has no `npm run dev` to invoke and die later with
  // a cryptic "missing script: dev" exit. Catching it here gives the
  // user a precise, actionable error string.
  if (issues.length === 0) {
    const pkgPath = ['package.json', 'apps/web/package.json'].find((p) =>
      staged.some((f) => f.path.replace(/\\/g, '/') === p),
    );
    if (pkgPath) {
      const pkgFile = staged.find((f) => f.path.replace(/\\/g, '/') === pkgPath)!;
      let parsed: { scripts?: Record<string, string> } | null = null;
      try {
        parsed = JSON.parse(pkgFile.contents) as { scripts?: Record<string, string> };
      } catch (err) {
        issues.push({
          index: -1,
          path: pkgPath,
          reason: 'invalid-package-json',
          typeofContent: 'string',
          typeofContents: 'string',
          preview: pkgFile.contents.slice(0, 200),
          detail: (err as Error).message,
        });
      }
      if (parsed) {
        const scripts = parsed.scripts ?? {};
        const hasDev   = typeof scripts.dev   === 'string' && scripts.dev.trim().length > 0;
        const hasStart = typeof scripts.start === 'string' && scripts.start.trim().length > 0;
        const hasBuild = typeof scripts.build === 'string' && scripts.build.trim().length > 0;
        const scriptKeys = Object.keys(scripts);
        if (!hasDev && !hasStart) {
          issues.push({
            index: -1,
            path: pkgPath,
            reason: 'missing-dev-script',
            typeofContent: 'string',
            typeofContents: 'string',
            preview: pkgFile.contents.slice(0, 200),
            detail: `package.json has no "dev" or "start" script (found: ${scriptKeys.join(', ') || '<none>'})`,
          });
        }
        // `build` isn't strictly required to *run* a dev server (Next
        // dev / Vite dev don't need a prior build) but its absence is
        // a strong signal of a malformed scripts block, so we report
        // it as a separate issue and fail the gate.
        if (!hasBuild) {
          issues.push({
            index: -1,
            path: pkgPath,
            reason: 'missing-build-script',
            typeofContent: 'string',
            typeofContents: 'string',
            preview: pkgFile.contents.slice(0, 200),
            detail: `package.json has no "build" script (found: ${scriptKeys.join(', ') || '<none>'})`,
          });
        }
        // Even with `dev`/`start` strings present, ensure the chosen
        // command has an actual token. Guards against `"dev": ""` /
        // `"dev": "   "` slipping past the typeof check above.
        const command = hasDev ? scripts.dev : hasStart ? scripts.start : null;
        if (command && command.trim().split(/\s+/).filter(Boolean).length === 0) {
          issues.push({
            index: -1,
            path: pkgPath,
            reason: 'undeterminable-preview-command',
            typeofContent: 'string',
            typeofContents: 'string',
            preview: pkgFile.contents.slice(0, 200),
            detail: 'dev/start script is empty after trimming — cannot determine preview command.',
          });
        }

        // Next.js structural + CSS pipeline contract checks.
        const deps = (parsed as { dependencies?: Record<string, string> }).dependencies ?? {};
        const devDeps = (parsed as { devDependencies?: Record<string, string> }).devDependencies ?? {};
        const pkgType = (parsed as { type?: unknown }).type;
        const isTypeModule = pkgType === 'module';
        const byPath = new Map(staged.map((f) => [f.path.replace(/\\/g, '/'), f.contents]));
        const hasNext =
          typeof deps.next === 'string'
          || typeof devDeps.next === 'string'
          || byPath.has('next.config.js')
          || byPath.has('next.config.mjs')
          || byPath.has('next.config.ts');

        if (hasNext) {
          const layoutPath = byPath.has('src/app/layout.tsx') ? 'src/app/layout.tsx'
            : byPath.has('app/layout.tsx') ? 'app/layout.tsx'
            : null;
          const pagePath = byPath.has('src/app/page.tsx') ? 'src/app/page.tsx'
            : byPath.has('app/page.tsx') ? 'app/page.tsx'
            : null;
          const globalsPath = byPath.has('src/app/globals.css') ? 'src/app/globals.css'
            : byPath.has('app/globals.css') ? 'app/globals.css'
            : null;

          if (!layoutPath) {
            issues.push({
              index: -1,
              path: 'src/app/layout.tsx',
              reason: 'missing-next-layout',
              typeofContent: 'undefined',
              typeofContents: 'undefined',
              preview: null,
              detail: 'Next preview requires a root App Router layout.',
            });
          }
          if (!pagePath) {
            issues.push({
              index: -1,
              path: 'src/app/page.tsx',
              reason: 'missing-next-page',
              typeofContent: 'undefined',
              typeofContents: 'undefined',
              preview: null,
              detail: 'Next preview requires a root App Router page.',
            });
          }
          if (!globalsPath) {
            issues.push({
              index: -1,
              path: 'src/app/globals.css',
              reason: 'missing-next-globals-css',
              typeofContent: 'undefined',
              typeofContents: 'undefined',
              preview: null,
              detail: 'Next preview requires globals.css for deterministic baseline styles.',
            });
          }

          if (layoutPath && globalsPath) {
            const layoutContent = byPath.get(layoutPath) ?? '';
            const globalImportRel = globalsPath.startsWith('src/') ? './globals.css' : './globals.css';
            if (!/import\s+['"]\.\/globals\.css['"]/.test(layoutContent)) {
              issues.push({
                index: -1,
                path: layoutPath,
                reason: 'invalid-global-css-import',
                typeofContent: 'string',
                typeofContents: 'string',
                preview: layoutContent.slice(0, 200),
                detail: `Root layout must import "${globalImportRel}".`,
              });
            }
            for (const f of staged) {
              const p = f.path.replace(/\\/g, '/');
              if (p === layoutPath || !/\.(?:tsx?|jsx?)$/i.test(p)) continue;
              if (/import\s+['"][^'"]*globals\.css['"]/.test(f.contents)) {
                issues.push({
                  index: -1,
                  path: p,
                  reason: 'invalid-global-css-import',
                  typeofContent: 'string',
                  typeofContents: 'string',
                  preview: f.contents.slice(0, 200),
                  detail: 'Global CSS must be imported only from the root layout.',
                });
              }
            }
          }

          if (globalsPath) {
            const css = byPath.get(globalsPath) ?? '';
            if (!hasBalancedCssBraces(css)) {
              issues.push({
                index: -1,
                path: globalsPath,
                reason: 'invalid-css-syntax',
                typeofContent: 'string',
                typeofContents: 'string',
                preview: css.slice(0, 200),
                detail: 'Unbalanced CSS braces detected in globals.css.',
              });
            }
          }

          if (isTypeModule) {
            const postcssPath = byPath.has('postcss.config.js') ? 'postcss.config.js'
              : byPath.has('apps/web/postcss.config.js') ? 'apps/web/postcss.config.js'
              : null;
            if (postcssPath) {
              const postcssContent = byPath.get(postcssPath) ?? '';
              if (/module\.exports\s*=/.test(postcssContent)) {
                issues.push({
                  index: -1,
                  path: postcssPath,
                  reason: 'invalid-postcss-config-module-format',
                  typeofContent: 'string',
                  typeofContents: 'string',
                  preview: postcssContent.slice(0, 200),
                  detail: 'package.json has "type":"module", but postcss.config.js uses CommonJS module.exports.',
                });
              }
            }
          }
        }
      }
    }
  }

  return {
    ok: issues.length === 0,
    staged,
    issues,
    firstFailingPath: issues[0]?.path ?? null,
  };
}

/** Build the user-facing error message for the first failing file. */
export function describePreviewFileIssue(issue: PreviewFileIssue): string {
  switch (issue.reason) {
    case 'empty-input':           return 'Project has no files to preview.';
    case 'invalid-path':          return `Invalid file path at index ${issue.index} (got ${issue.path}).`;
    case 'empty-path':            return `Empty file path at index ${issue.index}.`;
    case 'path-traversal':        return `Disallowed path traversal in "${issue.path}".`;
    case 'absolute-path':         return `Absolute path not allowed: "${issue.path}".`;
    case 'invalid-content':       return `Invalid file content for "${issue.path}" (typeof content=${issue.typeofContent}, typeof contents=${issue.typeofContents}).`;
    case 'duplicate-path':        return `Duplicate file path: "${issue.path}". Two entries share the same path — merge bug upstream.`;
    case 'missing-critical-file': return `Missing critical file: "${issue.path}". Project cannot be previewed without it.`;
    case 'empty-critical-file':   return `Critical file is empty: "${issue.path}". Project cannot be previewed.`;
    case 'invalid-package-json':  return `Invalid package.json ("${issue.path}"): ${issue.detail ?? 'parse error'}.`;
    case 'missing-dev-script':    return `Project cannot be previewed: ${issue.detail ?? `"${issue.path}" is missing a "dev" or "start" script`}.`;
    case 'missing-build-script':  return `Project is missing a "build" script in "${issue.path}".`;
    case 'undeterminable-preview-command': return `Cannot determine preview command from "${issue.path}": ${issue.detail ?? 'no runnable script'}.`;
    case 'missing-next-layout':   return `Next preview contract failed: missing root layout ("${issue.path}").`;
    case 'missing-next-page':     return `Next preview contract failed: missing root page ("${issue.path}").`;
    case 'missing-next-globals-css': return `Next preview contract failed: missing global stylesheet ("${issue.path}").`;
    case 'invalid-global-css-import': return `Invalid global CSS import in "${issue.path}": ${issue.detail ?? 'global CSS must only be imported in root layout'}.`;
    case 'invalid-css-syntax':    return `Invalid CSS syntax in "${issue.path}": ${issue.detail ?? 'syntax error'}.`;
    case 'invalid-postcss-config-module-format':
      return `Invalid PostCSS config module format in "${issue.path}": ${issue.detail ?? 'ESM/CommonJS mismatch'}.`;
  }
}
