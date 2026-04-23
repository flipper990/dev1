/**
 * Frontend preview HTML builder.
 *
 * Produces a self-contained HTML document that the <iframe> can render via
 * srcDoc with NO backend involvement at runtime. Strategy:
 *
 *   1. If the project ships its own index.html, use it verbatim and just
 *      inject the mock layer + a <base target="_blank"> so relative nav
 *      opens outside the iframe.
 *   2. Else, if an App.tsx / App.jsx (or src/App.*) is detected, build a
 *      minimal React host page that loads react/react-dom + Babel Standalone
 *      from a CDN, concatenates every .ts/.tsx/.js/.jsx file into one Babel
 *      script tag, and mounts <App/>.
 *   3. Else, render a static "no renderable entry point" fallback page that
 *      still shows *something* — the project's file list.
 *
 * Every path ends with a valid HTML string — the builder never throws.
 */

import { PREVIEW_MOCK_SCRIPT } from './preview-mock-script';

export interface PreviewFile {
  path: string;
  content: string;
}

type BuildResult = {
  html: string;
  mode: 'index-html' | 'react-synth' | 'fallback';
  /** Human-readable note (e.g. "No App component found") surfaced in the UI. */
  note?: string;
};

const REACT_CDN_URL     = 'https://unpkg.com/react@18/umd/react.development.js';
const REACT_DOM_CDN_URL = 'https://unpkg.com/react-dom@18/umd/react-dom.development.js';
const BABEL_CDN_URL     = 'https://unpkg.com/@babel/standalone/babel.min.js';

/** Escape a string for safe inclusion in an HTML <script> tag body. */
function safeForScript(s: string): string {
  return s.replace(/<\/script/gi, '<\\/script').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** Normalise forward/backward slashes and collapse leading ./ so detection is predictable. */
function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function isJsLike(path: string): boolean {
  return /\.(?:jsx?|tsx?|mjs|cjs)$/i.test(path);
}
function isCssLike(path: string): boolean {
  return /\.(?:css|scss|less|styl)$/i.test(path);
}
function isTestFile(path: string): boolean {
  const p = norm(path).toLowerCase();
  return (
    /\.(?:test|spec|cy)\.(?:jsx?|tsx?)$/.test(p) ||
    /(?:^|\/)(?:tests?|__tests__|cypress|e2e|playwright)\//.test(p) ||
    /(?:^|\/)setuptests?\.(?:jsx?|tsx?)$/i.test(p) ||
    /\.config\.(?:jsx?|tsx?|cjs|mjs)$/i.test(p)
  );
}

/** Strip ES module syntax so every file runs in the shared Babel scope. */
function stripModuleSyntax(code: string): string {
  let out = code;
  // Remove import statements entirely (default / named / side-effect / namespace).
  out = out.replace(/^\s*import\s+[^;]*?;?\s*$/gm, '');
  out = out.replace(/^\s*import\s+[^;]*?from\s+['"][^'"]+['"]\s*;?\s*$/gm, '');
  // Convert export default <expr>; → (expr) — value discarded unless recaptured below.
  out = out.replace(/export\s+default\s+/g, '');
  // export { a, b } → nothing (the symbols are already in scope)
  out = out.replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');
  // export const / export function / export class → strip the `export `
  out = out.replace(/\bexport\s+(const|let|var|function|class|async\s+function)\b/g, '$1');
  return out;
}

/** Order files so App.* comes last (ensuring its dependencies are defined). */
function orderForSynth(files: PreviewFile[]): PreviewFile[] {
  const score = (f: PreviewFile): number => {
    const p = norm(f.path).toLowerCase();
    if (/(?:^|\/)index\.(?:jsx?|tsx?)$/.test(p)) return 100; // entry last
    if (/(?:^|\/)app\.(?:jsx?|tsx?)$/.test(p))    return 90;
    if (/(?:^|\/)pages?\//.test(p))               return 70;
    if (/(?:^|\/)routes?\//.test(p))              return 70;
    if (/(?:^|\/)components?\//.test(p))          return 40;
    if (/(?:^|\/)hooks?\//.test(p))               return 30;
    if (/(?:^|\/)utils?\//.test(p))               return 20;
    return 50;
  };
  return [...files].sort((a, b) => score(a) - score(b));
}

function findReactEntry(files: PreviewFile[]): PreviewFile | null {
  const candidates = ['src/App.tsx', 'src/App.jsx', 'App.tsx', 'App.jsx', 'src/app.tsx', 'src/app.jsx'];
  for (const c of candidates) {
    const hit = files.find((f) => norm(f.path) === c);
    if (hit) return hit;
  }
  return files.find((f) => /(?:^|\/)app\.(?:jsx?|tsx?)$/i.test(norm(f.path))) ?? null;
}

function findIndexHtml(files: PreviewFile[]): PreviewFile | null {
  return (
    files.find((f) => norm(f.path).toLowerCase() === 'index.html') ??
    files.find((f) => /(?:^|\/)index\.html$/i.test(norm(f.path))) ??
    null
  );
}

/** Extract the name of the default-exported component from an entry file. */
function extractAppIdentifier(entry: PreviewFile): string {
  const src = entry.content;
  const m1 = src.match(/export\s+default\s+function\s+(\w+)/);
  if (m1) return m1[1];
  const m2 = src.match(/export\s+default\s+class\s+(\w+)/);
  if (m2) return m2[1];
  const m3 = src.match(/export\s+default\s+(\w+)\s*;?/);
  if (m3) return m3[1];
  // Fall back to function named App / default App presence
  const m4 = src.match(/function\s+(App\w*)\s*\(/);
  if (m4) return m4[1];
  return 'App';
}

function buildIndexHtmlMode(html: string): string {
  const lower = html.toLowerCase();
  const headIdx = lower.indexOf('<head>');
  if (headIdx === -1) {
    // Wrap the raw HTML in a <head> so we can inject our mock layer.
    return `<!doctype html><html><head><meta charset="utf-8">${PREVIEW_MOCK_SCRIPT}</head><body>${html}</body></html>`;
  }
  const insertAt = headIdx + '<head>'.length;
  return html.slice(0, insertAt) + PREVIEW_MOCK_SCRIPT + html.slice(insertAt);
}

function buildReactSynthHtml(files: PreviewFile[], entry: PreviewFile, projectName: string): string {
  const appIdent = extractAppIdentifier(entry);
  const sources = orderForSynth(files.filter((f) => isJsLike(f.path) && !isTestFile(f.path)));
  const styles  = files.filter((f) => isCssLike(f.path) && !isTestFile(f.path));

  const combinedJs = sources
    .map((f) => `/* ── ${norm(f.path)} ── */\n${stripModuleSyntax(f.content)}`)
    .join('\n\n');

  const combinedCss = styles.map((f) => `/* ${norm(f.path)} */\n${f.content}`).join('\n\n');

  // The bootstrap must run AFTER the user code executes, and must reference
  // the identifier detected above. If the identifier isn't in scope at runtime
  // (e.g. parse error earlier), the mock layer's error handler will catch it.
  const bootstrap = `
    (function () {
      var rootEl = document.getElementById('root') || document.getElementById('app');
      if (!rootEl) {
        rootEl = document.createElement('div');
        rootEl.id = 'root';
        document.body.appendChild(rootEl);
      }
      try {
        var Component = (typeof ${appIdent} !== 'undefined') ? ${appIdent} : null;
        if (!Component) {
          throw new Error('No default-exported component found (expected: ${appIdent}).');
        }
        if (ReactDOM.createRoot) {
          ReactDOM.createRoot(rootEl).render(React.createElement(Component));
        } else {
          ReactDOM.render(React.createElement(Component), rootEl);
        }
      } catch (err) {
        var pre = document.createElement('pre');
        pre.style.cssText = 'padding:16px;color:#F87171;background:#111827;font:12px ui-monospace,monospace;white-space:pre-wrap;';
        pre.textContent = 'Preview render failed:\\n' + (err && err.message ? err.message : String(err));
        rootEl.appendChild(pre);
      }
    })();
  `;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(projectName)} — Preview</title>
    ${PREVIEW_MOCK_SCRIPT}
    <style>
      html, body { margin: 0; padding: 0; background: #fff; color: #111; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
      #root { min-height: 100vh; }
      ${combinedCss}
    </style>
    <script src="${REACT_CDN_URL}" crossorigin></script>
    <script src="${REACT_DOM_CDN_URL}" crossorigin></script>
    <script src="${BABEL_CDN_URL}" crossorigin></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="text/babel" data-type="module" data-presets="env,react,typescript">
${safeForScript(combinedJs)}

${safeForScript(bootstrap)}
    </script>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildFallbackHtml(files: PreviewFile[], projectName: string, note: string): string {
  const list = files
    .slice(0, 50)
    .map((f) => `<li><code>${escapeHtml(norm(f.path))}</code> <span style="color:#94A3B8;">(${f.content.length} chars)</span></li>`)
    .join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(projectName)} — Preview unavailable</title>
    ${PREVIEW_MOCK_SCRIPT}
    <style>
      body { margin:0; padding:24px; background:#07090f; color:#F1F5F9; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
      .card { max-width:560px; margin:40px auto; background:#0F172A; border:1px solid rgba(99,102,241,0.25); border-radius:12px; padding:28px; }
      h1 { font-size:16px; margin:0 0 8px; }
      p  { font-size:13px; color:#94A3B8; margin:0 0 16px; }
      ul { font-size:12px; color:#CBD5E1; max-height:240px; overflow:auto; padding-left:18px; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color:#A5F3FC; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Preview unavailable for “${escapeHtml(projectName)}”</h1>
      <p>${escapeHtml(note)}</p>
      <p>Generated files (${files.length}):</p>
      <ul>${list || '<li>(no files yet)</li>'}</ul>
    </div>
  </body>
</html>`;
}

/**
 * Main entrypoint. Never throws — worst case it returns the fallback HTML.
 */
export function buildPreviewHtml(files: PreviewFile[], projectName = 'Project'): BuildResult {
  try {
    if (!files || files.length === 0) {
      return { html: buildFallbackHtml([], projectName, 'No files have been generated yet.'), mode: 'fallback', note: 'empty' };
    }

    const indexHtml = findIndexHtml(files);
    if (indexHtml) {
      return { html: buildIndexHtmlMode(indexHtml.content), mode: 'index-html' };
    }

    const entry = findReactEntry(files);
    if (entry) {
      return { html: buildReactSynthHtml(files, entry, projectName), mode: 'react-synth' };
    }

    return {
      html: buildFallbackHtml(files, projectName, 'No renderable entry point detected (missing index.html and App.tsx/App.jsx).'),
      mode: 'fallback',
      note: 'no-entry',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      html: buildFallbackHtml(files ?? [], projectName, 'Preview builder threw: ' + msg),
      mode: 'fallback',
      note: 'builder-threw',
    };
  }
}
