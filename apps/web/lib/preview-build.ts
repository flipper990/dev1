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

const REACT_CDN_URLS     = [
  'https://unpkg.com/react@18/umd/react.development.js',
  'https://cdn.jsdelivr.net/npm/react@18/umd/react.development.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.development.js',
];
const REACT_DOM_CDN_URLS = [
  'https://unpkg.com/react-dom@18/umd/react-dom.development.js',
  'https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.development.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.development.js',
];
const BABEL_CDN_URLS     = [
  'https://unpkg.com/@babel/standalone/babel.min.js',
  'https://cdn.jsdelivr.net/npm/@babel/standalone/babel.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.22.17/babel.min.js',
];
const TAILWIND_CDN_URLS  = [
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4/dist/index.global.min.js',
];

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

/**
 * Detects server-only imports inside a file's content — belt-and-suspenders for `isBackendFile`.
 * NOTE: `crypto` is intentionally omitted (browser has `window.crypto`); `url`/`util` also kept
 * out because they have browser equivalents and are commonly used npm-package names. We only
 * filter packages that have NO browser equivalent and are unambiguously backend-only.
 */
const SERVER_ONLY_IMPORT_RE = /from\s+['"](?:express|fastify|@fastify\/[^'"]+|passport|passport-[^'"]+|jsonwebtoken|bcrypt(?:js)?|@prisma\/client|prisma|mongoose|pg|mysql2?|sqlite3|redis|ioredis|nodemailer|multer|helmet|morgan|cookie-parser|body-parser|dotenv|fs|fs\/promises|child_process|cluster|worker_threads|net|dgram|http|https)['"]/;
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
  // Per-call scratch for default-export name aliasing. Previously this was a
  // module-scope array — it leaked across builds and caused phantom aliases.
  const localPendingDefaults: Array<[string, string]> = [];

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
  // IMPORTANT: The previously-present "tricky to end-match" regex that tried to
  // match the full function body has been removed — it mangled the source before
  // the correct regex below could run. Now we only do the two safe transforms:
  // named-function / named-class → emit alias after declaration, expression → assignment.
  if (selfKey) {
    out = out.replace(/\bexport\s+default\s+function\s+(\w+)\s*\(/g, (_m, name: string) => {
      localPendingDefaults.push([selfKey, name]);
      return `function ${name}(`;
    });
    out = out.replace(/\bexport\s+default\s+class\s+(\w+)/g, (_m, name: string) => {
      localPendingDefaults.push([selfKey, name]);
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
    for (const [key, name] of localPendingDefaults) {
      if (key === selfKey) out += `\nvar ${key} = ${name};`;
    }
  }

  return out;
}

/** Convert a normalized source-file path into a stable identifier used as that file's default export alias. */
function pathToDefaultKey(p: string): string {
  const withoutExt = norm(p).replace(/\.(?:[jt]sx?|mjs|cjs)$/i, '');
  return '__dflt_' + withoutExt.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Identifiers the prelude / browser already provides. Used to filter the
 * universal-stub auto-declarator so we never override a real binding.
 *
 * This MUST be a superset of every symbol emitted by `buildSymbolPrelude()`
 * plus the standard browser globals (React, console, etc.). Adding a new
 * prelude symbol? Add it here too.
 */
const PRELUDE_GLOBALS = new Set<string>([
  // JS / browser builtins
  'React','ReactDOM','window','document','console','Math','Date','Object','Array','String','Number','Boolean',
  'JSON','RegExp','Error','TypeError','ReferenceError','SyntaxError','Map','Set','WeakMap','WeakSet',
  'Promise','Symbol','Proxy','Reflect','Intl','URL','URLSearchParams','FormData','Blob','File','FileReader',
  'Headers','Request','Response','AbortController','AbortSignal','Event','EventTarget','CustomEvent',
  'Image','Audio','Video','XMLHttpRequest','WebSocket','Worker','Notification',
  'localStorage','sessionStorage','location','history','navigator','screen','performance',
  'setTimeout','setInterval','clearTimeout','clearInterval','requestAnimationFrame','cancelAnimationFrame',
  'fetch','atob','btoa','structuredClone','queueMicrotask','crypto',
  'Infinity','NaN','undefined','globalThis','Function','Array','ArrayBuffer','DataView',
  'Int8Array','Uint8Array','Int16Array','Uint16Array','Int32Array','Uint32Array','Float32Array','Float64Array',
  // React hooks / primitives from prelude
  'useState','useEffect','useRef','useMemo','useCallback','useContext','useReducer',
  'useLayoutEffect','useImperativeHandle','useDebugValue','useId','useDeferredValue',
  'useTransition','useSyncExternalStore','useInsertionEffect',
  'createContext','createElement','cloneElement','isValidElement','Fragment',
  'forwardRef','memo','lazy','Suspense','StrictMode','Component','PureComponent','Children','createRef',
  // router shims
  'BrowserRouter','HashRouter','MemoryRouter','Router','Routes','Route','Navigate','Outlet','Link','NavLink',
  'useNavigate','useParams','useLocation','useSearchParams','useMatch','useRoutes','useOutletContext',
  // redux + toolkit
  'createStore','combineReducers','applyMiddleware','compose','bindActionCreators',
  'Provider','useSelector','useDispatch','useStore','connect','shallowEqual',
  'createSlice','configureStore','createAsyncThunk','createAction','createReducer','createSelector','nanoid',
  // common libs stubbed in prelude
  'axios','z','clsx','classnames','twMerge','cn','format','formatDistanceToNow','parseISO','io',
  // framer-motion
  'motion','AnimatePresence','useAnimation','useAnimationControls','useMotionValue','useTransform',
  'useScroll','useSpring','useInView','useMotionTemplate','useReducedMotion','LayoutGroup','LazyMotion',
  'domAnimation','domMax','m',
  '__makeIcon','__previewStore','__safeState','__wrapSafe','__universalStub',
  // JSX intrinsics (lowercase tags don't match our capital-letter regex anyway,
  // but Babel sometimes references these) + common React-internal names
  'jsx','jsxs','jsxDEV',
]);

/**
 * Scan the concatenated (but still-pre-Babel) source for capital-letter
 * identifiers used in a component/constructor position, and emit a universal
 * stub `var X = __universalStub('X');` for each one that isn't declared
 * anywhere in the source.
 *
 * This is the structural cure for the "fix one undefined identifier → the
 * next library breaks" loop: an app can now reference any component from any
 * unstubbed library and still render something visible.
 */
function injectUniversalStubs(combined: string): string {
  // ── Strip comments + strings so we don't false-positive on text inside
  //    strings (e.g. `'use client'`, jsdoc @param Foo).
  const scannable = combined
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^\\])\/\/[^\n]*/g, '$1')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');

  // ── Collect declared identifiers (var/let/const/function/class — plus the
  //    converted `function X` / `class X` forms).
  const declared = new Set<string>();
  const declRe = /\b(?:var|let|const|function|class)\s+([A-Z]\w*)/g;
  let dm: RegExpExecArray | null;
  while ((dm = declRe.exec(scannable)) !== null) declared.add(dm[1]);

  // Also pick up destructured declarations: `var { Foo, Bar } = ...`.
  const destrRe = /\b(?:var|let|const)\s*\{([^}]+)\}/g;
  let em: RegExpExecArray | null;
  while ((em = destrRe.exec(scannable)) !== null) {
    for (const piece of em[1].split(',')) {
      const name = piece.split(/\s*:\s*/)[1]?.trim() || piece.trim();
      const clean = name.replace(/\s*=.*$/, '').trim();
      if (/^[A-Z]\w*$/.test(clean)) declared.add(clean);
    }
  }

  // ── Collect referenced identifiers. Patterns we care about:
  //   <Foo     — JSX open tag
  //   </Foo>   — JSX close tag (match anyway, harmless)
  //   React.createElement(Foo   — post-Babel JSX (in case any file already is)
  //   new Foo( — constructor call
  //   Foo.     — dot-access on a capital-letter identifier
  //   Foo(     — function call on a capital-letter identifier
  //
  //  We're being liberal: any referenced capital-letter identifier that isn't
  //  declared, isn't a prelude symbol, and isn't a namespace member gets a stub.
  const referenced = new Set<string>();
  const refPatterns: RegExp[] = [
    /<\s*([A-Z]\w*)[\s/>]/g,
    /<\/\s*([A-Z]\w*)\s*>/g,
    /\bReact\s*\.\s*createElement\s*\(\s*([A-Z]\w*)\b/g,
    /\bnew\s+([A-Z]\w*)\s*\(/g,
    /(?<![.\w])([A-Z]\w*)\s*\(/g,
    /(?<![.\w])([A-Z]\w*)\s*\./g,
  ];
  for (const re of refPatterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(scannable)) !== null) referenced.add(m[1]);
  }

  // ── Undeclared = referenced but not declared and not a known global.
  const undeclared: string[] = [];
  for (const name of referenced) {
    if (declared.has(name)) continue;
    if (PRELUDE_GLOBALS.has(name)) continue;
    // Skip TypeScript / Babel artifacts that sometimes leak through.
    if (/^__/.test(name)) continue;
    undeclared.push(name);
  }
  if (undeclared.length === 0) return combined;

  const stubDecls = undeclared
    .map((n) => `var ${n} = (typeof ${n} !== 'undefined') ? ${n} : __universalStub(${JSON.stringify(n)});`)
    .join('\n');

  return `${buildUniversalStubFactory()}\n${stubDecls}\n\n${combined}`;
}

/**
 * The universal stub factory. `__universalStub(name)` returns a value that is:
 *   - a React functional component (renders children, otherwise an empty span)
 *   - callable like a function (returns another stub)
 *   - has arbitrary properties (`.Provider`, `.Consumer`, etc.) that are
 *     themselves universal stubs \u2014 so `Dialog.Panel`, `Menu.Item`, etc. all
 *     resolve without error
 *   - stringifies to `''` so template/JSX text renders cleanly
 *   - thenable: NO (not a promise, so awaiting doesn't hang)
 */
function buildUniversalStubFactory(): string {
  return `
/* ── universal identifier fallback ──────────────────────────────────── */
function __universalStub(name) {
  function Stub(props) {
    var children = props && props.children;
    // Render children transparently so <UnknownLibraryComponent>content</UnknownLibraryComponent>
    // still shows "content". If no children, render an empty fragment.
    return children != null ? React.createElement(React.Fragment, null, children) : null;
  }
  Stub.displayName = String(name || 'UnknownStub');
  return new Proxy(Stub, {
    get: function (target, key) {
      if (key === Symbol.toPrimitive) return function () { return ''; };
      if (key === Symbol.toStringTag) return 'UniversalStub';
      if (key === 'toString' || key === 'valueOf') return function () { return ''; };
      if (key === 'then') return undefined; // not thenable
      if (key === '$$typeof') return target.$$typeof;
      if (key === 'displayName' || key === 'name') return target.displayName;
      if (key === 'prototype') return target.prototype;
      if (key === 'call' || key === 'apply' || key === 'bind') return Function.prototype[key].bind(target);
      if (key in target) return target[key];
      // Any unknown access returns another universal stub \u2014 covers
      // namespace patterns like Dialog.Panel, Menu.Item, etc.
      return __universalStub(String(name) + '.' + String(key));
    },
    apply: function (_target, _thisArg, args) {
      // Called as a plain function \u2014 e.g. a hook or builder. Return a stub so
      // destructuring/chaining keeps working.
      if (args.length === 1 && args[0] && typeof args[0] === 'object' && 'children' in args[0]) {
        return Stub(args[0]);
      }
      return __universalStub(String(name) + '()');
    },
    construct: function () {
      return Object.create(null);
    }
  });
}
/* ── end universal stub factory ─────────────────────────────────────── */
`;
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
  // Classic CRA/Vite "App" component first.
  const craCandidates = ['src/App.tsx', 'src/App.jsx', 'App.tsx', 'App.jsx', 'src/app.tsx', 'src/app.jsx'];
  for (const c of craCandidates) {
    const hit = files.find((f) => norm(f.path) === c);
    if (hit) return hit;
  }
  const craLoose = files.find((f) => /(?:^|\/)app\.(?:jsx?|tsx?)$/i.test(norm(f.path)));
  if (craLoose) return craLoose;

  // Next.js App Router / Pages Router entry pages. Generated projects almost
  // always use these instead of an App component.
  const nextCandidates = [
    'src/app/page.tsx', 'src/app/page.jsx',
    'app/page.tsx',     'app/page.jsx',
    'src/pages/index.tsx', 'src/pages/index.jsx',
    'pages/index.tsx',     'pages/index.jsx',
  ];
  for (const c of nextCandidates) {
    const hit = files.find((f) => norm(f.path) === c);
    if (hit) return hit;
  }
  // Loose match for any page.tsx under app/ — rare nested layouts.
  return files.find((f) => /(?:^|\/)app\/(?:[^/]+\/)*page\.(?:jsx?|tsx?)$/i.test(norm(f.path))) ?? null;
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

/* framer-motion — strip animation props, render plain DOM elements. */
var __FRAMER_PROPS = {
  initial:1, animate:1, exit:1, transition:1, variants:1, custom:1, inherit:1,
  whileHover:1, whileTap:1, whileDrag:1, whileFocus:1, whileInView:1, viewport:1,
  layout:1, layoutId:1, layoutDependency:1, layoutScroll:1,
  drag:1, dragConstraints:1, dragElastic:1, dragMomentum:1, dragSnapToOrigin:1, dragControls:1,
  onHoverStart:1, onHoverEnd:1, onTap:1, onTapStart:1, onTapCancel:1,
  onAnimationStart:1, onAnimationComplete:1, onUpdate:1, onDragStart:1, onDragEnd:1, onDrag:1
};
function __framerStripProps(props) {
  if (!props) return props;
  var clean = {};
  for (var k in props) { if (!__FRAMER_PROPS[k]) clean[k] = props[k]; }
  return clean;
}
function __framerComponent(tag) {
  return React.forwardRef(function (props, ref) {
    var clean = __framerStripProps(props);
    clean.ref = ref;
    return React.createElement(String(tag), clean, props && props.children);
  });
}
var motion = (typeof Proxy === 'function')
  ? new Proxy(function () {}, {
      get: function (_t, key) {
        if (typeof key === 'symbol') return undefined;
        if (key === '__esModule') return true;
        return __framerComponent(key);
      },
      apply: function (_t, _this, args) { return __framerComponent(args[0] || 'div'); }
    })
  : { div: __framerComponent('div'), span: __framerComponent('span'), button: __framerComponent('button'), section: __framerComponent('section'), article: __framerComponent('article'), header: __framerComponent('header'), footer: __framerComponent('footer'), nav: __framerComponent('nav'), ul: __framerComponent('ul'), li: __framerComponent('li'), a: __framerComponent('a'), p: __framerComponent('p'), img: __framerComponent('img'), form: __framerComponent('form'), input: __framerComponent('input') };
var m = motion;
function AnimatePresence(p) { return (p && p.children) || null; }
function LayoutGroup(p) { return (p && p.children) || null; }
function LazyMotion(p) { return (p && p.children) || null; }
var domAnimation = {};
var domMax = {};
function useAnimation() {
  return {
    start: function () { return Promise.resolve(); },
    stop:  function () {},
    set:   function () {},
    mount: function () { return function () {}; }
  };
}
function useAnimationControls() { return useAnimation(); }
function useMotionValue(initial) {
  var current = initial;
  return {
    get: function () { return current; },
    set: function (v) { current = v; },
    on:  function () { return function () {}; },
    onChange: function () { return function () {}; },
    destroy: function () {}
  };
}
function useTransform() { return useMotionValue(0); }
function useMotionTemplate() { return useMotionValue(''); }
function useScroll() {
  return {
    scrollX:         useMotionValue(0),
    scrollY:         useMotionValue(0),
    scrollXProgress: useMotionValue(0),
    scrollYProgress: useMotionValue(0)
  };
}
function useSpring(v) { return useMotionValue(typeof v === 'object' ? 0 : (v == null ? 0 : v)); }
function useInView() { return true; }
function useReducedMotion() { return false; }

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

  const combinedJsRaw = [
    buildSymbolPrelude(),
    ...sources.map((f) => `/* ── ${norm(f.path)} ── */\n${stripModuleSyntax(f.content, {
      selfPath: f.path,
      resolveDefault: (rel) => resolveDefaultKey(f.path, rel),
    })}`),
  ].join('\n\n');

  // ── Universal identifier fallback ─────────────────────────────────────
  // Root cause of most "fix → new error" loops: generated code imports from
  // libraries we don't have stubs for (e.g. a new UI kit, chart library, form
  // library). The import gets stripped but references to <Component /> remain.
  // At runtime: `Component is not defined` → blank screen.
  //
  // Fix: scan the combined source for capital-letter identifiers used in JSX
  // tag position or as constructor/component calls. For any that isn't
  // declared anywhere in the source, emit a universal pass-through stub so
  // the app keeps rendering instead of crashing.
  const combinedJs = injectUniversalStubs(combinedJsRaw);

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
  </head>
  <body>
    <div id="root"></div>
    <script id="__preview_src" type="text/plain">
${safeForScript(combinedJs)}

${safeForScript(bootstrap)}
    </script>
    <script>
      (function () {
        // ── Config pulled in from the builder ─────────────────────────────
        var REACT_URLS    = ${JSON.stringify(REACT_CDN_URLS)};
        var REACT_DOM_URLS= ${JSON.stringify(REACT_DOM_CDN_URLS)};
        var BABEL_URLS    = ${JSON.stringify(BABEL_CDN_URLS)};
        var TAILWIND_URLS = ${JSON.stringify(TAILWIND_CDN_URLS)};

        // ── Resilient script loader: try each CDN in order until one works ──
        function loadFrom(urls, checkGlobal) {
          return new Promise(function (resolve) {
            var i = 0;
            function tryNext() {
              if (checkGlobal && window[checkGlobal]) { resolve(true); return; }
              if (i >= urls.length) { resolve(false); return; }
              var s = document.createElement('script');
              s.src = urls[i++];
              s.crossOrigin = 'anonymous';
              s.onload = function () {
                if (!checkGlobal || window[checkGlobal]) resolve(true);
                else tryNext();
              };
              s.onerror = tryNext;
              document.head.appendChild(s);
            }
            tryNext();
          });
        }

        // Show a readable failure card so we NEVER leave a blank iframe.
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

        // Watchdog: if #root has no meaningful content a few seconds after
        // mount, render a synthesized placeholder so the user never sees a
        // blank iframe (e.g. App returns null, data still loading, etc.).
        function installWatchdog() {
          var WATCHDOG_MS = 4000;
          setTimeout(function () {
            try {
              var r = document.getElementById('root');
              if (!r) return;
              var txt = (r.textContent || '').trim();
              var hasVisible = r.children.length > 0 && (
                txt.length > 0 ||
                r.querySelector('img,svg,input,button,a,canvas,video,iframe') !== null
              );
              if (hasVisible) return;
              var wrap = document.createElement('div');
              wrap.setAttribute('data-devteam-watchdog', '1');
              wrap.style.cssText = 'padding:48px 24px;max-width:720px;margin:0 auto;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0F172A;';
              wrap.innerHTML =
                '<div style="display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:#E0F2FE;color:#0369A1;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:20px;">Preview placeholder</div>' +
                '<h1 style="font-size:28px;font-weight:700;margin:0 0 12px 0;line-height:1.2;">${escapeHtml(projectName).replace(/'/g, "\\'")}</h1>' +
                '<p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 24px 0;max-width:520px;">The app mounted successfully but did not render any visible content — most commonly because it is waiting on data or the default route renders nothing. The harness has kept the preview alive.</p>' +
                '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;">' +
                  '<div style="padding:16px;border:1px solid #E2E8F0;border-radius:8px;background:#fff;"><div style="font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;font-weight:600;">Mock API</div><div style="font-size:13px;color:#0F172A;">All fetch/XHR calls return plausible JSON — no real backend is contacted.</div></div>' +
                  '<div style="padding:16px;border:1px solid #E2E8F0;border-radius:8px;background:#fff;"><div style="font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;font-weight:600;">Sandboxed</div><div style="font-size:13px;color:#0F172A;">Runs in an isolated iframe with an opaque origin. Cannot touch the host app.</div></div>' +
                  '<div style="padding:16px;border:1px solid #E2E8F0;border-radius:8px;background:#fff;"><div style="font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;font-weight:600;">Safe by default</div><div style="font-size:13px;color:#0F172A;">Errors are caught and surfaced instead of leaving a blank screen.</div></div>' +
                '</div>';
              r.appendChild(wrap);
            } catch (_) { /* never throw from the watchdog */ }
          }, WATCHDOG_MS);
        }

        function runBootstrap() {
          var srcEl = document.getElementById('__preview_src');
          var src = srcEl ? srcEl.textContent : '';
          if (!src) { showErr('Preview source missing', 'No __preview_src script tag found.'); return; }
          if (typeof Babel === 'undefined') { showErr('Babel failed to load', 'All Babel CDN mirrors failed. Check network connectivity.'); return; }
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
          try { (0, eval)(res.code); installWatchdog(); }
          catch (e) { showErr('Runtime error', (e && e.message) || String(e)); }
        }

        // Load runtime deps with fallbacks, then bootstrap.
        // Tailwind is optional (fire-and-forget), React/ReactDOM/Babel are critical.
        loadFrom(TAILWIND_URLS, null);
        Promise.all([
          loadFrom(REACT_URLS,    'React'),
          loadFrom(REACT_DOM_URLS,'ReactDOM'),
          loadFrom(BABEL_URLS,    'Babel'),
        ]).then(function (ok) {
          if (!ok[0] || !ok[1]) { showErr('React failed to load', 'All React/ReactDOM CDN mirrors failed. Preview cannot render without React.'); return; }
          if (!ok[2])           { showErr('Babel failed to load', 'All Babel CDN mirrors failed. Preview cannot transpile source.'); return; }
          runBootstrap();
        });
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
    <meta name="color-scheme" content="dark" />
    <title>${escapeHtml(projectName)} — Preview unavailable</title>
    ${PREVIEW_MOCK_SCRIPT}
    <style>
      :root { color-scheme: dark; }
      *, *::before, *::after { box-sizing: border-box; }
      html, body { background:#07090f; height:100%; margin:0; }
      html { overflow: hidden; }
      body { padding:24px; color:#F1F5F9; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; display:flex; align-items:center; justify-content:center; overflow:hidden; }
      ::-webkit-scrollbar { width:10px; height:10px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius:8px; }
      ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.16); }
      .card { width:100%; max-width:560px; max-height:100%; overflow:auto; background:#0F172A; border:1px solid rgba(99,102,241,0.25); border-radius:12px; padding:28px; }
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
