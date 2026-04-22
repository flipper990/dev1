/**
 * Preview Mock Injector
 *
 * Injects a client-side mock layer into the preview HTML page so it:
 *  - Intercepts every `fetch` / XMLHttpRequest call and returns plausible mock data
 *  - Simulates authentication (always returns a fake JWT / user session)
 *  - Simulates database responses for common REST patterns
 *  - Never crashes the preview even if the backend is absent or broken
 *
 * None of this code is ever included in the exported project.
 */

export interface ProjectMeta {
  id: string;
  name: string;
  envVars?: { name: string; description?: string; example?: string }[];
  apiContracts?: { method: string; path: string; response?: unknown }[];
}

/**
 * Build the <script> block that installs the mock layer inside the preview iframe.
 * Should be injected into <head> BEFORE any application scripts run.
 */
export function buildMockInjector(meta: ProjectMeta): string {
  const apiRoutes = buildApiRouteTable(meta.apiContracts ?? []);
  const projectName = meta.name.replace(/'/g, "\\'");

  return `<script id="__devteam_mock_layer">
(function() {
'use strict';

// ── Fake user / auth session ──────────────────────────────────────────────
var FAKE_USER = {
  id: 'preview-user-1',
  email: 'preview@devteam.local',
  name: 'Preview User',
  role: 'admin',
  avatar: null,
  createdAt: new Date(Date.now() - 86400000 * 7).toISOString(),
};

var FAKE_TOKEN = 'preview.mock.token.not_real';

// ── API route table (derived from the spec's apiContracts) ────────────────
var API_ROUTES = ${JSON.stringify(apiRoutes, null, 2)};

// ── Generic mock data generators ─────────────────────────────────────────
function mockId() { return 'preview-' + Math.random().toString(36).slice(2, 10); }
function mockDate() { return new Date(Date.now() - Math.floor(Math.random() * 86400000 * 30)).toISOString(); }
function mockListOf(factory, n) { return Array.from({ length: n || 3 }, factory); }

function inferMockBody(path, method) {
  // Auth endpoints
  if (/\\/(auth|login|signin|token)/.test(path)) {
    return { user: FAKE_USER, token: FAKE_TOKEN, accessToken: FAKE_TOKEN, refreshToken: FAKE_TOKEN + '.refresh' };
  }
  if (/\\/me$|\\/profile$|\\/account$/.test(path)) {
    return { user: FAKE_USER, profile: FAKE_USER };
  }
  if (/\\/logout$|\\/signout$/.test(path)) {
    return { success: true };
  }

  // Collection endpoints (GET list)
  if (method === 'GET' && !path.includes('/:id') && !path.match(/\\/[0-9a-f-]{8,}/)) {
    var resource = path.split('/').filter(Boolean).pop() || 'items';
    var singular = resource.replace(/s$/, '');
    var items = mockListOf(function() {
      var obj = {};
      obj.id = mockId();
      obj.createdAt = mockDate();
      obj.updatedAt = mockDate();
      obj.name = 'Sample ' + singular + ' ' + Math.ceil(Math.random() * 100);
      obj.status = ['active', 'inactive', 'pending'][Math.floor(Math.random() * 3)];
      obj.description = 'This is a mocked ' + singular + ' for preview purposes.';
      return obj;
    }, 4);
    return { [resource]: items, total: items.length, page: 1, pageSize: 20 };
  }

  // Single item endpoints
  if (method === 'GET') {
    var parts = path.split('/').filter(Boolean);
    var res = parts[parts.length - 2] || 'item';
    return {
      id: mockId(), createdAt: mockDate(), updatedAt: mockDate(),
      name: 'Sample ' + res.replace(/s$/, '') + ' 1',
      status: 'active', description: 'Preview mock item.',
    };
  }

  // Mutations
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    return { success: true, id: mockId(), createdAt: mockDate() };
  }
  if (method === 'DELETE') {
    return { success: true, deleted: true };
  }

  return { success: true };
}

// ── Core fetch interceptor ────────────────────────────────────────────────
var _realFetch = window.fetch;
window.fetch = function(input, init) {
  var url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url);
  var method = ((init && init.method) || 'GET').toUpperCase();

  // Pass-through CDN / external resources that are not API calls
  if (/^https?:\\/\\/(?!localhost|127\\.0\\.0\\.1)/.test(url)) {
    return _realFetch(input, init);
  }

  // Strip query string for matching
  var pathname = url.replace(/^https?:\\/\\/[^/]+/, '').replace(/\\?.*$/, '');

  // Look up in spec-derived route table
  var spec_response = lookupRoute(pathname, method);

  var body = spec_response !== undefined ? spec_response : inferMockBody(pathname, method);
  var status = method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200;

  // 204 No Content — no body
  if (status === 204) {
    return Promise.resolve(new Response(null, {
      status: 204,
      headers: { 'Content-Type': 'application/json' },
    }));
  }

  var json = JSON.stringify(body);
  return Promise.resolve(new Response(json, {
    status: status,
    headers: { 'Content-Type': 'application/json' },
  }));
};

// Match a pathname against the route table (handles :param segments)
function lookupRoute(pathname, method) {
  var entry = API_ROUTES[method + ' ' + pathname];
  if (entry !== undefined) return entry;

  // Parametric match
  for (var key in API_ROUTES) {
    var parts = key.split(' ');
    if (parts[0] !== method) continue;
    var pattern = parts[1].replace(/:[^/]+/g, '[^/]+');
    if (new RegExp('^' + pattern + '$').test(pathname)) {
      return API_ROUTES[key];
    }
  }
  return undefined;
}

// ── XMLHttpRequest interceptor (legacy code compat) ───────────────────────
var _RealXHR = window.XMLHttpRequest;
function MockXHR() {
  this._method = 'GET'; this._url = ''; this._headers = {};
  this.readyState = 0; this.status = 0; this.statusText = '';
  this.responseText = ''; this.response = ''; this.responseType = '';
  this.onreadystatechange = null; this.onload = null; this.onerror = null;
}
MockXHR.prototype.open = function(m, u) { this._method = m; this._url = u; this.readyState = 1; };
MockXHR.prototype.setRequestHeader = function(k, v) { this._headers[k] = v; };
MockXHR.prototype.getResponseHeader = function() { return 'application/json'; };
MockXHR.prototype.getAllResponseHeaders = function() { return 'content-type: application/json\\r\\n'; };
MockXHR.prototype.send = function() {
  var self = this;
  var pathname = self._url.replace(/^https?:\\/\\/[^/]+/, '').replace(/\\?.*$/, '');
  var method = self._method.toUpperCase();
  if (/^https?:\\/\\/(?!localhost|127\\.0\\.0\\.1)/.test(self._url)) {
    var real = new _RealXHR();
    real.open(method, self._url);
    real.onload = function() { self.readyState = 4; self.status = real.status; self.responseText = real.responseText; self.response = real.response; if (self.onload) self.onload(); if (self.onreadystatechange) self.onreadystatechange(); };
    real.onerror = function() { if (self.onerror) self.onerror(); };
    real.send();
    return;
  }
  var spec_response = lookupRoute(pathname, method);
  var body = spec_response !== undefined ? spec_response : inferMockBody(pathname, method);
  var status = method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200;
  self.readyState = 4;
  self.status = status;
  self.responseText = JSON.stringify(body);
  self.response = self.responseType === '' || self.responseType === 'text' ? self.responseText : body;
  setTimeout(function() {
    if (self.onload) self.onload();
    if (self.onreadystatechange) self.onreadystatechange();
  }, 0);
};
MockXHR.prototype.abort = function() {};
window.XMLHttpRequest = MockXHR;

// ── localStorage shim (iframes on same origin have real localStorage, ──────
// ── but provide a fallback in case the sandbox attribute blocks it)   ──────
try {
  window.localStorage.getItem('__probe');
} catch (e) {
  var _store = {};
  window.localStorage = {
    getItem: function(k) { return _store[k] !== undefined ? _store[k] : null; },
    setItem: function(k, v) { _store[k] = String(v); },
    removeItem: function(k) { delete _store[k]; },
    clear: function() { _store = {}; },
    key: function(i) { return Object.keys(_store)[i] || null; },
    get length() { return Object.keys(_store).length; },
  };
}

// Seed a fake auth token so code that checks localStorage on boot finds one
window.localStorage.setItem('token', FAKE_TOKEN);
window.localStorage.setItem('accessToken', FAKE_TOKEN);
window.localStorage.setItem('user', JSON.stringify(FAKE_USER));
window.localStorage.setItem('isAuthenticated', 'true');

// ── Console banner ─────────────────────────────────────────────────────────
console.info(
  '%c[DEVteam Preview]%c Mock layer active — all API calls are intercepted. Project: ${projectName}',
  'color:#33e6be;font-weight:bold', 'color:#8fa1c7',
);

})();
</script>`;
}

/** Build a key → response map from the spec's apiContracts array. */
function buildApiRouteTable(contracts: { method: string; path: string; response?: unknown }[]): Record<string, unknown> {
  const table: Record<string, unknown> = {};
  for (const c of contracts) {
    const key = `${c.method.toUpperCase()} ${c.path}`;
    table[key] = c.response ?? null;
  }
  return table;
}

/**
 * Inject the mock layer and a preview banner into an existing HTML string.
 * Inserts as the FIRST script in <head> so it runs before any app code.
 */
export function injectMockLayerIntoHtml(html: string, meta: ProjectMeta): string {
  const mockScript = buildMockInjector(meta);
  const banner = buildPreviewBanner(meta.name);

  // Insert mock script at the very beginning of <head>
  if (html.includes('<head>')) {
    html = html.replace('<head>', `<head>\n  ${mockScript}\n`);
  } else if (html.includes('<html')) {
    html = html.replace(/(<html[^>]*>)/, `$1\n<head>\n  ${mockScript}\n</head>\n`);
  } else {
    html = mockScript + '\n' + html;
  }

  // Inject preview banner as the first child of <body>
  if (html.includes('<body>')) {
    html = html.replace('<body>', `<body>\n  ${banner}\n`);
  } else if (html.includes('<body ')) {
    html = html.replace(/(<body[^>]*>)/, `$1\n  ${banner}\n`);
  }

  return html;
}

/** Thin banner at the top of the preview page identifying it as preview mode. */
function buildPreviewBanner(projectName: string): string {
  const safe = projectName.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div id="__devteam_preview_banner" style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:rgba(10,15,30,0.92);backdrop-filter:blur(8px);border-bottom:1px solid rgba(51,230,190,0.25);display:flex;align-items:center;gap:8px;padding:4px 12px;font-family:system-ui,sans-serif;font-size:11px;color:#33e6be;pointer-events:none;user-select:none;">
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#33e6be" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
  <span><strong>Preview mode</strong> — API calls are mocked &middot; <em>${safe}</em></span>
</div>
<div style="height:28px;pointer-events:none;"></div>`;
}
