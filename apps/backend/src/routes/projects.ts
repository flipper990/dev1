import type { FastifyInstance } from 'fastify';
import { ValidationError } from '@devteam/core';
import type { CreateProjectRequest } from '@devteam/core';
import { Orchestrator, sessionManager } from '@devteam/orchestration';
import { globalMemoryStore } from '@devteam/memory';
import { globalLLMRouter } from '@devteam/api-routing';
import { projectStore } from '../storage/project-store.js';
import { dockerService } from '../services/docker-service.js';

function normalizeFilePath(path: string): string {
  return path.replace(/\\/g, '/').trim();
}

// ─── Shared orchestrator instance ─────────────────────────────────────────────

const orchestrator = new Orchestrator({
  memory: globalMemoryStore,
  llm: { complete: (req) => globalLLMRouter.complete(req) },
  onProjectSave: async (project) => {
    await projectStore.save(project);
    // Launch / refresh Docker container when project has files (async — don't block save)
    const files = project.artifacts?.files ?? [];
    if (files.length > 0 && dockerService.isAvailable()) {
      // We need the preview HTML but can't call the route directly — defer to a microtask
      setImmediate(() => {
        // Signal that the project is saved so container can be (re)built on next preview request
        dockerService['_pendingLaunch'] = dockerService['_pendingLaunch'] ?? new Set();
        (dockerService['_pendingLaunch'] as Set<string>).add(project.id);
      });
    }
  },
  onEvent: (sessionId, type, data) => {
    sessionManager.emit(sessionId, type, data);
  },
});

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function projectRoutes(app: FastifyInstance) {
  // POST /api/projects — create + run pipeline async (returns immediately)
  app.post<{ Body: CreateProjectRequest }>('/', async (req, reply) => {
    const { prompt, preferences } = req.body ?? {};

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 10) {
      throw new ValidationError('prompt must be at least 10 characters');
    }
    if (prompt.length > 10_000) {
      throw new ValidationError('prompt must not exceed 10,000 characters');
    }

    // startAsync fires the pipeline in the background and returns session info immediately
    // so the client can open the WebSocket before any progress events fire.
    const { project, sessionId, projectId } = orchestrator.startAsync({ prompt: prompt.trim(), preferences });

    return reply.status(202).send({
      project,
      pipeline: { sessionId, projectId },
    });
  });

  // GET /api/projects — list all projects
  app.get<{ Querystring: { limit?: string; offset?: string } }>('/', async (req, reply) => {
    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    const offset = Number(req.query.offset ?? 0);

    if (Number.isNaN(limit) || Number.isNaN(offset)) {
      throw new ValidationError('limit and offset must be numbers');
    }

    const result = await projectStore.list(limit, offset);
    return reply.send(result);
  });

  // GET /api/projects/:id — get single project
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const project = await projectStore.get(req.params.id);
    return reply.send({ project });
  });

  // GET /api/projects/:id/files — list files in a project
  app.get<{ Params: { id: string } }>('/:id/files', async (req, reply) => {
    const project = await projectStore.get(req.params.id);
    const seen = new Set<string>();
    const files = (project.artifacts?.files ?? [])
      .map((f) => ({
        path: normalizeFilePath(f.path),
        size: f.content.length,
      }))
      .filter((f) => {
        if (seen.has(f.path)) return false;
        seen.add(f.path);
        return true;
      });
    return reply.send(files);
  });

  // GET /api/projects/:id/file?path=... — robust file lookup
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>('/:id/file', async (req, reply) => {
    const project = await projectStore.get(req.params.id);
    const rawPath = req.query.path;

    if (!rawPath || typeof rawPath !== 'string') {
      throw new ValidationError('path query parameter is required');
    }

    const targetPath = normalizeFilePath(rawPath);
    const file = (project.artifacts?.files ?? []).find((f) => normalizeFilePath(f.path) === targetPath);

    if (!file) {
      return reply.status(404).send({ error: 'File not found', statusCode: 404 });
    }

    return reply.send({ path: normalizeFilePath(file.path), content: file.content });
  });

  // GET /api/projects/:id/files/* — get file content
  app.get<{ Params: { id: string; '*': string } }>('/:id/files/*', async (req, reply) => {
    const project = await projectStore.get(req.params.id);
    const filePath = normalizeFilePath(req.params['*']);
    const file = (project.artifacts?.files ?? []).find((f) => normalizeFilePath(f.path) === filePath);
    if (!file) {
      return reply.status(404).send({ error: 'File not found', statusCode: 404 });
    }
    return reply.send({ path: normalizeFilePath(file.path), content: file.content });
  });

  // GET /api/projects/:id/preview — render project as a self-contained HTML page
  app.get<{ Params: { id: string } }>('/:id/preview', async (req, reply) => {
    const project = await projectStore.get(req.params.id);
    const files = project.artifacts?.files ?? [];

    const isTestFile = (p: string) =>
      p.endsWith('.test.js') || p.endsWith('.test.jsx') || p.endsWith('.test.ts') || p.endsWith('.test.tsx') ||
      p.endsWith('.spec.js') || p.endsWith('.spec.ts') || p.includes('setupTests') || p.includes('__tests__');

    const htmlFiles = files.filter((f) => normalizeFilePath(f.path).endsWith('.html'));
    const cssFiles  = files.filter((f) => normalizeFilePath(f.path).endsWith('.css'));
    const jsxFiles  = files.filter((f) => {
      const p = normalizeFilePath(f.path);
      return (p.endsWith('.js') || p.endsWith('.jsx') || p.endsWith('.ts') || p.endsWith('.tsx')) && !isTestFile(p);
    });

    // ── Detect React project ──────────────────────────────────────────────────
    const isReact = jsxFiles.some((f) => /from ['"]react['"]/.test(f.content) || /require\(['"]react['"]\)/.test(f.content));

    if (isReact) {
      // Config/tooling files that shouldn't be executed in browser
      const isConfigFile = (p: string) =>
        /(?:tailwind|babel|jest|webpack|vite|rollup|postcss|eslint|prettier)\.config\.[jt]sx?$/.test(p) ||
        /\.config\.[jt]sx?$/.test(p) ||
        p === 'tailwind.config.js';

      const componentFiles = jsxFiles.filter((f) => {
        const p = normalizeFilePath(f.path);
        // Skip config/tooling files
        if (isConfigFile(p)) return false;
        // Skip entry files (index.js / index.tsx etc.) — we mount ourselves
        if (/(?:^|\/)index\.(j|t)sx?$/.test(p)) return false;
        return true;
      });

      // ── CDN library registry ──────────────────────────────────────────────
      // Maps npm package names → CDN URL + UMD global name.
      // Only packages detected in the generated code are injected as <script> tags.
      // CDN URLs are verified working UMD builds. global = window property set by each script.
      const CDN_LIBS: Array<{ pkg: string; cdn: string; global: string }> = [
        // yup v1.x dropped the UMD build — pin to 0.32.x which has dist/yup.umd.js
        { pkg: 'yup',                  cdn: 'https://cdn.jsdelivr.net/npm/yup@0.32.11/dist/yup.umd.js',                                          global: 'Yup'              },
        { pkg: 'axios',                cdn: 'https://cdn.jsdelivr.net/npm/axios@1.7.2/dist/axios.min.js',                                         global: 'axios'            },
        // react-hook-form UMD global is exported as ReactHookForm
        { pkg: 'react-hook-form',      cdn: 'https://cdn.jsdelivr.net/npm/react-hook-form@7.51.5/dist/index.umd.min.js',                          global: 'ReactHookForm'    },
        // zod UMD is in lib/umd, not lib root
        { pkg: 'zod',                  cdn: 'https://cdn.jsdelivr.net/npm/zod@3.22.4/lib/umd.js',                                                global: 'Zod'              },
        { pkg: 'lucide-react',         cdn: 'https://cdn.jsdelivr.net/npm/lucide-react@0.390.0/dist/umd/lucide-react.min.js',                     global: 'LucideReact'      },
        { pkg: 'framer-motion',        cdn: 'https://cdn.jsdelivr.net/npm/framer-motion@10.18.0/dist/framer-motion.js',                           global: 'Motion'           },
        { pkg: 'recharts',             cdn: 'https://cdn.jsdelivr.net/npm/recharts@2.12.7/umd/Recharts.js',                                       global: 'Recharts'         },
        { pkg: 'date-fns',             cdn: 'https://cdn.jsdelivr.net/npm/date-fns@2.30.0/date_fns/index.js',                                     global: 'dateFns'          },
        { pkg: 'chart.js',             cdn: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js',                                 global: 'Chart'            },
        // react-chartjs-2 UMD expects Chart.js to be loaded first (above)
        { pkg: 'react-chartjs-2',      cdn: 'https://cdn.jsdelivr.net/npm/react-chartjs-2@5.2.0/dist/index.umd.min.js',                          global: 'ReactChartJS2'    },
        { pkg: 'clsx',                 cdn: 'https://cdn.jsdelivr.net/npm/clsx@2.1.1/dist/clsx.min.js',                                          global: 'clsx'             },
        { pkg: 'classnames',           cdn: 'https://cdn.jsdelivr.net/npm/classnames@2.5.1/index.js',                                            global: 'classNames'       },
        { pkg: 'lodash',               cdn: 'https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js',                                         global: '_'                },
        { pkg: 'moment',               cdn: 'https://cdn.jsdelivr.net/npm/moment@2.30.1/moment.min.js',                                          global: 'moment'           },
        { pkg: 'dayjs',                cdn: 'https://cdn.jsdelivr.net/npm/dayjs@1.11.12/dayjs.min.js',                                           global: 'dayjs'            },
        { pkg: 'formik',               cdn: 'https://cdn.jsdelivr.net/npm/formik@2.4.6/dist/formik.umd.development.js',                          global: 'Formik'           },
        { pkg: '@tanstack/react-query', cdn: 'https://cdn.jsdelivr.net/npm/@tanstack/react-query@4.36.1/build/umd/index.development.js',          global: 'ReactQuery'       },
        { pkg: 'react-query',          cdn: 'https://cdn.jsdelivr.net/npm/react-query@3.39.3/reactQuery.development.js',                         global: 'ReactQuery'       },
        { pkg: 'react-spring',         cdn: 'https://cdn.jsdelivr.net/npm/react-spring@9.7.3/dist/react-spring.umd.js',                          global: 'ReactSpring'      },
        { pkg: 'uuid',                 cdn: 'https://cdn.jsdelivr.net/npm/uuid@9.0.1/dist/umd/uuid.min.js',                                      global: 'uuid'             },
        { pkg: 'nanoid',               cdn: 'https://cdn.jsdelivr.net/npm/nanoid@5.0.7/index.browser.js',                                        global: 'nanoid'           },
      ];

      const allCode = componentFiles.map(f => f.content).join('\n');
      const usedCdnLibs = CDN_LIBS.filter(lib => {
        const esc = lib.pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`from\\s+['"]${esc}['"]`).test(allCode);
      });
      const usesIconLibs = /from\s+['"](?:react-icons\/|@heroicons\/|@radix-ui\/react-icons)/.test(allCode);
      const usesHeadlessUI = /from\s+['"](?:@headlessui\/|@radix-ui\/)/.test(allCode);
      const usesChakra = /from\s+['"]@chakra-ui\//.test(allCode);
      const usesMUI = /from\s+['"]@mui\//.test(allCode);
      const usesAntd = /from\s+['"]antd['"]/.test(allCode);

      // Helper: strip all import/export syntax so every file runs in shared Babel scope.
      // NOTE: generated code is often single-line, so NO line-boundary anchors (^/$).
      function processComponent(code: string): string {
        // ReactDOM.render(...) — old React 16 API, drop it (we mount ourselves)
        code = code.replace(/ReactDOM\.render\s*\([\s\S]*?\)\s*;?/g, '');

        // import React, { X } from 'react'  →  const { X } = React;
        code = code.replace(/import\s+React\s*,\s*\{([^}]+)\}\s+from\s+['"]react['"];?/g, (_, named) => `const { ${named.trim()} } = React;`);
        // import React from 'react'  →  (drop)
        code = code.replace(/import\s+React\s+from\s+['"]react['"];?/g, '');
        // import { X, Y } from 'react'  →  const { X, Y } = React;
        code = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]react['"];?/g, (_, names) => `const { ${names.trim()} } = React;`);

        // import ReactDOM from 'react-dom*'  →  (drop)
        code = code.replace(/import\s+ReactDOM\s+from\s+['"]react-dom[^'"]*['"];?/g, '');
        // import { createRoot } from 'react-dom*'  →  const { createRoot } = ReactDOM;
        code = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]react-dom[^'"]*['"];?/g, (_, names) => `const { ${names.trim()} } = ReactDOM;`);

        // import { X } from 'react-router-dom'  →  const { X } = ReactRouterDOM;
        code = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]react-router-dom['"];?/g, (_, names) => `const { ${names.trim()} } = ReactRouterDOM;`);
        // import X from 'react-router-dom'  →  (drop)
        code = code.replace(/import\s+\w+\s+from\s+['"]react-router-dom['"];?/g, '');
        // import styled from 'styled-components'  →  drop (styled global already set by CDN)
        // import styled, { X } from 'styled-components'  →  only keep named imports
        code = code.replace(/import\s+styled(?:\s*,\s*\{([^}]*)\})?\s+from\s+['"]styled-components['"];?/g, (_, named) =>
          named ? `const { ${named.trim()} } = styled;` : ''
        );
        // import { X } from 'styled-components'  →  const { X } = styled;
        code = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]styled-components['"];?/g, (_, names) => `const { ${names.trim()} } = styled;`);

        // ── CDN-mapped third-party libraries ──────────────────────────────
        for (const lib of usedCdnLibs) {
          const esc = lib.pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const g = `window.${lib.global}`;
          // import * as Name from 'pkg' or 'pkg/sub'
          code = code.replace(new RegExp(`import\\s+\\*\\s+as\\s+(\\w+)\\s+from\\s+['"]${esc}(?:/[^'"]*)?['"]`, 'g'), (_, n) => `const ${n} = ${g};`);
          // import Name, { A, B } from 'pkg'
          code = code.replace(new RegExp(`import\\s+(\\w+)\\s*,\\s*\\{([^}]+)\\}\\s+from\\s+['"]${esc}(?:/[^'"]*)?['"]`, 'g'), (_, def, named) => `const ${def} = ${g};\nconst { ${named.trim()} } = ${g};`);
          // import { A, B } from 'pkg'
          code = code.replace(new RegExp(`import\\s+\\{([^}]+)\\}\\s+from\\s+['"]${esc}(?:/[^'"]*)?['"]`, 'g'), (_, names) => `const { ${names.trim()} } = ${g};`);
          // import Name from 'pkg'
          code = code.replace(new RegExp(`import\\s+(\\w+)\\s+from\\s+['"]${esc}(?:/[^'"]*)?['"]`, 'g'), (_, n) => `const ${n} = ${g};`);
        }

        // ── Icon library stubs (react-icons/*, @heroicons/*, @radix-ui/react-icons) ──
        code = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"](?:react-icons\/[^'"]+|@heroicons\/[^'"]+|@radix-ui\/react-icons)['"]/g,
          (_, names) => `const { ${names.trim()} } = window.__iconStub || {};`);
        code = code.replace(/import\s+(\w+)\s+from\s+['"](?:react-icons\/[^'"]+|@heroicons\/[^'"]+|@radix-ui\/react-icons)['"]/g,
          (_, n) => `const ${n} = window.__iconStub || {};`);

        // ── Headless UI / Radix UI stubs ──────────────────────────────────
        code = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"](?:@headlessui\/react|@radix-ui\/[^'"]+)['"]/g,
          (_, names) => `const { ${names.trim()} } = window.__headlessui || {};`);
        code = code.replace(/import\s+\*\s+as\s+(\w+)\s+from\s+['"](?:@headlessui\/react|@radix-ui\/[^'"]+)['"]/g,
          (_, n) => `const ${n} = window.__headlessui || {};`);

        // All remaining local relative imports  →  (drop)
        code = code.replace(/import\s+(?:\*\s+as\s+\w+|\w+(?:\s*,\s*\{[^}]*\})?|\{[^}]*\})\s+from\s+['"][./][^'"]*['"]/g, '');
        // Side-effect imports (e.g. import './index.css')  →  (drop)
        code = code.replace(/import\s+['"][^'"]*['"]/g, '');
        // Remaining unknown external imports → null-safe proxy stub to prevent ReferenceError
        code = code.replace(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"./][^'"]*)['"]/g,
          (_, n, pkg) => { const id = `window.__s_${pkg.replace(/\W/g,'_')}`; return `if(!${id})${id}=new Proxy({},{get(_,k){return()=>null;}});
const ${n}=${id};`; });
        code = code.replace(/import\s+(\w+)\s*,\s*\{([^}]+)\}\s+from\s+['"]([^'"./][^'"]*)['"]/g,
          (_, def, named, pkg) => { const id = `window.__s_${pkg.replace(/\W/g,'_')}`; return `if(!${id})${id}=new Proxy({},{get(_,k){return()=>null;}});
const ${def}=${id}.default||${id};
const{${named.trim()}}=${id};`; });
        code = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"./][^'"]*)['"]/g,
          (_, names, pkg) => { const id = `window.__s_${pkg.replace(/\W/g,'_')}`; return `if(!${id})${id}=new Proxy({},{get(_,k){return()=>null;}});
const{${names.trim()}}=${id};`; });
        code = code.replace(/import\s+(\w+)\s+from\s+['"]([^'"./][^'"]*)['"]/g,
          (_, n, pkg) => { const id = `window.__s_${pkg.replace(/\W/g,'_')}`; return `if(!${id})${id}=new Proxy({},{get(_,k){return()=>null;}});
const ${n}=${id}.default||${id};`; });

        // export default function Foo / class Foo  →  function Foo / class Foo
        code = code.replace(/export\s+default\s+(function|class)\s+(\w+)/g, '$1 $2');
        // export default ArrowName;  →  (drop)
        code = code.replace(/export\s+default\s+\w+\s*;?/g, '');
        // export const/let/var/function/class  →  strip export keyword
        code = code.replace(/export\s+(const|let|var|function|class)\s+/g, '$1 ');
        // export { X, Y };  →  (drop)
        code = code.replace(/export\s*\{[^}]*\}\s*;?/g, '');

        // module.exports = {...}  →  (drop — config files)
        code = code.replace(/module\.exports\s*=\s*\{[\s\S]*?\}\s*;?/g, '');

        // ── const → var for all generated import stubs ─────────────────────
        // All files run in ONE shared Babel scope. If two files both import { Box }
        // from the same package, we get duplicate `const Box` declarations → SyntaxError.
        // Using `var` allows safe re-declaration across files.
        code = code.replace(/\bconst([ \t]*(\{[^}\n]+\}|\w+)[ \t]*=[ \t]*(React|ReactDOM|ReactRouterDOM|styled|window\.))/g,
          'var$1');

        return code;
      }

      // Sort: deepest paths first (leaf components defined before parents), index.js last
      const sorted = [...componentFiles].sort((a, b) => {
        const aDepth = normalizeFilePath(a.path).split('/').length;
        const bDepth = normalizeFilePath(b.path).split('/').length;
        if (bDepth !== aDepth) return bDepth - aDepth;
        const aIsEntry = /index\.(j|t)sx?$/.test(a.path);
        const bIsEntry = /index\.(j|t)sx?$/.test(b.path);
        return Number(aIsEntry) - Number(bIsEntry);
      });

      const scriptBody = sorted
        .map((f) => `// ── ${normalizeFilePath(f.path)} ──\n${processComponent(f.content)}`)
        .join('\n\n');

      // Find root component name
      const appFile = componentFiles.find((f) => /\/(App|app)\.(j|t)sx?$/.test(f.path));
      const rootComponentName = appFile
        ? (() => {
            const m = appFile.content.match(/(?:export\s+default\s+(?:function|class)\s+|function\s+|class\s+)(\w+)/);
            return m ? m[1] : 'App';
          })()
        : 'App';

      // Detect if react-router-dom is used so we can inject stubs
      const usesRouter = componentFiles.some((f) => /react-router-dom/.test(f.content));

      // Strip @tailwind directives from CSS (need CDN instead)
      const cleanCss = cssFiles
        .map((f) => f.content.replace(/@tailwind\s+\w+\s*;?/g, '').trim())
        .filter(Boolean)
        .join('\n');

      // Router stubs — no CDN needed, renders the '/' route so content is visible
      const routerStubs = usesRouter ? `
<script>
var ReactRouterDOM = (function() {
  var R = React;
  function BrowserRouter(p) { return p.children; }
  function MemoryRouter(p) { return p.children; }
  function HashRouter(p) { return p.children; }
  function Routes(p) {
    var kids = R.Children.toArray(p.children);
    var home = kids.find(function(c){ return c && c.props && (c.props.path === '/' || c.props.index); });
    if (home) return home.props.element || null;
    return kids.length ? (kids[0].props.element || null) : null;
  }
  function Route(p) { return p.element || null; }
  function Link(p) { var _p = Object.assign({}, p, {href: p.to}); delete _p.to; return R.createElement('a', _p, p.children); }
  function NavLink(p) { var _p = Object.assign({}, p, {href: p.to}); delete _p.to; return R.createElement('a', _p, p.children); }
  function Navigate(p) { return null; }
  function Outlet() { return null; }
  function useNavigate() { return function() {}; }
  function useLocation() { return {pathname:'/',search:'',hash:'',state:null}; }
  function useParams() { return {}; }
  function useMatch() { return null; }
  function useSearchParams() { return [{get:function(){return null;}},[function(){}]]; }
  return {BrowserRouter:BrowserRouter,MemoryRouter:MemoryRouter,HashRouter:HashRouter,Routes:Routes,Route:Route,Link:Link,NavLink:NavLink,Navigate:Navigate,Outlet:Outlet,useNavigate:useNavigate,useLocation:useLocation,useParams:useParams,useMatch:useMatch,useSearchParams:useSearchParams};
})();
</script>` : '';

      const mountCode = `ReactDOM.createRoot(rootEl).render(React.createElement(${rootComponentName}));`;

      const reactDoc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${project.name ?? 'Preview'}</title>
  <script crossorigin src="https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.development.js"></script>
  <script crossorigin src="https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.development.js"></script>
  <script>
  // Inline styled-components polyfill — avoids UMD/CommonJS detection issues with CDN builds
  window.styled = (function() {
    var _id = 0;
    function uid() { return 'sc' + (++_id); }
    function evalCss(strings, vals, props) {
      return strings.reduce(function(acc, s, i) {
        var v = vals[i];
        if (typeof v === 'function') { try { v = v(props || {}); } catch(e) { v = ''; } }
        return acc + s + (v == null ? '' : v);
      }, '');
    }
    function injectStyle(id, css) {
      var el = document.getElementById(id);
      if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
      el.textContent = css;
    }
    function makeFactory(tag) {
      function factory(strings) {
        var vals = Array.prototype.slice.call(arguments, 1);
        var cls = uid();
        function Comp(props) {
          var css = evalCss(strings, vals, props);
          injectStyle('sc-' + cls, '.' + cls + '{' + css + '}');
          var { children, className, ...rest } = props || {};
          return React.createElement(tag, Object.assign({}, rest, { className: [cls, className].filter(Boolean).join(' ') }), children);
        }
        Comp.displayName = 'styled.' + (typeof tag === 'string' ? tag : 'Component');
        Comp.attrs = function() { return factory; };
        Comp.withConfig = function() { return Comp; };
        return Comp;
      }
      factory.attrs = function() { return factory; };
      factory.withConfig = function() { return factory; };
      return factory;
    }
    var styled = function(tag) { return makeFactory(tag); };
    'a abbr address article aside audio b blockquote body br button canvas caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hr i iframe img input ins kbd label legend li main map mark menu nav noscript ol optgroup option output p picture pre progress q s section select small source span strong sub summary sup table tbody td textarea tfoot th thead tr u ul video'.split(' ').forEach(function(t) { styled[t] = makeFactory(t); });
    styled.css = function(strings) { var v = Array.prototype.slice.call(arguments,1); return evalCss(strings,v,{}); };
    styled.createGlobalStyle = function(strings) {
      var vals = Array.prototype.slice.call(arguments,1); var id = uid();
      return function(props) { injectStyle('gs-'+id, evalCss(strings,vals,props)); return null; };
    };
    styled.keyframes = function(strings) {
      var vals = Array.prototype.slice.call(arguments,1); var name = 'kf'+uid();
      injectStyle(name, '@keyframes '+name+'{'+evalCss(strings,vals,'')+'}'); return name;
    };
    styled.ThemeProvider = function(p) { return p.children || null; };
    styled.withTheme = function(C) { return C; };
    styled.useTheme = function() { return {}; };
    styled.ServerStyleSheet = function() { this.collectStyles = function(c){return c;}; this.getStyleTags = function(){return '';}; };
    return styled;
  })();
  </script>
  ${routerStubs}
  <script>
  // Proxy stub factory — transparent React component pass-through, used when a package has no CDN build
  window.__mkStub = function(name) {
    // React component that renders children transparently (avoids blank renders)
    function Comp(props) {
      if (!props) return null;
      if (props.children !== undefined) return props.children;
      return null;
    }
    Comp.displayName = name;
    // Also give it sub-component access (e.g. Dialog.Panel)
    var p = typeof Proxy !== 'undefined' ? new Proxy(Comp, {
      get: function(t, k) {
        if (k === 'default') return p;
        if (k === 'displayName' || k === 'name' || k in Function.prototype) return t[k];
        if (!t[k]) t[k] = window.__mkStub(name + '.' + k);
        return t[k];
      },
      construct: function() { return {}; }
    }) : Comp;
    return p;
  };
  </script>
  ${usedCdnLibs.map(lib => `<script crossorigin src="${lib.cdn}" onerror="console.warn('CDN failed: ${lib.pkg}, using stub');window.${lib.global}=window.__mkStub('${lib.global}')"></script>`).join('\n  ')}
  ${(usesIconLibs || usesHeadlessUI || usesChakra || usesMUI || usesAntd) ? `<script>
  // ── Icon stub (react-icons / heroicons / radix-ui/react-icons) ──────────
  window.__iconStub = typeof Proxy !== 'undefined' ? new Proxy({}, {
    get: function(_, name) {
      return function(props) {
        var attrs = Object.assign({ xmlns:'http://www.w3.org/2000/svg', width: props && props.size || 16, height: props && props.size || 16, viewBox:'0 0 24 24', fill:'currentColor', 'aria-hidden':'true' }, props);
        delete attrs.size; delete attrs.children;
        return React.createElement('svg', attrs);
      };
    }
  }) : {};

  // ── Transparent children pass-through for UI libraries without CDN builds ──
  function __passThrough(p) {
    if (!p) return null;
    var c = p.children;
    return (typeof c === 'function') ? (c({ open:false, checked:false, selected:false, active:false, disabled:false, isOpen:false, value:'' }) || null) : (c !== undefined ? c : null);
  }

  // ── Headless UI / Radix UI stub ──────────────────────────────────────────
  window.__headlessui = (function() {
    var base = typeof Proxy !== 'undefined' ? new Proxy({}, { get: function(_, k) { return k === '__esModule' ? false : __passThrough; } }) : {};
    ['Dialog','Transition','Menu','Popover','Disclosure','Listbox','Combobox','RadioGroup','Switch','Tab','Tabs'].forEach(function(name) {
      var c = function(p) { return __passThrough(p); }; c.displayName = name;
      ['Panel','Title','Description','Button','Items','Item','Options','Option','Label','Group','List','Tab','Panels','Overlay','Backdrop','Arrow'].forEach(function(s) { c[s] = function(p) { return __passThrough(p); }; });
      base[name] = c;
    });
    return base;
  })();

  // ── Chakra UI stub (@chakra-ui/react, @chakra-ui/icons) ─────────────────
  window.__chakra = (function() {
    function el(tag) { return function(props) {
      if (!props) return null;
      var { children, as: As, colorScheme, variant, size, isDisabled, isLoading, leftIcon, rightIcon, ...rest } = props;
      var t = As || tag;
      return React.createElement(t, rest, leftIcon, children, rightIcon);
    }; }
    var s = window.__mkStub('Chakra');
    ['Box','Flex','Grid','GridItem','Stack','HStack','VStack','Center','Container','Divider','Spacer'].forEach(function(n) { s[n] = el('div'); });
    ['Text','Heading','Link','Code','Kbd','Mark','Highlight'].forEach(function(n) { s[n] = el('p'); });
    ['Button','IconButton'].forEach(function(n) { s[n] = el('button'); });
    ['Input','Textarea','Select','NumberInput','NumberInputField','PinInput','PinInputField','Editable','EditableInput','EditableTextarea','EditablePreview'].forEach(function(n) { s[n] = el('input'); });
    ['Image','Avatar'].forEach(function(n) { s[n] = el('img'); });
    ['Card','CardHeader','CardBody','CardFooter','SimpleGrid','Wrap','WrapItem'].forEach(function(n) { s[n] = el('div'); });
    ['Modal','ModalOverlay','ModalContent','ModalHeader','ModalBody','ModalFooter','ModalCloseButton','Drawer','DrawerOverlay','DrawerContent','DrawerHeader','DrawerBody','DrawerFooter','DrawerCloseButton','Alert','AlertIcon','AlertTitle','AlertDescription','Toast','Popover','PopoverTrigger','PopoverContent','PopoverHeader','PopoverBody','PopoverFooter','Tooltip','Menu','MenuButton','MenuList','MenuItem','MenuDivider','Tabs','TabList','Tab','TabPanels','TabPanel','Accordion','AccordionItem','AccordionButton','AccordionPanel','AccordionIcon'].forEach(function(n) { s[n] = function(p) { return __passThrough(p); }; });
    s['ChakraProvider'] = function(p) { return __passThrough(p); };
    s['extendTheme'] = function(t) { return t || {}; };
    s['useDisclosure'] = function() { return { isOpen: false, onOpen: function(){}, onClose: function(){}, onToggle: function(){} }; };
    s['useToast'] = function() { return function() {}; };
    s['useColorMode'] = function() { return { colorMode: 'light', toggleColorMode: function(){} }; };
    s['useBreakpointValue'] = function(v) { return typeof v === 'object' ? (v.base || v.md || Object.values(v)[0]) : v; };
    s['useColorModeValue'] = function(l) { return l; };
    s['useTheme'] = function() { return {}; };
    s['Icon'] = function(props) { return React.createElement('svg', { xmlns:'http://www.w3.org/2000/svg', width:16, height:16, viewBox:'0 0 24 24', fill:'currentColor' }); };
    ['CheckIcon','CloseIcon','AddIcon','MinusIcon','SearchIcon','ChevronDownIcon','ChevronUpIcon','ChevronLeftIcon','ChevronRightIcon','ArrowForwardIcon','ArrowBackIcon','ArrowUpIcon','ArrowDownIcon','InfoIcon','WarningIcon','WarningTwoIcon','CheckCircleIcon','DeleteIcon','EditIcon','ExternalLinkIcon','HamburgerIcon','MoonIcon','SunIcon','StarIcon','QuestionIcon','QuestionOutlineIcon','AtSignIcon','EmailIcon','LockIcon','UnlockIcon','ViewIcon','ViewOffIcon','PhoneIcon','BellIcon','CalendarIcon','TimeIcon','DownloadIcon','AttachmentIcon','LinkIcon','CopyIcon','RepeatIcon','RepeatClockIcon','SpinnerIcon','SmallCloseIcon','SmallAddIcon','TriangleDownIcon','TriangleUpIcon','DragHandleIcon','ArrowLeftIcon','ArrowRightIcon','NotAllowedIcon','ChatIcon','UpDownIcon','SearchIcon2','SettingsIcon'].forEach(function(n) { s[n] = function(props) { return React.createElement('svg', { xmlns:'http://www.w3.org/2000/svg', width: props && props.boxSize || 16, height: props && props.boxSize || 16, viewBox:'0 0 24 24', fill:'currentColor' }); }; });
    return s;
  })();
  window.__s__chakra_ui_react = window.__chakra;
  window.__s__chakra_ui_icons = window.__chakra;

  // ── MUI stub (@mui/material, @mui/icons-material) ───────────────────────
  window.__mui = window.__mkStub('MUI');
  window.__s__mui_material = window.__mui;
  window.__s__mui_icons_material = window.__iconStub;
  window.__s__mui_x_date_pickers = window.__mkStub('MUIDatePickers');
  window.__s__mui_x_data_grid = window.__mkStub('MUIDataGrid');

  // ── Ant Design stub (antd) ───────────────────────────────────────────────
  window.__s_antd = window.__mkStub('Antd');
  </script>` : ''}
  <script crossorigin src="https://cdn.jsdelivr.net/npm/@babel/standalone@7.26.4/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; }
    ${cleanCss}
  </style>
  <script>
    window.addEventListener('error', function(e) {
      var el = document.getElementById('root');
      if (!el) return;
      var detail = e.message || String(e);
      if (e.filename) detail += '\\n  at ' + e.filename + ':' + e.lineno + ':' + e.colno;
      el.innerHTML = '<pre style="padding:2rem;color:#c00;background:#fff8f8;white-space:pre-wrap;font-size:13px;border-left:4px solid red;margin:1rem">' + detail + '</pre>';
    });
  </script>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-presets="react,typescript" data-type="module">
${scriptBody}

// ── Mount ──
(function () {
  var rootEl = document.getElementById('root');
  if (!rootEl) return;
  try {
    if (typeof ${rootComponentName} !== 'undefined') {
      ${mountCode}
    } else {
      rootEl.innerHTML = '<p style="padding:2rem;color:#555">Component <code>${rootComponentName}</code> not found.</p>';
    }
  } catch (e) {
    rootEl.innerHTML = '<pre style="padding:2rem;color:red;white-space:pre-wrap">' + e.message + '</pre>';
  }
})();
  </script>
</body>
</html>`;

      // Launch/refresh Docker container for this project (async, uses the HTML we just built)
      if (dockerService.isAvailable()) {
        dockerService.launch(project.id, reactDoc);
        // Clear pending flag if set
        const pending = (dockerService as unknown as { _pendingLaunch?: Set<string> })._pendingLaunch;
        pending?.delete(project.id);
      }

      return reply.header('Content-Type', 'text/html; charset=utf-8').send(reactDoc);
    }

    // ── Static HTML project ───────────────────────────────────────────────────
    if (htmlFiles.length === 0) {
      // Vue / unknown — show file list
      const fileList = files.map((f) => `<li><code>${normalizeFilePath(f.path)}</code> (${f.content.length} B)</li>`).join('\n');
      const noHtmlDoc = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Preview</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0e1322; color: #d4def7; padding: 2rem; }
  h2 { color: #33e6be; } li { margin: 0.4rem 0; }
  code { background: rgba(255,255,255,0.1); padding: 0.1rem 0.3rem; border-radius: 4px; font-size: 0.9em; }
  p { color: #8fa1c7; }
</style></head>
<body>
  <h2>Generated Project: ${project.name ?? project.id}</h2>
  <p>No HTML entry point found. Files generated:</p>
  <ul>${fileList}</ul>
</body></html>`;
      return reply.header('Content-Type', 'text/html; charset=utf-8').send(noHtmlDoc);
    }

    const entryHtml = htmlFiles.find((f) => normalizeFilePath(f.path).endsWith('index.html')) ?? htmlFiles[0];
    let doc = entryHtml.content;
    const cssBlock = cssFiles.map((f) => `<style>/* ${normalizeFilePath(f.path)} */\n${f.content}\n</style>`).join('\n');
    const jsBlock  = jsxFiles.map((f) => `<script>/* ${normalizeFilePath(f.path)} */\n${f.content}\n</script>`).join('\n');
    doc = doc.replace(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi, '');
    doc = doc.replace(/<script[^>]+src=["'][^"']*["'][^>]*><\/script>/gi, '');
    doc = doc.includes('</head>') ? doc.replace('</head>', `${cssBlock}\n</head>`) : cssBlock + '\n' + doc;
    doc = doc.includes('</body>') ? doc.replace('</body>', `${jsBlock}\n</body>`) : doc + '\n' + jsBlock;

    return reply.header('Content-Type', 'text/html; charset=utf-8').send(doc);
  });

  // GET /api/projects/:id/container — returns Docker container info for live preview
  app.get<{ Params: { id: string } }>('/:id/container', async (req, reply) => {
    if (!dockerService.isAvailable()) {
      return reply.send({ available: false, status: 'unavailable', url: null });
    }
    const info = dockerService.getInfo(req.params.id);
    if (!info) {
      return reply.send({ available: true, status: 'none', url: null });
    }
    return reply.send({ available: true, status: info.status, url: info.url || null });
  });

  // DELETE /api/projects/:id — delete project
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    await projectStore.delete(req.params.id);
    // Stop container if running
    if (dockerService.isAvailable()) {
      dockerService.stop(req.params.id).catch(() => {});
    }
    return reply.status(204).send();
  });

  // POST /api/projects/:id/prompts — append a new prompt and re-run partial pipeline
  app.post<{ Params: { id: string }; Body: { prompt: string } }>('/:id/prompts', async (req, reply) => {
    const { prompt } = req.body ?? {};

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
      throw new ValidationError('prompt must be at least 3 characters');
    }
    if (prompt.length > 10_000) {
      throw new ValidationError('prompt must not exceed 10,000 characters');
    }

    const existingProject = await projectStore.get(req.params.id);

    const { sessionId } = orchestrator.startUpdateAsync(existingProject, prompt.trim());

    return reply.status(202).send({
      project: { ...existingProject, sessionId, status: 'running' },
      pipeline: { sessionId, projectId: existingProject.id },
    });
  });

  // GET /api/projects/:id/prompts — get prompt history for a project
  app.get<{ Params: { id: string } }>('/:id/prompts', async (req, reply) => {
    const project = await projectStore.get(req.params.id);
    const prompts = project.prompts ?? [{ text: project.prompt, createdAt: project.createdAt }];
    return reply.send({ prompts });
  });

  // GET /api/projects/:id/versions — list saved versions
  app.get<{ Params: { id: string } }>('/:id/versions', async (req, reply) => {
    const project = await projectStore.get(req.params.id);
    const versions = (project.versions ?? []).map((v) => ({
      id: v.id,
      createdAt: v.createdAt,
      promptText: v.promptText,
      summary: v.summary,
      fileCount: v.files.length,
    }));
    return reply.send({ versions });
  });
}
