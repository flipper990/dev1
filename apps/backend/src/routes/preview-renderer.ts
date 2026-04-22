// React preview renderer — transpiles component files to a self-contained HTML page.

import { CDN_LIBS, type CdnLib, buildRouterStubs, buildUILibraryStubs } from './preview-stubs.js';

interface ProjectFile { path: string; content: string; }
interface DockerService {
  isAvailable(): boolean;
  launch(projectId: string, html: string): void;
  getInfo(projectId: string): { status: string; url?: string } | undefined;
  stop(projectId: string): Promise<void>;
}

/** Strip all import/export syntax so every file runs in a shared Babel scope. */
export function processComponent(code: string, usedCdnLibs: CdnLib[]): string {
  // ReactDOM.render(...) — old React 16 API, drop it
  code = code.replace(/ReactDOM\.render\s*\([\s\S]*?\)\s*;?/g, '');

  // React imports
  code = code.replace(/import\s+React\s*,\s*\{([^}]+)\}\s+from\s+['"]react['"];?/g, (_, named) => `const { ${named.trim()} } = React;`);
  code = code.replace(/import\s+React\s+from\s+['"]react['"];?/g, '');
  code = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]react['"];?/g, (_, names) => `const { ${names.trim()} } = React;`);

  // ReactDOM imports
  code = code.replace(/import\s+ReactDOM\s+from\s+['"]react-dom[^'"]*['"];?/g, '');
  code = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]react-dom[^'"]*['"];?/g, (_, names) => `const { ${names.trim()} } = ReactDOM;`);

  // react-router-dom imports
  code = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]react-router-dom['"];?/g, (_, names) => `const { ${names.trim()} } = ReactRouterDOM;`);
  code = code.replace(/import\s+\w+\s+from\s+['"]react-router-dom['"];?/g, '');

  // styled-components
  code = code.replace(/import\s+styled(?:\s*,\s*\{([^}]*)\})?\s+from\s+['"]styled-components['"];?/g, (_, named) => named ? `const { ${named.trim()} } = styled;` : '');
  code = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]styled-components['"];?/g, (_, names) => `const { ${names.trim()} } = styled;`);

  // CDN-mapped third-party libraries
  for (const lib of usedCdnLibs) {
    const esc = lib.pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const g = `window.${lib.global}`;
    code = code.replace(new RegExp(`import\\s+\\*\\s+as\\s+(\\w+)\\s+from\\s+['"]${esc}(?:/[^'"]*)?['"]`, 'g'), (_, n) => `const ${n} = ${g};`);
    code = code.replace(new RegExp(`import\\s+(\\w+)\\s*,\\s*\\{([^}]+)\\}\\s+from\\s+['"]${esc}(?:/[^'"]*)?['"]`, 'g'), (_, def, named) => `const ${def} = ${g};\nconst { ${named.trim()} } = ${g};`);
    code = code.replace(new RegExp(`import\\s+\\{([^}]+)\\}\\s+from\\s+['"]${esc}(?:/[^'"]*)?['"]`, 'g'), (_, names) => `const { ${names.trim()} } = ${g};`);
    code = code.replace(new RegExp(`import\\s+(\\w+)\\s+from\\s+['"]${esc}(?:/[^'"]*)?['"]`, 'g'), (_, n) => `const ${n} = ${g};`);
  }

  // Icon library stubs
  code = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"](?:react-icons\/[^'"]+|@heroicons\/[^'"]+|@radix-ui\/react-icons)['"]/g, (_, names) => `const { ${names.trim()} } = window.__iconStub || {};`);
  code = code.replace(/import\s+(\w+)\s+from\s+['"](?:react-icons\/[^'"]+|@heroicons\/[^'"]+|@radix-ui\/react-icons)['"]/g, (_, n) => `const ${n} = window.__iconStub || {};`);

  // Headless UI / Radix UI stubs
  code = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"](?:@headlessui\/react|@radix-ui\/[^'"]+)['"]/g, (_, names) => `const { ${names.trim()} } = window.__headlessui || {};`);
  code = code.replace(/import\s+\*\s+as\s+(\w+)\s+from\s+['"](?:@headlessui\/react|@radix-ui\/[^'"]+)['"]/g, (_, n) => `const ${n} = window.__headlessui || {};`);

  // Remaining relative imports
  code = code.replace(/import\s+(?:\*\s+as\s+\w+|\w+(?:\s*,\s*\{[^}]*\})?|\{[^}]*\})\s+from\s+['"][./][^'"]*['"]/g, '');
  code = code.replace(/import\s+['"][^'"]*['"]/g, '');

  // Unknown external imports — null-safe proxy stub
  code = code.replace(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"./][^'"]*)['"]/g, (_, n, pkg) => { const id = `window.__s_${pkg.replace(/\W/g,'_')}`; return `if(!${id})${id}=new Proxy({},{get(_,k){return()=>null;}});\nconst ${n}=${id};`; });
  code = code.replace(/import\s+(\w+)\s*,\s*\{([^}]+)\}\s+from\s+['"]([^'"./][^'"]*)['"]/g, (_, def, named, pkg) => { const id = `window.__s_${pkg.replace(/\W/g,'_')}`; return `if(!${id})${id}=new Proxy({},{get(_,k){return()=>null;}});\nconst ${def}=${id}.default||${id};\nconst{${named.trim()}}=${id};`; });
  code = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"./][^'"]*)['"]/g, (_, names, pkg) => { const id = `window.__s_${pkg.replace(/\W/g,'_')}`; return `if(!${id})${id}=new Proxy({},{get(_,k){return()=>null;}});\nconst{${names.trim()}}=${id};`; });
  code = code.replace(/import\s+(\w+)\s+from\s+['"]([^'"./][^'"]*)['"]/g, (_, n, pkg) => { const id = `window.__s_${pkg.replace(/\W/g,'_')}`; return `if(!${id})${id}=new Proxy({},{get(_,k){return()=>null;}});\nconst ${n}=${id}.default||${id};`; });

  // Strip export keywords
  code = code.replace(/export\s+default\s+(function|class)\s+(\w+)/g, '$1 $2');
  code = code.replace(/export\s+default\s+\w+\s*;?/g, '');
  code = code.replace(/export\s+(const|let|var|function|class)\s+/g, '$1 ');
  code = code.replace(/export\s*\{[^}]*\}\s*;?/g, '');
  code = code.replace(/module\.exports\s*=\s*\{[\s\S]*?\}\s*;?/g, '');

  // Use var for stubs to avoid duplicate const declarations across files
  code = code.replace(/\bconst([ \t]*(\{[^}\n]+\}|\w+)[ \t]*=[ \t]*(React|ReactDOM|ReactRouterDOM|styled|window\.))/g, 'var$1');

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

  const isConfigFile  = (p: string) => /(?:tailwind|babel|jest|webpack|vite|rollup|postcss|eslint|prettier)\.config\.[jt]sx?$/.test(p) || /\.config\.[jt]sx?$/.test(p);
  const filteredFiles = componentFiles.filter(f => {
    const p = normalizeFilePath(f.path);
    return !isConfigFile(p) && !/(?:^|\/)index\.(j|t)sx?$/.test(p);
  });

  const sorted = [...filteredFiles].sort((a, b) => {
    const aDepth = normalizeFilePath(a.path).split('/').length;
    const bDepth = normalizeFilePath(b.path).split('/').length;
    if (bDepth !== aDepth) return bDepth - aDepth;
    return Number(/index\.(j|t)sx?$/.test(a.path)) - Number(/index\.(j|t)sx?$/.test(b.path));
  });

  const scriptBody = sorted.map(f => `// ── ${normalizeFilePath(f.path)} ──\n${processComponent(f.content, usedCdnLibs)}`).join('\n\n');

  const appFile = componentFiles.find(f => /\/(App|app)\.(j|t)sx?$/.test(f.path));
  const rootComponentName = appFile
    ? (() => { const m = appFile.content.match(/(?:export\s+default\s+(?:function|class)\s+|function\s+|class\s+)(\w+)/); return m ? m[1] : 'App'; })()
    : 'App';

  const cleanCss = cssFiles.map(f => f.content.replace(/@tailwind\s+\w+\s*;?/g, '').trim()).filter(Boolean).join('\n');

  const cdnScripts = usedCdnLibs.map(lib =>
    `<script crossorigin src="${lib.cdn}" onerror="console.warn('CDN failed: ${lib.pkg}');window.${lib.global}=window.__mkStub('${lib.global}')"></script>`
  ).join('\n  ');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${projectName ?? 'Preview'}</title>
  <script crossorigin src="https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.development.js"></script>
  <script crossorigin src="https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.development.js"></script>
  <script>window.__mkStub=function(name){function Comp(props){if(!props)return null;if(props.children!==undefined)return props.children;return null;}Comp.displayName=name;var p=typeof Proxy!=='undefined'?new Proxy(Comp,{get:function(t,k){if(k==='default')return p;if(k==='displayName'||k==='name'||k in Function.prototype)return t[k];if(!t[k])t[k]=window.__mkStub(name+'.'+k);return t[k];},construct:function(){return {};}}):Comp;return p;};</script>
  ${buildRouterStubs(usesRouter)}
  ${cdnScripts}
  ${buildUILibraryStubs(usesIconLibs, usesHeadlessUI, usesChakra, usesMUI, usesAntd)}
  <script crossorigin src="https://cdn.jsdelivr.net/npm/@babel/standalone@7.26.4/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>*,*::before,*::after{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,sans-serif}${cleanCss}</style>
  <script>window.addEventListener('error',function(e){var el=document.getElementById('root');if(!el)return;var d=e.message||String(e);if(e.filename)d+='\\n  at '+e.filename+':'+e.lineno+':'+e.colno;el.innerHTML='<pre style="padding:2rem;color:#c00;background:#fff8f8;white-space:pre-wrap;font-size:13px;border-left:4px solid red;margin:1rem">'+d+'</pre>';});</script>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-presets="react,typescript" data-type="module">
${scriptBody}
(function(){var rootEl=document.getElementById('root');if(!rootEl)return;try{if(typeof ${rootComponentName}!=='undefined'){ReactDOM.createRoot(rootEl).render(React.createElement(${rootComponentName}));}else{rootEl.innerHTML='<p style="padding:2rem;color:#555">Component <code>${rootComponentName}</code> not found.</p>';}}catch(e){rootEl.innerHTML='<pre style="padding:2rem;color:red;white-space:pre-wrap">'+e.message+'</pre>';}})();
  </script>
</body>
</html>`;

  if (dockerService.isAvailable()) {
    dockerService.launch(projectId, html);
  }

  return html;
}
