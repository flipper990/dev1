import type { FastifyInstance } from 'fastify';
import { ValidationError } from '@devteam/core';
import type { CreateProjectRequest } from '@devteam/core';
import { Orchestrator, sessionManager } from '@devteam/orchestration';
import { globalMemoryStore } from '@devteam/memory';
import { globalLLMRouter } from '@devteam/api-routing';
import { projectStore } from '../storage/project-store.js';

function normalizeFilePath(path: string): string {
  return path.replace(/\\/g, '/').trim();
}

// ─── Shared orchestrator instance ─────────────────────────────────────────────

const orchestrator = new Orchestrator({
  memory: globalMemoryStore,
  llm: { complete: (req) => globalLLMRouter.complete(req) },
  onProjectSave: async (project) => {
    await projectStore.save(project);
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

        // All remaining local relative imports  →  (drop)
        code = code.replace(/import\s+(?:\*\s+as\s+\w+|\w+(?:\s*,\s*\{[^}]*\})?|\{[^}]*\})\s+from\s+['"][./][^'"]*['"];?/g, '');
        // Side-effect imports (e.g. import './index.css')  →  (drop)
        code = code.replace(/import\s+['"][^'"]*['"];?/g, '');
        // Any remaining external package imports not handled above  →  (drop)
        code = code.replace(/import\s+(?:\w+(?:\s*,\s*\{[^}]*\})?|\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+['"][^'"]+['"];?/g, '');

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
  ${routerStubs}
  <script src="https://cdn.jsdelivr.net/npm/@babel/standalone@7.26.4/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; }
    ${cleanCss}
  </style>
  <script>
    window.addEventListener('error', function(e) {
      var el = document.getElementById('root');
      if (el) el.innerHTML = '<pre style="padding:2rem;color:#c00;background:#fff8f8;white-space:pre-wrap;font-size:13px;border-left:4px solid red;margin:1rem">' + (e.message || String(e)) + '</pre>';
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

  // DELETE /api/projects/:id — delete project
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    await projectStore.delete(req.params.id);
    return reply.status(204).send();
  });
}
