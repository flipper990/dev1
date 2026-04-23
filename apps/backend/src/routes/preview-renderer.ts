// React preview renderer — transpiles component files to a self-contained HTML page.

import { CDN_LIBS, type CdnLib, buildRouterStubs, buildUILibraryStubs, buildNextStubs, buildReduxStubs } from './preview-stubs.js';

interface ProjectFile { path: string; content: string; }
interface DockerService {
  isAvailable(): boolean;
  launch(projectId: string, html: string): void;
  getInfo(projectId: string): { status: string; url?: string } | undefined;
  stop(projectId: string): Promise<void>;
}

/** Convert ES `import { Foo as Bar }` alias syntax to JS destructuring `{ Foo: Bar }`. */
function aliasNames(names: string): string {
  return names
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.replace(/^(\w+)\s+as\s+(\w+)$/, '$1: $2'))
    .join(', ');
}

/** Strip extension and trailing /index from a path for module-key matching. */
function moduleKeyFromPath(p: string): string {
  return p.replace(/\.(?:j|t)sx?$/, '').replace(/\/index$/, '');
}

/** Synthetic identifier used to alias a file's default export in the concatenated preview bundle. */
function defaultExportIdFor(p: string): string {
  return '__d_' + moduleKeyFromPath(p).replace(/[^a-zA-Z0-9]/g, '_');
}

/** Resolve a relative import spec (`./foo`, `../bar`) against the importing file's directory. */
function resolveRelativeSpec(fromFile: string, spec: string): string {
  const dir = fromFile.split('/').slice(0, -1).join('/');
  const joined = (dir ? dir + '/' : '') + spec;
  const out: string[] = [];
  for (const seg of joined.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

/**
 * Pre-process files so default exports are aliased to synthetic ids and relative default imports
 * are rewritten to reference those ids. Returns transformed files plus the id map.
 */
function preprocessDefaultExports(files: ProjectFile[], normalizeFilePath: (p: string) => string): { files: ProjectFile[]; idByModuleKey: Map<string, string> } {
  const idByModuleKey = new Map<string, string>();
  for (const f of files) {
    const key = moduleKeyFromPath(normalizeFilePath(f.path));
    idByModuleKey.set(key, defaultExportIdFor(normalizeFilePath(f.path)));
  }

  const transformed = files.map(f => {
    const norm = normalizeFilePath(f.path);
    const id = defaultExportIdFor(norm);
    let c = f.content;
    const aliasLines: string[] = [];

    // `export default function Name(...)` / `export default class Name`
    // Strip `export default `, keep the declaration, record the alias for later append.
    c = c.replace(/export\s+default\s+(function|class)\s+(\w+)/g, (_m, kw, name) => {
      aliasLines.push(`var ${id} = ${name};`);
      return `${kw} ${name}`;
    });

    // `export default <expression>;` — non-function/class expression form.
    c = c.replace(/export\s+default\s+(?!function\b|class\b)([\s\S]*?);[ \t]*(?:\r?\n|$)/g, (_m, expr) => `var ${id} = (${expr.trim()});\n`);

    if (aliasLines.length) c = `${c}\n${aliasLines.join('\n')}\n`;

    return { path: f.path, content: c };
  });

  // Rewrite relative default imports: `import Foo from './x'` → `var Foo = <id>;`
  const finalFiles = transformed.map(f => {
    const norm = normalizeFilePath(f.path);
    let c = f.content;
    c = c.replace(/import\s+(\w+)\s+from\s+['"](\.[^'"]+)['"];?/g, (m, name, spec) => {
      const resolved = resolveRelativeSpec(norm, spec);
      const hit = idByModuleKey.get(resolved);
      return hit ? `var ${name} = ${hit};` : m;
    });
    // Default + named: `import Foo, { a } from './x'` — alias default, let named imports be stripped
    c = c.replace(/import\s+(\w+)\s*,\s*\{[^}]+\}\s+from\s+['"](\.[^'"]+)['"];?/g, (m, name, spec) => {
      const resolved = resolveRelativeSpec(norm, spec);
      const hit = idByModuleKey.get(resolved);
      return hit ? `var ${name} = ${hit};` : m;
    });
    return { path: f.path, content: c };
  });

  return { files: finalFiles, idByModuleKey };
}

/** Strip all import/export syntax so every file runs in a shared Babel scope. */
export function processComponent(code: string, usedCdnLibs: CdnLib[]): string {
  // ReactDOM.render(...) — old React 16 API, drop it
  code = code.replace(/ReactDOM\.render\s*\([\s\S]*?\)\s*;?/g, '');
  // createRoot(...).render(...) — modern React 18 API, drop it so our mount is the only one
  code = code.replace(/(?:ReactDOM\.)?createRoot\s*\([\s\S]*?\)\s*\.\s*render\s*\([\s\S]*?\)\s*;?/g, '');
  // ReactDOM.hydrate / hydrateRoot
  code = code.replace(/ReactDOM\.hydrate\s*\([\s\S]*?\)\s*;?/g, '');
  code = code.replace(/(?:ReactDOM\.)?hydrateRoot\s*\([\s\S]*?\)\s*;?/g, '');

  // React imports
  code = code.replace(/import\s+React\s*,\s*\{([^}]+)\}\s+from\s+['"]react['"];?/g, (_, named) => `const { ${aliasNames(named)} } = React;`);
  code = code.replace(/import\s+React\s+from\s+['"]react['"];?/g, '');
  code = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]react['"];?/g, (_, names) => `const { ${aliasNames(names)} } = React;`);

  // ReactDOM imports
  code = code.replace(/import\s+ReactDOM\s+from\s+['"]react-dom[^'"]*['"];?/g, '');
  code = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]react-dom[^'"]*['"];?/g, (_, names) => `const { ${aliasNames(names)} } = ReactDOM;`);

  // react-router-dom imports
  code = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]react-router-dom['"];?/g, (_, names) => `const { ${aliasNames(names)} } = ReactRouterDOM;`);
  code = code.replace(/import\s+\w+\s+from\s+['"]react-router-dom['"];?/g, '');

  // styled-components
  code = code.replace(/import\s+styled(?:\s*,\s*\{([^}]*)\})?\s+from\s+['"]styled-components['"];?/g, (_, named) => named ? `const { ${aliasNames(named)} } = styled;` : '');
  code = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]styled-components['"];?/g, (_, names) => `const { ${aliasNames(names)} } = styled;`);

  // Next.js imports (mapped to window.__s_next_* stubs installed in HTML head)
  // Default imports: Link, Head, Image, Script, dynamic
  const nextMap: Array<[RegExp, string]> = [
    [/^next\/link$/, '__s_next_link'],
    [/^next\/head$/, '__s_next_head'],
    [/^next\/image$/, '__s_next_image'],
    [/^next\/script$/, '__s_next_script'],
    [/^next\/dynamic$/, '__s_next_dynamic'],
    [/^next\/router$/, '__s_next_router'],
    [/^next\/navigation$/, '__s_next_navigation'],
    [/^next\/app$/, '__s_next_app'],
  ];
  for (const [re, global] of nextMap) {
    const pkg = re.source.replace(/^\^|\$$/g, '').replace(/\\\//g, '/');
    const esc = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const g = `window.${global}`;
    // Use `var` so the same symbol re-declared across multiple files in the
    // concatenated preview bundle doesn't throw "has already been declared".
    code = code.replace(new RegExp(`import\\s+(\\w+)\\s*,\\s*\\{([^}]+)\\}\\s+from\\s+['"]${esc}['"];?`, 'g'), (_m, def, named) => `var ${def} = (${g}&&${g}.default)||${g};\nvar { ${aliasNames(named)} } = ${g};`);
    code = code.replace(new RegExp(`import\\s+\\{([^}]+)\\}\\s+from\\s+['"]${esc}['"];?`, 'g'), (_m, names) => `var { ${aliasNames(names)} } = ${g};`);
    code = code.replace(new RegExp(`import\\s+(\\w+)\\s+from\\s+['"]${esc}['"];?`, 'g'), (_m, n) => `var ${n} = (${g}&&${g}.default)||${g};`);
    code = code.replace(new RegExp(`import\\s+['"]${esc}['"];?`, 'g'), '');
  }
  // Next.js type-only re-exports like `import type { AppProps } from 'next/app'`
  code = code.replace(/import\s+type\s+[^;]+from\s+['"]next\/[^'"]+['"];?/g, '');

  // react-redux — map to window.__s_react_redux stub (use var, see above)
  code = code.replace(/import\s+(\w+)\s*,\s*\{([^}]+)\}\s+from\s+['"]react-redux['"];?/g, (_m, def, named) => `var ${def} = window.__s_react_redux;\nvar { ${aliasNames(named)} } = window.__s_react_redux;`);
  code = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]react-redux['"];?/g, (_m, names) => `var { ${aliasNames(names)} } = window.__s_react_redux;`);
  code = code.replace(/import\s+(\w+)\s+from\s+['"]react-redux['"];?/g, (_m, n) => `var ${n} = window.__s_react_redux;`);

  // @reduxjs/toolkit — map to window.__s__reduxjs_toolkit stub
  code = code.replace(/import\s+(\w+)\s*,\s*\{([^}]+)\}\s+from\s+['"]@reduxjs\/toolkit['"];?/g, (_m, def, named) => `var ${def} = window.__s__reduxjs_toolkit;\nvar { ${aliasNames(named)} } = window.__s__reduxjs_toolkit;`);
  code = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]@reduxjs\/toolkit['"];?/g, (_m, names) => `var { ${aliasNames(names)} } = window.__s__reduxjs_toolkit;`);
  code = code.replace(/import\s+(\w+)\s+from\s+['"]@reduxjs\/toolkit['"];?/g, (_m, n) => `var ${n} = window.__s__reduxjs_toolkit;`);

  // redux (classic)
  code = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]redux['"];?/g, (_m, names) => `var { ${aliasNames(names)} } = window.__s_redux;`);
  code = code.replace(/import\s+(\w+)\s+from\s+['"]redux['"];?/g, (_m, n) => `var ${n} = window.__s_redux;`);

  // CDN-mapped third-party libraries
  for (const lib of usedCdnLibs) {
    const esc = lib.pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const g = `window.${lib.global}`;
    code = code.replace(new RegExp(`import\\s+\\*\\s+as\\s+(\\w+)\\s+from\\s+['"]${esc}(?:/[^'"]*)?['"]`, 'g'), (_, n) => `const ${n} = ${g};`);
    code = code.replace(new RegExp(`import\\s+(\\w+)\\s*,\\s*\\{([^}]+)\\}\\s+from\\s+['"]${esc}(?:/[^'"]*)?['"]`, 'g'), (_, def, named) => `const ${def} = ${g};\nconst { ${aliasNames(named)} } = ${g};`);
    code = code.replace(new RegExp(`import\\s+\\{([^}]+)\\}\\s+from\\s+['"]${esc}(?:/[^'"]*)?['"]`, 'g'), (_, names) => `const { ${aliasNames(names)} } = ${g};`);
    code = code.replace(new RegExp(`import\\s+(\\w+)\\s+from\\s+['"]${esc}(?:/[^'"]*)?['"]`, 'g'), (_, n) => `const ${n} = ${g};`);
  }

  // Icon library stubs
  code = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"](?:react-icons\/[^'"]+|@heroicons\/[^'"]+|@radix-ui\/react-icons)['"]/g, (_, names) => `const { ${aliasNames(names)} } = window.__iconStub || {};`);
  code = code.replace(/import\s+(\w+)\s+from\s+['"](?:react-icons\/[^'"]+|@heroicons\/[^'"]+|@radix-ui\/react-icons)['"]/g, (_, n) => `const ${n} = window.__iconStub || {};`);

  // Headless UI / Radix UI stubs
  code = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"](?:@headlessui\/react|@radix-ui\/[^'"]+)['"]/g, (_, names) => `const { ${aliasNames(names)} } = window.__headlessui || {};`);
  code = code.replace(/import\s+\*\s+as\s+(\w+)\s+from\s+['"](?:@headlessui\/react|@radix-ui\/[^'"]+)['"]/g, (_, n) => `const ${n} = window.__headlessui || {};`);

  // Remaining relative imports
  code = code.replace(/import\s+(?:\*\s+as\s+\w+|\w+(?:\s*,\s*\{[^}]*\})?|\{[^}]*\})\s+from\s+['"][./][^'"]*['"]/g, '');
  code = code.replace(/import\s+['"][^'"]*['"]/g, '');

  // Unknown external imports — null-safe proxy stub
  code = code.replace(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"./][^'"]*)['"]/g, (_, n, pkg) => { const id = `window.__s_${pkg.replace(/\W/g,'_')}`; return `if(!${id})${id}=new Proxy({},{get(_,k){return()=>null;}});\nconst ${n}=${id};`; });
  code = code.replace(/import\s+(\w+)\s*,\s*\{([^}]+)\}\s+from\s+['"]([^'"./][^'"]*)['"]/g, (_, def, named, pkg) => { const id = `window.__s_${pkg.replace(/\W/g,'_')}`; return `if(!${id})${id}=new Proxy({},{get(_,k){return()=>null;}});\nconst ${def}=${id}.default||${id};\nconst{${aliasNames(named)}}=${id};`; });
  code = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"./][^'"]*)['"]/g, (_, names, pkg) => { const id = `window.__s_${pkg.replace(/\W/g,'_')}`; return `if(!${id})${id}=new Proxy({},{get(_,k){return()=>null;}});\nconst{${aliasNames(names)}}=${id};`; });
  code = code.replace(/import\s+(\w+)\s+from\s+['"]([^'"./][^'"]*)['"]/g, (_, n, pkg) => { const id = `window.__s_${pkg.replace(/\W/g,'_')}`; return `if(!${id})${id}=new Proxy({},{get(_,k){return()=>null;}});\nconst ${n}=${id}.default||${id};`; });

  // Strip export keywords
  code = code.replace(/export\s+default\s+(function|class)\s+(\w+)/g, '$1 $2');
  // export default <expression>;  — expression can include property access, calls, JSX, objects, etc.
  // Match greedily up to the statement terminator (semicolon or newline at paren-depth 0).
  code = code.replace(/export\s+default\s+/g, '');
  code = code.replace(/export\s+(const|let|var|function|class)\s+/g, '$1 ');
  // export interface/type/enum/namespace — strip the `export` keyword; Babel's TS preset
  // will then erase the declaration itself (interfaces/types are type-only).
  code = code.replace(/export\s+(interface|type|enum|namespace|abstract|declare)\s+/g, '$1 ');
  // export * from '...'  and  export { foo } from '...'
  code = code.replace(/export\s*\*\s*(?:as\s+\w+\s+)?from\s+['"][^'"]*['"]\s*;?/g, '');
  code = code.replace(/export\s*\{[^}]*\}\s*from\s+['"][^'"]*['"]\s*;?/g, '');
  code = code.replace(/export\s*\{[^}]*\}\s*;?/g, '');
  code = code.replace(/module\.exports\s*=\s*\{[\s\S]*?\}\s*;?/g, '');
  // module.exports = identifier;  or  exports.foo = ...
  code = code.replace(/module\.exports\s*=\s*[^;\n]+;?/g, '');
  code = code.replace(/\bexports\.\w+\s*=\s*[^;\n]+;?/g, '');

  // Use var for stubs to avoid duplicate const declarations across files
  code = code.replace(/\bconst([ \t]*(\{[^}\n]+\}|\w+)[ \t]*=[ \t]*(React|ReactDOM|ReactRouterDOM|styled|window\.))/g, 'var$1');

  // All files are concatenated into a single eval() scope. `const`/`let` at module
  // top-level collide across files (e.g. every Redux slice declares `const initialState`).
  // Convert top-level `const`/`let` to `var` so redeclarations silently overwrite instead
  // of throwing "Identifier X has already been declared".
  code = code.replace(/^(const|let)(\s+)/gm, 'var$2');

  return code;
}

export interface ReactPreviewOptions {
  projectId: string;
  projectName: string;
  componentFiles: ProjectFile[];
  cssFiles: ProjectFile[];
  normalizeFilePath: (p: string) => string;
  dockerService: DockerService;
}

/** Build a self-contained HTML page that renders the React components in-browser. */
export function buildReactPreviewHtml(opts: ReactPreviewOptions): string {
  const { projectId, projectName, componentFiles, cssFiles, normalizeFilePath, dockerService } = opts;

  const allCode = componentFiles.map(f => f.content).join('\n');
  const usedCdnLibs = CDN_LIBS.filter(lib => {
    const esc = lib.pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`from\\s+['"]${esc}['"]`).test(allCode);
  });

  const usesIconLibs  = /from\s+['"](?:react-icons\/|@heroicons\/|@radix-ui\/react-icons)/.test(allCode);
  const usesHeadlessUI = /from\s+['"](?:@headlessui\/|@radix-ui\/)/.test(allCode);
  const usesChakra    = /from\s+['"]@chakra-ui\//.test(allCode);
  const usesMUI       = /from\s+['"]@mui\//.test(allCode);
  const usesAntd      = /from\s+['"]antd['"]/.test(allCode);
  const usesRouter    = componentFiles.some(f => /react-router-dom/.test(f.content));
  const usesNext      = /from\s+['"]next\//.test(allCode) || componentFiles.some(f => /(?:^|\/)pages\//.test(normalizeFilePath(f.path)));
  const usesRedux     = /from\s+['"](?:react-redux|@reduxjs\/toolkit|redux)['"]/.test(allCode);

  const isConfigFile  = (p: string) => /(?:tailwind|babel|jest|webpack|vite|rollup|postcss|eslint|prettier)\.config\.[jt]sx?$/.test(p) || /\.config\.[jt]sx?$/.test(p);
  // Exclude only the root entry-point index.* (which mounts to DOM). Keep every other index
  // file (e.g. store/index.ts, slices/index.ts) because they export hooks, reducers, etc.
  const isRootEntry = (p: string) => /(?:^|\/)src\/index\.(j|t)sx?$/.test(p) || /^index\.(j|t)sx?$/.test(p) || /(?:^|\/)main\.(j|t)sx?$/.test(p);
  const filteredFiles = componentFiles.filter(f => {
    const p = normalizeFilePath(f.path);
    return !isConfigFile(p) && !isRootEntry(p);
  });

  const sorted = [...filteredFiles].sort((a, b) => {
    const aDepth = normalizeFilePath(a.path).split('/').length;
    const bDepth = normalizeFilePath(b.path).split('/').length;
    if (bDepth !== aDepth) return bDepth - aDepth;
    return Number(/index\.(j|t)sx?$/.test(a.path)) - Number(/index\.(j|t)sx?$/.test(b.path));
  });

  // Pre-process default exports so relative `import Foo from './x'` resolves to a real binding.
  const { files: preprocessed } = preprocessDefaultExports(sorted, normalizeFilePath);

  const scriptBody = preprocessed.map(f => `// ── ${normalizeFilePath(f.path)} ──\n${processComponent(f.content, usedCdnLibs)}`).join('\n\n');

  // Root component detection — prefer an App component, else a Next.js _app + home page pair,
  // else the first component-ish export we can find.
  const appFile = componentFiles.find(f => /\/(App|app)\.(j|t)sx?$/.test(f.path));
  const nextAppFile = componentFiles.find(f => /(?:^|\/)pages\/_app\.(j|t)sx?$/.test(normalizeFilePath(f.path)));
  const nextHomeFile = componentFiles.find(f => /(?:^|\/)pages\/index\.(j|t)sx?$/.test(normalizeFilePath(f.path)));
  const extractExportedName = (content: string): string | undefined => {
    const m = content.match(/export\s+default\s+(?:function|class)\s+(\w+)/)
      ?? content.match(/function\s+(\w+)\s*\([^)]*\)[\s\S]{0,200}export\s+default\s+\1/)
      ?? content.match(/export\s+default\s+(\w+)/);
    return m?.[1];
  };
  let rootComponentName = 'App';
  let mountExpr: string;
  if (appFile) {
    rootComponentName = extractExportedName(appFile.content) ?? 'App';
    mountExpr = `React.createElement(${rootComponentName})`;
  } else if (nextAppFile && nextHomeFile) {
    const appName = extractExportedName(nextAppFile.content) ?? 'App';
    const homeName = extractExportedName(nextHomeFile.content) ?? 'Home';
    rootComponentName = appName;
    // Next.js _app.tsx expects { Component, pageProps } — wire the home page in.
    mountExpr = `React.createElement(${appName}, { Component: ${homeName}, pageProps: {} })`;
  } else if (nextHomeFile) {
    const homeName = extractExportedName(nextHomeFile.content) ?? 'Home';
    rootComponentName = homeName;
    mountExpr = `React.createElement(${homeName})`;
  } else {
    // Fallback: find any default-exported function component name in the bundle.
    for (const f of sorted) {
      const n = extractExportedName(f.content);
      if (n && /^[A-Z]/.test(n)) { rootComponentName = n; break; }
    }
    mountExpr = `React.createElement(${rootComponentName})`;
  }

  const cleanCss = cssFiles.map(f => f.content.replace(/@tailwind\s+\w+\s*;?/g, '').trim()).filter(Boolean).join('\n');

  const cdnScripts = usedCdnLibs.map(lib =>
    `<script crossorigin src="${lib.cdn}" onerror="console.warn('CDN failed: ${lib.pkg}');window.${lib.global}=window.__mkStub('${lib.global}')"></script>`
  ).join('\n  ');
  const mountCode = `(function(){var rootEl=document.getElementById('root');if(!rootEl)return;try{if(typeof ${rootComponentName}!=='undefined'){ReactDOM.createRoot(rootEl).render(${mountExpr});}else{rootEl.innerHTML='<p style="padding:2rem;color:#555">Component <code>${rootComponentName}</code> not found.</p>';}}catch(e){rootEl.innerHTML='<pre style="padding:2rem;color:red;white-space:pre-wrap">'+(e&&e.message||String(e))+'</pre>';}})();`;
  const encodedSrc = JSON.stringify(`${scriptBody}\n${mountCode}`).replace(/<\/script/gi, '<\\/script');
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${projectName ?? 'Preview'}</title>
  <script crossorigin src="https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.development.js"></script>
  <script crossorigin src="https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.development.js"></script>
  <script>window.__mkStub=function(name){function Comp(props){if(!props)return null;if(props.children!==undefined)return props.children;return null;}Comp.displayName=name;var p=typeof Proxy!=='undefined'?new Proxy(Comp,{get:function(t,k){if(k==='default')return p;if(k==='displayName'||k==='name'||k in Function.prototype)return t[k];if(!t[k])t[k]=window.__mkStub(name+'.'+k);return t[k];},construct:function(){return {};}}):Comp;return p;};</script>
  ${buildRouterStubs(usesRouter)}
  ${buildNextStubs(usesNext)}
  ${buildReduxStubs(usesRedux)}
  ${cdnScripts}
  ${buildUILibraryStubs(usesIconLibs, usesHeadlessUI, usesChakra, usesMUI, usesAntd)}
  <script crossorigin src="https://cdn.jsdelivr.net/npm/@babel/standalone@7.26.4/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>*,*::before,*::after{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,sans-serif}${cleanCss}</style>
  <script>window.addEventListener('error',function(e){var el=document.getElementById('root');if(!el)return;var d=e.message||String(e);if(e.filename)d+='\\n  at '+e.filename+':'+e.lineno+':'+e.colno;el.innerHTML='<pre style="padding:2rem;color:#c00;background:#fff8f8;white-space:pre-wrap;font-size:13px;border-left:4px solid red;margin:1rem">'+d+'</pre>';});</script>
</head>
<body>
  <div id="root"></div>
  <script>
(function(){var src=${encodedSrc};var res;try{res=Babel.transform(src,{presets:[['react',{}],['typescript',{allExtensions:true,isTSX:true}]],filename:'preview.tsx',sourceType:'unambiguous'});}catch(e){var el=document.getElementById('root');if(el)el.innerHTML='<pre style="padding:2rem;color:#c00;background:#fff8f8;white-space:pre-wrap;font-size:13px;border-left:4px solid red;margin:1rem">'+(e.message||String(e))+'</pre>';return;}try{eval(res.code);}catch(e){var el=document.getElementById('root');if(el)el.innerHTML='<pre style="padding:2rem;color:red;white-space:pre-wrap">'+(e.message||String(e))+'</pre>';}})();
  </script>
</body>
</html>`;

  if (dockerService.isAvailable()) {
    dockerService.launch(projectId, html);
  }

  return html;
}
