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

/** Minimal POSIX-style path resolver for joining an importer directory with a relative import. */
function joinPath(dir: string, rel: string): string {
  const parts = (dir ? dir.split('/') : []).filter((p) => p && p !== '.');
  for (const seg of rel.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop(); else parts.push(seg);
  }
  return parts.join('/');
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

/** Backend/server-only files that must never enter the browser preview bundle. */
function isBackendFile(path: string): boolean {
  const p = norm(path).toLowerCase();
  return (
    /(?:^|\/)(?:backend|server|api)\//.test(p) ||
    /(?:^|\/)prisma\//.test(p) ||
    /(?:^|\/)passport\.(?:jsx?|tsx?)$/.test(p) ||
    /(?:^|\/)socket\.(?:jsx?|tsx?)$/.test(p) ||
    /(?:^|\/)middleware\//.test(p) ||
    /(?:^|\/)controllers?\//.test(p) ||
    /(?:^|\/)models?\//.test(p)
  );
}

/** Detects server-only imports inside a file's content — belt-and-suspenders for `isBackendFile`. */
const SERVER_ONLY_IMPORT_RE = /from\s+['"](?:express|fastify|@fastify\/[^'"]+|passport|passport-[^'"]+|jsonwebtoken|bcrypt(?:js)?|@prisma\/client|prisma|mongoose|pg|mysql2?|sqlite3|redis|ioredis|nodemailer|multer|helmet|morgan|cookie-parser|body-parser|dotenv|fs|fs\/promises|path|crypto|os|http|https|net|dgram|child_process|cluster|worker_threads|stream|util|events|url|querystring)['"]/;
function hasServerOnlyImports(content: string): boolean {
  return SERVER_ONLY_IMPORT_RE.test(content);
}

/** Strip ES module syntax so every file runs in the shared Babel scope. */
function stripModuleSyntax(code: string, ctx?: { selfPath?: string; resolveDefault?: (rel: string) => string | null }): string {
  let out = code;

  // Stable id we use to alias this file's default export so other files can reference it.
  const selfKey = ctx?.selfPath ? pathToDefaultKey(ctx.selfPath) : '';
  const resolveDefault = ctx?.resolveDefault ?? (() => null);
  const defaultBindings: string[] = [];

  // -1) Capture default imports BEFORE stripping. Forms handled:
  //     `import Alias from '<rel>'`
  //     `import Alias, { a, b } from '<rel>'`
  //     `import { default as Alias } from '<rel>'`
  out = out.replace(/\bimport\s+(\w+)\s*,\s*\{[\s\S]*?\}\s*from\s+['"]([^'"]+)['"]\s*;?/g, (full, alias: string, rel: string) => {
    const k = resolveDefault(rel); if (k) defaultBindings.push(`var ${alias} = ${k};`);
    return ''; // whole import removed by later pass anyway, but strip now for clarity
  });
  out = out.replace(/\bimport\s+(\w+)\s+from\s+['"]([^'"]+)['"]\s*;?/g, (_full, alias: string, rel: string) => {
    const k = resolveDefault(rel); if (k) defaultBindings.push(`var ${alias} = ${k};`);
    return '';
  });
  out = out.replace(/\bimport\s*\{\s*default\s+as\s+(\w+)\s*\}\s*from\s+['"]([^'"]+)['"]\s*;?/g, (_full, alias: string, rel: string) => {
    const k = resolveDefault(rel); if (k) defaultBindings.push(`var ${alias} = ${k};`);
    return '';
  });

  // 0) Capture icon imports BEFORE stripping so the identifiers map to __makeIcon(name) stubs.
  const iconAliases: string[] = [];
  const iconPackageRe = /(?:lucide-react|react-icons\/[^'"]+|@heroicons\/[^'"]+|react-feather|@radix-ui\/react-icons|phosphor-react|@phosphor-icons\/react|@tabler\/icons-react)/;
  const iconImportRe = new RegExp(`\\bimport\\s*\\{([\\s\\S]*?)\\}\\s*from\\s*['"](?:${iconPackageRe.source})['"]\\s*;?`, 'g');
  out = out.replace(iconImportRe, (_m, names: string) => {
    for (const raw of String(names).split(',')) {
      const piece = raw.trim(); if (!piece) continue;
      const parts = piece.split(/\s+as\s+/);
      const local = (parts[1] || parts[0]).trim();
      if (/^\w+$/.test(local)) iconAliases.push(`var ${local} = __makeIcon(${JSON.stringify(local)});`);
    }
    return '';
  });

  // 1) Strip every remaining import declaration.
  out = out.replace(/\bimport\s+type\s+[\s\S]*?from\s+['"][^'"]+['"]\s*;?/g, '');
  out = out.replace(/\bimport\s+(?:\w+\s*,\s*)?\{[\s\S]*?\}\s*(?:,\s*\w+\s*)?from\s+['"][^'"]+['"]\s*;?/g, '');
  out = out.replace(/\bimport\s+\*\s+as\s+\w+\s+from\s+['"][^'"]+['"]\s*;?/g, '');
  out = out.replace(/\bimport\s+\w+\s+from\s+['"][^'"]+['"]\s*;?/g, '');
  out = out.replace(/\bimport\s*['"][^'"]+['"]\s*;?/g, '');

  // 2) Re-export forms.
  out = out.replace(/^\s*export\s*\*(?:\s+as\s+\w+)?\s+from\s+['"][^'"]+['"]\s*;?\s*$/gm, '');
  out = out.replace(/\bexport\s*\{[\s\S]*?\}\s*from\s+['"][^'"]+['"]\s*;?/g, '');

  // 3) `export { a, b }` lists.
  out = out.replace(/\bexport\s*\{[\s\S]*?\}\s*;?/g, '');

  // 4) `export default <...>` — capture so other files can reference this file's default.
  if (selfKey) {
    out = out.replace(/\bexport\s+default\s+function\s+(\w+)([\s\S]*?)(?=\n\}|\}\s*$|\}\s*\n)/m, (_m, name: string, tail: string) => {
      // Fallback — this pattern is tricky to end-match. Keep the function and append alias.
      return `function ${name}${tail}`; // body close handled by original code
    });
    // Simpler, robust transforms:
    out = out.replace(/\bexport\s+default\s+function\s+(\w+)\s*\(/g, (_m, name: string) => {
      defaultBindings.push(`/* default-bind emitted at end */`); // placeholder
      // After this function declaration, we need to emit `var __default_<selfKey> = <name>;`.
      // We can't easily append inline here, so we do it via a sentinel handled after.
      __pendingDefaultAliasNames.push([selfKey, name]);
      return `function ${name}(`;
    });
    out = out.replace(/\bexport\s+default\s+class\s+(\w+)/g, (_m, name: string) => {
      __pendingDefaultAliasNames.push([selfKey, name]);
      return `class ${name}`;
    });
    // `export default <expression>;` — convert to assignment.
    out = out.replace(/\bexport\s+default\s+/g, `var ${selfKey} = `);
  } else {
    out = out.replace(/\bexport\s+default\s+/g, '');
  }

  // 5) Type-only export keywords.
  out = out.replace(/\bexport\s+(type|interface|enum|namespace|abstract|declare)\b/g, '$1');

  // 6) Runtime export keyword → strip.
  out = out.replace(/\bexport\s+(const|let|var|function|class|async\s+function)\b/g, '$1');

  // 7) Line-initial const/let → var (cross-file redeclaration safety).
  out = out.replace(/^(\s*)(const|let)(\s+)/gm, '$1var$3');

  // 8) Prepend default-import bindings, then icon aliases.
  const preamble: string[] = [];
  if (defaultBindings.length > 0) preamble.push(defaultBindings.filter((l) => !l.startsWith('/*')).join('\n'));
  if (iconAliases.length > 0) preamble.push(iconAliases.join('\n'));
  if (preamble.length > 0) out = preamble.join('\n') + '\n' + out;

  // 9) Neutralize user bootstrap calls.
  out = stripCallStatement(out, /\bReactDOM\s*\.\s*render\s*\(/g);
  out = stripCallStatement(out, /\bReactDOM\s*\.\s*hydrate\s*\(/g);
  out = stripCallStatement(out, /\bhydrateRoot\s*\(/g);
  out = stripCreateRootRender(out);

  // 10) If this file had a default-exported named function/class, append the binding.
  if (selfKey) {
    for (const [key, name] of __pendingDefaultAliasNames) {
      if (key === selfKey) out += `\nvar ${key} = ${name};`;
    }
    // clear self entries
    __pendingDefaultAliasNames = __pendingDefaultAliasNames.filter(([k]) => k !== selfKey);
  }

  return out;
}

/** Module-scope scratch for default-alias emissions keyed by file's default-export key. */
let __pendingDefaultAliasNames: Array<[string, string]> = [];

/** Convert a normalized source-file path into a stable identifier used as that file's default export alias. */
function pathToDefaultKey(p: string): string {
  const withoutExt = norm(p).replace(/\.(?:[jt]sx?|mjs|cjs)$/i, '');
  return '__dflt_' + withoutExt.replace(/[^a-zA-Z0-9_]/g, '_');
}

/** Consume one parenthesized group starting at `start` (which points to the `(`). Returns index after matching `)` + optional trailing `;`, or -1. */
function consumeParenGroup(src: string, start: number): number {
  if (src[start] !== '(') return -1;
  let depth = 0, inStr: string | null = null, esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) {
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j])) j++;
      if (src[j] === ';') j++;
      return j;
    } }
  }
  return -1;
}

/** Strip statements matching `<prefixRe>(...)[;]` with balanced parens. */
function stripCallStatement(src: string, prefixRe: RegExp): string {
  let out = '', i = 0; prefixRe.lastIndex = 0;
  let m: RegExpExecArray | null;
  const hits: Array<[number, number]> = [];
  while ((m = prefixRe.exec(src)) !== null) {
    const parenAt = m.index + m[0].length - 1; // m[0] ends with `(`
    const end = consumeParenGroup(src, parenAt);
    if (end > 0) hits.push([m.index, end]);
  }
  if (hits.length === 0) return src;
  for (const [s, e] of hits) { out += src.slice(i, s) + '/* bootstrap suppressed */'; i = e; }
  return out + src.slice(i);
}

/** Strip `[ReactDOM.]createRoot(...).render(...)` with balanced parens on both calls. */
function stripCreateRootRender(src: string): string {
  const re = /\b(?:ReactDOM\s*\.\s*)?createRoot\s*\(/g;
  let out = '', i = 0, m: RegExpExecArray | null;
  const hits: Array<[number, number]> = [];
  while ((m = re.exec(src)) !== null) {
    const parenAt = m.index + m[0].length - 1;
    const afterCreate = consumeParenGroupNoSemi(src, parenAt);
    if (afterCreate < 0) continue;
    // Expect `.render(`
    const renderMatch = src.slice(afterCreate).match(/^\s*\.\s*render\s*\(/);
    if (!renderMatch) continue;
    const renderParen = afterCreate + renderMatch[0].length - 1;
    const end = consumeParenGroup(src, renderParen);
    if (end > 0) hits.push([m.index, end]);
  }
  if (hits.length === 0) return src;
  for (const [s, e] of hits) { out += src.slice(i, s) + '/* createRoot suppressed */'; i = e; }
  return out + src.slice(i);
}
function consumeParenGroupNoSemi(src: string, start: number): number {
  if (src[start] !== '(') return -1;
  let depth = 0, inStr: string | null = null, esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (esc) { esc = false; continue; } if (c === '\\') { esc = true; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

/** Order files so App.* comes last (ensuring its dependencies are defined). */
function orderForSynth(files: PreviewFile[]): PreviewFile[] {
  const isBootstrapEntry = (f: PreviewFile): boolean => {
    const p = norm(f.path).toLowerCase();
    // Must be a JSX/TSX bootstrap filename AND actually contain a render call.
    if (!/(?:^|\/)(?:main|index|bootstrap|entry)\.(?:jsx?|tsx?)$/.test(p)) return false;
    return /\b(?:ReactDOM\.(?:render|hydrate)|(?:ReactDOM\.)?createRoot|hydrateRoot)\b/.test(f.content);
  };
  const score = (f: PreviewFile): number => {
    const p = norm(f.path).toLowerCase();
    if (/(?:^|\/)app\.(?:jsx?|tsx?)$/.test(p))       return 100;
    if (isBootstrapEntry(f))                         return 5;
    if (/(?:^|\/)pages?\//.test(p))                  return 80;
    if (/(?:^|\/)routes?\//.test(p))                 return 80;
    if (/(?:^|\/)layouts?\//.test(p))                return 75;
    if (/(?:^|\/)features?\//.test(p))               return 70;
    if (/(?:^|\/)slices?\//.test(p))                 return 45;
    if (/(?:^|\/)reducers?\//.test(p))               return 47;
    if (/(?:^|\/)store\//.test(p))                   return 65;
    if (/(?:^|\/)components?\//.test(p))             return 55;
    if (/(?:^|\/)hooks?\//.test(p))                  return 35;
    if (/(?:^|\/)utils?\//.test(p))                  return 25;
    if (/(?:^|\/)types?\//.test(p))                  return 15;
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

function buildSymbolPrelude(): string {
  return `
/* ── preview symbol prelude ──────────────────────────────────────────── */
var {
  useState, useEffect, useRef, useMemo, useCallback, useContext, useReducer,
  useLayoutEffect, useImperativeHandle, useDebugValue, useId, useDeferredValue,
  useTransition, useSyncExternalStore, useInsertionEffect,
  createContext, createElement, cloneElement, isValidElement, Fragment,
  forwardRef, memo, lazy, Suspense, StrictMode, Component, PureComponent, Children,
  createRef
} = React;

/* react-router-dom v6 shims — pass-through layout, no-op nav. */
function BrowserRouter(p) { return p.children; }
function HashRouter(p) { return p.children; }
function MemoryRouter(p) { return p.children; }
function Router(p) { return p.children; }
function Routes(p) { return p.children; }
function Route(p) { return p.element || null; }
function Navigate() { return null; }
function Outlet() { return null; }
function Link(p) {
  var href = p && (p.to || p.href) || '#';
  var rest = {}; for (var k in p) if (k !== 'to') rest[k] = p[k];
  rest.href = href; rest.onClick = function (e) { if (e && e.preventDefault) e.preventDefault(); };
  return React.createElement('a', rest, p && p.children);
}
function NavLink(p) { return Link(p); }
function useNavigate() { return function () {}; }
function useParams() { return {}; }
function useLocation() { return { pathname: '/', search: '', hash: '', state: null }; }
function useSearchParams() { return [new URLSearchParams(), function () {}]; }
function useMatch() { return null; }
function useRoutes(routes) { return (routes && routes[0] && routes[0].element) || null; }
function useOutletContext() { return {}; }

/* redux */
function createStore(reducer, preloadedState) {
  var state = preloadedState === undefined ? (reducer ? reducer(undefined, { type: '@@INIT' }) : {}) : preloadedState;
  return {
    getState: function () { return state; },
    dispatch: function (a) {
      if (typeof a === 'function') { try { return a(this.dispatch.bind(this), this.getState.bind(this)); } catch (_) { return a; } }
      try { state = reducer ? reducer(state, a) : state; } catch (_) {}
      return a;
    },
    subscribe: function () { return function () {}; },
    replaceReducer: function () {}
  };
}
function combineReducers(reducers) {
  return function (state, action) {
    state = state || {};
    var next = {};
    for (var k in reducers) { try { next[k] = reducers[k](state[k], action); } catch (_) { next[k] = state[k]; } }
    return next;
  };
}
function applyMiddleware() { return function (cs) { return cs; }; }
function compose() { var fns = [].slice.call(arguments); return fns.reduce(function (a, b) { return function () { return a(b.apply(null, arguments)); }; }, function (x) { return x; }); }
function bindActionCreators(acs, dispatch) {
  var out = {};
  for (var k in acs) { (function (key) { out[key] = function () { return dispatch(acs[key].apply(null, arguments)); }; })(k); }
  return out;
}

/* react-redux */
var __previewStore = null;
function Provider(p) { if (p && p.store) __previewStore = p.store; return p.children; }
function __safeState() {
  if (__previewStore && typeof __previewStore.getState === 'function') {
    try { var s = __previewStore.getState(); if (s && typeof s === 'object') return __wrapSafe(s); } catch (_) {}
  }
  return __wrapSafe({});
}
function __wrapSafe(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (typeof Proxy !== 'function') return obj;
  return new Proxy(obj, {
    get: function (t, k) {
      // Allow primitive coercion and iteration to succeed cleanly.
      if (k === Symbol.toPrimitive) return function () { return ''; };
      if (k === Symbol.iterator) return undefined;
      if (k === 'toString' || k === 'valueOf') return function () { return ''; };
      if (k === 'then') return undefined; // not thenable
      if (k === Symbol.toStringTag) return 'Object';
      if (k in t) { var v = t[k]; return (v && typeof v === 'object') ? __wrapSafe(v) : v; }
      return __wrapSafe({});
    }
  });
}
function useSelector(fn) { try { return fn ? fn(__safeState()) : undefined; } catch (_) { return undefined; } }
function useDispatch() { return function (a) { try { return __previewStore ? __previewStore.dispatch(a) : a; } catch (_) { return a; } }; }
function useStore() { return __previewStore || createStore(); }
function connect() { return function (C) { return C; }; }
function shallowEqual(a, b) { return a === b; }

/* @reduxjs/toolkit */
function createSlice(opts) {
  opts = opts || {};
  var name = opts.name || 'slice';
  var actions = {};
  var reducers = opts.reducers || {};
  for (var k in reducers) {
    (function (key) {
      var type = name + '/' + key;
      actions[key] = function (payload) { return { type: type, payload: payload }; };
      actions[key].type = type;
    })(k);
  }
  return {
    name: name,
    reducer: function (state, action) {
      state = state === undefined ? (opts.initialState || {}) : state;
      if (action && typeof action.type === 'string') {
        var short = action.type.split('/').pop();
        if (reducers[short]) {
          try {
            var draft = Object.assign({}, state);
            var r = reducers[short](draft, action);
            return r === undefined ? draft : r;
          } catch (_) { return state; }
        }
      }
      return state;
    },
    actions: actions,
    getInitialState: function () { return opts.initialState || {}; }
  };
}
function configureStore(opts) {
  opts = opts || {};
  var reducer = typeof opts.reducer === 'function' ? opts.reducer : combineReducers(opts.reducer || {});
  __previewStore = createStore(reducer, opts.preloadedState);
  return __previewStore;
}
function createAsyncThunk(type, fn) {
  var thunk = function (arg) {
    return function (dispatch) {
      dispatch({ type: type + '/pending', meta: { arg: arg } });
      return Promise.resolve().then(function () { return fn(arg, { dispatch: dispatch, getState: function () { return {}; }, rejectWithValue: function (v) { return { __reject: v }; } }); })
        .then(function (r) { dispatch({ type: type + '/fulfilled', payload: r, meta: { arg: arg } }); return r; })
        .catch(function (e) { dispatch({ type: type + '/rejected', error: e, meta: { arg: arg } }); });
    };
  };
  thunk.pending = { type: type + '/pending' };
  thunk.fulfilled = { type: type + '/fulfilled' };
  thunk.rejected = { type: type + '/rejected' };
  thunk.typePrefix = type;
  return thunk;
}
function createAction(type) { var ac = function (payload) { return { type: type, payload: payload }; }; ac.type = type; ac.toString = function () { return type; }; return ac; }
function createReducer(initial, cases) {
  return function (state, action) {
    state = state === undefined ? initial : state;
    if (cases && action && cases[action.type]) { try { return cases[action.type](state, action) || state; } catch (_) { return state; } }
    return state;
  };
}
function createSelector() {
  var fns = [].slice.call(arguments);
  var resultFn = fns.pop();
  return function () {
    var self = this, outer = arguments;
    var args = fns.map(function (f) { try { return f.apply(self, outer); } catch (_) { return undefined; } });
    try { return resultFn.apply(null, args); } catch (_) { return undefined; }
  };
}
var nanoid = function () { return 'preview_' + Math.random().toString(36).slice(2, 10); };

/* axios — routes through fetch so the mock layer handles it. */
var axios = (function () {
  function req(config) {
    config = typeof config === 'string' ? { url: config } : (config || {});
    var opts = { method: config.method || 'GET', headers: config.headers || {} };
    if (config.data !== undefined) opts.body = typeof config.data === 'string' ? config.data : JSON.stringify(config.data);
    return fetch(config.url || '/', opts).then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (data) { return { data: data, status: 200, headers: {}, config: config }; });
  }
  var methods = ['get', 'delete', 'head', 'options'];
  var dataMethods = ['post', 'put', 'patch'];
  var instance = function (c) { return req(c); };
  instance.request = req;
  methods.forEach(function (m) { instance[m] = function (url, cfg) { return req(Object.assign({}, cfg, { url: url, method: m })); }; });
  dataMethods.forEach(function (m) { instance[m] = function (url, data, cfg) { return req(Object.assign({}, cfg, { url: url, method: m, data: data })); }; });
  instance.create = function () { return instance; };
  instance.defaults = { headers: { common: {} } };
  instance.interceptors = { request: { use: function () {}, eject: function () {} }, response: { use: function () {}, eject: function () {} } };
  instance.isAxiosError = function () { return false; };
  return instance;
})();

/* zod — pass-through schemas. */
var z = (function () {
  function schema() {
    var s = {};
    s.parse = function (v) { return v; };
    s.safeParse = function (v) { return { success: true, data: v }; };
    s.optional = function () { return s; }; s.nullable = function () { return s; }; s.default = function () { return s; };
    s.refine = function () { return s; }; s.transform = function () { return s; };
    s.min = function () { return s; }; s.max = function () { return s; }; s.length = function () { return s; };
    s.email = function () { return s; }; s.url = function () { return s; }; s.uuid = function () { return s; }; s.regex = function () { return s; };
    s.array = function () { return s; }; s.and = function () { return s; }; s.or = function () { return s; };
    s.describe = function () { return s; }; s.pipe = function () { return s; };
    return s;
  }
  return {
    string: schema, number: schema, boolean: schema, date: schema, bigint: schema,
    any: schema, unknown: schema, never: schema, void: schema, null: schema, undefined: schema,
    literal: schema, enum: schema, nativeEnum: schema,
    object: schema, array: schema, tuple: schema, record: schema, map: schema, set: schema,
    union: schema, intersection: schema, discriminatedUnion: schema,
    lazy: schema, promise: schema, function: schema,
    coerce: { string: schema, number: schema, boolean: schema, date: schema, bigint: schema }
  };
})();

/* clsx / classnames / tailwind-merge / cn */
function clsx() {
  var out = [];
  for (var i = 0; i < arguments.length; i++) {
    var a = arguments[i]; if (!a) continue;
    if (typeof a === 'string' || typeof a === 'number') out.push(a);
    else if (Array.isArray(a)) { var inner = clsx.apply(null, a); if (inner) out.push(inner); }
    else if (typeof a === 'object') { for (var k in a) if (a[k]) out.push(k); }
  }
  return out.join(' ');
}
var classnames = clsx; function twMerge() { return clsx.apply(null, arguments); } function cn() { return clsx.apply(null, arguments); }

/* date-fns */
function format(d) { try { return new Date(d).toLocaleString(); } catch (_) { return String(d); } }
function formatDistanceToNow(d) {
  try {
    var diff = Date.now() - new Date(d).getTime();
    var s = Math.floor(diff / 1000); if (s < 60) return s + 's ago';
    var m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  } catch (_) { return String(d); }
}
function parseISO(s) { return new Date(s); }

/* socket.io-client */
function io() {
  var handlers = {};
  return {
    on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return this; },
    off: function () { return this; }, emit: function () { return this; },
    disconnect: function () {}, close: function () {}, connect: function () { return this; }, connected: true
  };
}

/* Generic icon catch-all — lucide-react, @heroicons/*, react-icons/*, react-feather */
function __makeIcon(name) {
  return function (props) {
    props = props || {};
    var size = props.size || 16;
    return React.createElement('svg', {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth: 2, className: props.className, style: props.style,
      'aria-label': String(name)
    }, React.createElement('circle', { cx: 12, cy: 12, r: 8, key: 'c' }));
  };
}
/* ── end prelude ─────────────────────────────────────────────────────── */
`;
}


function buildReactSynthHtml(files: PreviewFile[], entry: PreviewFile, projectName: string): string {
  const appIdent = extractAppIdentifier(entry);
  const sources = orderForSynth(files.filter((f) =>
    isJsLike(f.path) &&
    !isTestFile(f.path) &&
    !isBackendFile(f.path) &&
    !hasServerOnlyImports(f.content)
  ));
  const styles  = files.filter((f) => isCssLike(f.path) && !isTestFile(f.path));

  // Build a lookup so `import X from '<rel>'` can resolve to the target file's
  // default-export key. Keys are normalized paths without extension.
  const byKey = new Map<string, string>();
  for (const f of sources) {
    const key = norm(f.path).replace(/\.(?:[jt]sx?|mjs|cjs)$/i, '');
    byKey.set(key, pathToDefaultKey(f.path));
  }
  const resolveDefaultKey = (importerPath: string, rel: string): string | null => {
    // Bare package imports — not resolvable to a local file.
    if (!/^[./]/.test(rel)) return null;
    const importerDir = norm(importerPath).split('/').slice(0, -1).join('/');
    const joined = joinPath(importerDir, rel).replace(/\.(?:[jt]sx?|mjs|cjs)$/i, '');
    if (byKey.has(joined)) return byKey.get(joined)!;
    if (byKey.has(joined + '/index')) return byKey.get(joined + '/index')!;
    return null;
  };

  const combinedJs = [
    buildSymbolPrelude(),
    ...sources.map((f) => `/* ── ${norm(f.path)} ── */\n${stripModuleSyntax(f.content, {
      selfPath: f.path,
      resolveDefault: (rel) => resolveDefaultKey(f.path, rel),
    })}`),
  ].join('\n\n');

  // Tailwind CDN handles @tailwind / @apply at runtime. Strip them from user CSS to avoid
  // CSSOM parse errors if Tailwind isn't loaded yet (the CDN script handles them separately).
  const cleanedCss = styles
    .map((f) => `/* ${norm(f.path)} */\n${f.content}`)
    .join('\n\n')
    .replace(/@tailwind\s+[^;]+;?/g, '')
    .replace(/@apply\s+[^;]+;?/g, '');

  // Root-level React error boundary. Wraps the user's <App/> so a render-time throw
  // shows a readable fallback instead of React's silent mount-bail behaviour.
  const bootstrap = `
    (function () {
      var rootEl = document.getElementById('root') || document.getElementById('app');
      if (!rootEl) {
        rootEl = document.createElement('div');
        rootEl.id = 'root';
        document.body.appendChild(rootEl);
      }
      function ErrorFallback(props) {
        return React.createElement('div', {
          style: { padding: '24px', background: '#0F172A', color: '#F1F5F9', fontFamily: 'system-ui,sans-serif', minHeight: '100vh' }
        }, [
          React.createElement('div', { key: 'h', style: { fontSize: '14px', fontWeight: 600, marginBottom: '8px', color: '#F59E0B' } }, '⚠ Component render failed'),
          React.createElement('pre', { key: 'm', style: { fontSize: '12px', color: '#CBD5E1', whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace,monospace', margin: 0 } }, props.message || 'Unknown error'),
          React.createElement('div', { key: 'f', style: { fontSize: '11px', color: '#64748B', marginTop: '12px' } }, 'Preview kept alive — the harness caught the error.')
        ]);
      }
      function PreviewBoundary() {
        var inst = Object.create(React.Component.prototype);
        return inst;
      }
      var PreviewErrorBoundary = (function () {
        function Boundary(props) {
          React.Component.call(this, props);
          this.state = { err: null };
        }
        Boundary.prototype = Object.create(React.Component.prototype);
        Boundary.prototype.constructor = Boundary;
        Boundary.getDerivedStateFromError = function (err) { return { err: err }; };
        Boundary.prototype.componentDidCatch = function (err) {
          try { console.error('[preview]', (err && err.message) || String(err)); } catch (_) {}
        };
        Boundary.prototype.render = function () {
          if (this.state && this.state.err) {
            return React.createElement(ErrorFallback, { message: (this.state.err && this.state.err.message) || String(this.state.err) });
          }
          return this.props.children;
        };
        return Boundary;
      })();
      try {
        var Component = (typeof ${appIdent} !== 'undefined') ? ${appIdent} : null;
        if (!Component) {
          rootEl.innerHTML = '';
          var el = document.createElement('pre');
          el.style.cssText = 'padding:16px;color:#F87171;background:#111827;font:12px ui-monospace,monospace;white-space:pre-wrap;';
          el.textContent = 'No default-exported component found (expected: ${appIdent}).';
          rootEl.appendChild(el);
          return;
        }
        var tree = React.createElement(PreviewErrorBoundary, null, React.createElement(Component));
        if (ReactDOM.createRoot) {
          ReactDOM.createRoot(rootEl).render(tree);
        } else {
          ReactDOM.render(tree, rootEl);
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
      ${cleanedCss}
    </style>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="${REACT_CDN_URL}" crossorigin></script>
    <script src="${REACT_DOM_CDN_URL}" crossorigin></script>
    <script src="${BABEL_CDN_URL}" crossorigin></script>
  </head>
  <body>
    <div id="root"></div>
    <script id="__preview_src" type="text/plain">
${safeForScript(combinedJs)}

${safeForScript(bootstrap)}
    </script>
    <script>
      (function () {
        function showErr(title, msg) {
          var r = document.getElementById('root') || document.body;
          r.innerHTML = '';
          var wrap = document.createElement('div');
          wrap.style.cssText = 'padding:24px;background:#0F172A;color:#F1F5F9;font-family:system-ui,sans-serif;min-height:100vh;';
          var h = document.createElement('div');
          h.style.cssText = 'font-size:14px;font-weight:600;margin-bottom:8px;color:#F59E0B;';
          h.textContent = '⚠ ' + title;
          var pre = document.createElement('pre');
          pre.style.cssText = 'font-size:12px;color:#CBD5E1;white-space:pre-wrap;font-family:ui-monospace,monospace;margin:0;';
          pre.textContent = String(msg);
          wrap.appendChild(h); wrap.appendChild(pre);
          r.appendChild(wrap);
        }
        function run() {
          var srcEl = document.getElementById('__preview_src');
          var src = srcEl ? srcEl.textContent : '';
          if (!src) { showErr('Preview source missing', 'No __preview_src script tag found.'); return; }
          if (typeof Babel === 'undefined') { showErr('Babel failed to load', 'The Babel standalone CDN did not load. Check network.'); return; }
          var res;
          try {
            res = Babel.transform(src, {
              presets: [
                ['env', { targets: { esmodules: true }, modules: false, loose: true }],
                ['react', {}],
                ['typescript', { allExtensions: true, isTSX: true, onlyRemoveTypeImports: true }],
              ],
              plugins: [],
              filename: 'preview.tsx',
              sourceType: 'unambiguous',
              compact: false,
            });
          } catch (e) { showErr('Transpile failed', (e && e.message) || String(e)); return; }
          try { (0, eval)(res.code); }
          catch (e) { showErr('Runtime error', (e && e.message) || String(e)); }
        }
        if (window.Babel && window.React && window.ReactDOM) run();
        else window.addEventListener('load', run);
      })();
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
