/**
 * Frontend-only preview mock layer.
 *
 * Installed as the FIRST <script> in every preview iframe so it:
 *   - intercepts every fetch() / XMLHttpRequest call and returns plausible JSON
 *   - stubs out localStorage/sessionStorage inside sandboxed (allow-scripts
 *     only) iframes where they would otherwise throw
 *   - captures window.onerror + unhandledrejection and renders a visible
 *     fallback overlay instead of leaving the user with a blank iframe
 *   - forwards console.log / console.error to the parent window via postMessage
 *     so the host app's Logs panel can surface preview-side activity
 *
 * Everything is a self-contained IIFE — no module system, no imports. The
 * script is serialised verbatim into srcDoc so it must stay runtime-valid
 * ES5 (no optional chaining, no top-level await).
 */
export const PREVIEW_MOCK_SCRIPT = `<script id="__devteam_preview_mock">
(function () {
  'use strict';

  // ─── In-memory storage fallback (sandboxed iframes without allow-same-origin
  //     can have localStorage/sessionStorage throw or be unusable) ───────────
  function createStorageShim() {
    var data = Object.create(null);
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[k] = String(v); },
      removeItem: function (k) { delete data[k]; },
      clear: function () { data = Object.create(null); },
      key: function (i) { return Object.keys(data)[i] || null; },
      get length() { return Object.keys(data).length; }
    };
  }
  try {
    var probe = '__devteam_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
  } catch (e) {
    try { Object.defineProperty(window, 'localStorage',   { value: createStorageShim(), configurable: true }); } catch (_) {}
    try { Object.defineProperty(window, 'sessionStorage', { value: createStorageShim(), configurable: true }); } catch (_) {}
  }

  // ─── Fake user / auth session ─────────────────────────────────────────────
  var FAKE_USER = {
    id: 'preview-user-1',
    email: 'preview@devteam.local',
    name: 'Preview User',
    firstName: 'Preview',
    lastName: 'User',
    username: 'preview_user',
    displayName: 'Preview User',
    role: 'admin',
    roles: ['admin', 'user'],
    permissions: ['read', 'write', 'admin'],
    isAdmin: true,
    isAuthenticated: true,
    emailVerified: true,
    avatar: null,
    avatarUrl: null,
    image: null,
    bio: 'Preview account — mock data only.',
    createdAt: new Date(Date.now() - 86400000 * 7).toISOString(),
    updatedAt: new Date().toISOString()
  };
  var FAKE_TOKEN = 'preview.mock.token.not_real';

  // Seed the shimmed storage so code that reads 'token' / 'user' on mount
  // finds a value and renders the authenticated UI instead of redirecting to
  // /login (which is a common "blank screen" failure mode in the preview).
  try {
    var storageKeys = ['token', 'accessToken', 'auth_token', 'authToken', 'jwt'];
    for (var si = 0; si < storageKeys.length; si++) {
      try { window.localStorage.setItem(storageKeys[si], FAKE_TOKEN); } catch (_) {}
    }
    try { window.localStorage.setItem('user', JSON.stringify(FAKE_USER)); } catch (_) {}
    try { window.localStorage.setItem('currentUser', JSON.stringify(FAKE_USER)); } catch (_) {}
    try { window.localStorage.setItem('auth', JSON.stringify({ user: FAKE_USER, token: FAKE_TOKEN, isAuthenticated: true })); } catch (_) {}
  } catch (_) {}

  function rid() { return 'preview-' + Math.random().toString(36).slice(2, 10); }
  function rdate() { return new Date(Date.now() - Math.floor(Math.random() * 86400000 * 30)).toISOString(); }
  function listOf(factory, n) {
    var out = [];
    for (var i = 0; i < (n || 3); i++) out.push(factory(i));
    return out;
  }

  // Entity templates keyed by URL path segment. Keeps mock responses
  // contextually plausible (product endpoints return product-shaped data,
  // etc.) so apps that render based on response shape don't blank out.
  var ENTITY_TEMPLATES = {
    product: function (i) {
      return { id: rid(), name: 'Product ' + (i + 1), title: 'Product ' + (i + 1), description: 'High-quality sample product for preview.', price: Math.floor(Math.random() * 9000 + 1000) / 100, currency: 'USD', stock: Math.floor(Math.random() * 100) + 1, category: ['Electronics','Clothing','Home','Books'][i % 4], image: null, imageUrl: null, rating: Math.floor(Math.random() * 20 + 30) / 10, inStock: true, createdAt: rdate(), updatedAt: rdate() };
    },
    order: function (i) {
      return { id: rid(), orderNumber: 'ORD-' + (10000 + i), total: Math.floor(Math.random() * 50000) / 100, status: ['pending','processing','shipped','delivered'][i % 4], items: [], customerId: FAKE_USER.id, createdAt: rdate(), updatedAt: rdate() };
    },
    user: function (i) {
      return { id: rid(), name: 'User ' + (i + 1), email: 'user' + (i + 1) + '@example.com', role: i === 0 ? 'admin' : 'user', avatar: null, active: true, createdAt: rdate() };
    },
    message: function (i) {
      return { id: rid(), text: 'Sample message ' + (i + 1), content: 'This is a preview message. No real data.', senderId: FAKE_USER.id, senderName: FAKE_USER.name, read: i > 0, createdAt: rdate() };
    },
    post: function (i) {
      return { id: rid(), title: 'Sample Post ' + (i + 1), content: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sample post body for preview.', excerpt: 'Lorem ipsum dolor sit amet...', author: FAKE_USER.name, authorId: FAKE_USER.id, published: true, tags: ['sample','preview'], createdAt: rdate(), updatedAt: rdate() };
    },
    comment: function (i) {
      return { id: rid(), text: 'Great post! (sample comment ' + (i + 1) + ')', content: 'Sample comment content.', authorId: FAKE_USER.id, authorName: FAKE_USER.name, createdAt: rdate() };
    },
    notification: function (i) {
      return { id: rid(), type: ['info','success','warning'][i % 3], title: 'Notification ' + (i + 1), message: 'Sample notification body.', read: i > 0, createdAt: rdate() };
    },
    task: function (i) {
      return { id: rid(), title: 'Task ' + (i + 1), description: 'Sample task description.', status: ['todo','in-progress','done'][i % 3], priority: ['low','medium','high'][i % 3], assigneeId: FAKE_USER.id, dueDate: new Date(Date.now() + 86400000 * (i + 1)).toISOString(), createdAt: rdate() };
    },
    project: function (i) {
      return { id: rid(), name: 'Project ' + (i + 1), description: 'Sample project for preview.', status: 'active', ownerId: FAKE_USER.id, members: 3, createdAt: rdate() };
    },
    event: function (i) {
      return { id: rid(), title: 'Event ' + (i + 1), description: 'Sample event.', startDate: new Date(Date.now() + 86400000 * i).toISOString(), endDate: new Date(Date.now() + 86400000 * (i + 1)).toISOString(), location: 'Online' };
    },
    category: function (i) {
      return { id: rid(), name: ['Electronics','Clothing','Home','Books','Sports','Food'][i % 6], slug: ['electronics','clothing','home','books','sports','food'][i % 6], count: Math.floor(Math.random() * 50) + 5 };
    }
  };

  function detectEntity(path) {
    var p = String(path || '').toLowerCase();
    // Strip query string
    var qi = p.indexOf('?'); if (qi >= 0) p = p.slice(0, qi);
    var segments = p.split('/').filter(Boolean);
    // Scan right-to-left so the most specific segment wins
    for (var i = segments.length - 1; i >= 0; i--) {
      var seg = segments[i];
      // Singular + common plural forms
      var keys = Object.keys(ENTITY_TEMPLATES);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        if (seg === key || seg === key + 's' || seg === key + 'es' || seg.indexOf(key) === 0) {
          return key;
        }
      }
    }
    return null;
  }

  function genericItem(i) {
    return {
      id: rid(),
      name: 'Item ' + (i + 1),
      title: 'Sample ' + (i + 1),
      description: 'Mocked preview response — no real backend is involved.',
      createdAt: rdate(),
      updatedAt: rdate(),
      status: 'active'
    };
  }

  function inferMockBody(path, method) {
    path = String(path || '');
    method = String(method || 'GET').toUpperCase();

    if (/\\/(auth|login|signin|token)/i.test(path)) {
      return { user: FAKE_USER, token: FAKE_TOKEN, accessToken: FAKE_TOKEN, refreshToken: FAKE_TOKEN + '.refresh', isAuthenticated: true };
    }
    if (/\\/(register|signup)/i.test(path)) {
      return { user: FAKE_USER, token: FAKE_TOKEN, accessToken: FAKE_TOKEN, success: true };
    }
    if (/\\/(me|profile|account|current[-_]?user|whoami)(\\?|$|\\/)/i.test(path)) {
      return { user: FAKE_USER, profile: FAKE_USER, id: FAKE_USER.id, email: FAKE_USER.email, name: FAKE_USER.name, role: FAKE_USER.role };
    }
    if (/\\/(logout|signout)/i.test(path)) {
      return { success: true };
    }
    if (/\\/(stats|metrics|analytics|dashboard|summary|overview)/i.test(path)) {
      return {
        totalUsers: 1284, totalOrders: 342, totalRevenue: 48290.5, totalProducts: 89,
        growth: 0.12, activeUsers: 423, pendingOrders: 18,
        recentActivity: listOf(function (i) { return { id: rid(), type: 'activity', description: 'Sample activity ' + (i + 1), timestamp: rdate() }; }, 5),
        chart: listOf(function (i) { return { label: 'Day ' + (i + 1), value: Math.floor(Math.random() * 1000) + 200 }; }, 7)
      };
    }
    if (/\\/(health|ping|status|ready)(\\?|$)/i.test(path)) {
      return { status: 'ok', healthy: true, uptime: 12345 };
    }
    if (/\\/(config|settings|preferences)(\\?|$|\\/)/i.test(path)) {
      return { theme: 'light', locale: 'en', features: { darkMode: true, notifications: true, experimental: false }, version: '1.0.0' };
    }

    if (method === 'DELETE') {
      return { success: true, deleted: true, id: rid() };
    }

    // Detect entity from path and respond with shape-appropriate data.
    var entity = detectEntity(path);
    var factory = entity ? ENTITY_TEMPLATES[entity] : genericItem;

    // Detect "get single by id" — trailing segment looks like an id/slug.
    var trailing = path.split(/[?#]/)[0].replace(/\\/+$/, '').split('/').pop() || '';
    var isSingle = method === 'GET' && /^[a-f0-9-]{6,}$|^\\d+$/i.test(trailing);

    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      var base = factory(0);
      return Object.assign({}, base, { success: true, id: base.id, createdAt: rdate(), updatedAt: rdate() });
    }

    if (isSingle) {
      return factory(0);
    }

    // Default: list response with both bare-array and paginated shapes covered.
    var items = listOf(factory, 6);
    return {
      items: items,
      data: items,
      results: items,
      list: items,
      total: items.length,
      count: items.length,
      page: 1,
      pageSize: 20,
      hasMore: false
    };
  }

  // ─── fetch() interceptor ──────────────────────────────────────────────────
  var originalFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var method = (init && init.method) || (input && input.method) || 'GET';
      var body = inferMockBody(url, method);
      var response = new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Preview-Mock': '1' }
      });
      return Promise.resolve(response);
    } catch (err) {
      // Never reject — always resolve so the app keeps rendering.
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
  };

  // ─── XMLHttpRequest interceptor ───────────────────────────────────────────
  var OriginalXHR = window.XMLHttpRequest;
  function MockXHR() {
    this._url = '';
    this._method = 'GET';
    this.readyState = 0;
    this.status = 0;
    this.responseText = '';
    this.response = '';
    this.responseType = '';
    this.onreadystatechange = null;
    this.onload = null;
    this.onerror = null;
    this._headers = {};
  }
  MockXHR.prototype.open = function (method, url) {
    this._method = method || 'GET';
    this._url = url || '';
    this.readyState = 1;
    if (this.onreadystatechange) try { this.onreadystatechange(); } catch (_) {}
  };
  MockXHR.prototype.setRequestHeader = function (k, v) { this._headers[k] = v; };
  MockXHR.prototype.getAllResponseHeaders = function () { return 'content-type: application/json\\r\\nx-preview-mock: 1'; };
  MockXHR.prototype.getResponseHeader = function (name) {
    if (String(name).toLowerCase() === 'content-type') return 'application/json';
    return null;
  };
  MockXHR.prototype.abort = function () { this.readyState = 0; };
  MockXHR.prototype.send = function () {
    var self = this;
    setTimeout(function () {
      var body = inferMockBody(self._url, self._method);
      self.status = 200;
      self.readyState = 4;
      self.responseText = JSON.stringify(body);
      self.response = self.responseType === 'json' ? body : self.responseText;
      if (self.onreadystatechange) try { self.onreadystatechange(); } catch (_) {}
      if (self.onload) try { self.onload({ target: self }); } catch (_) {}
    }, 0);
  };
  try { window.XMLHttpRequest = MockXHR; } catch (_) { /* keep original if FR */ }

  // ─── WebSocket stub ───────────────────────────────────────────────────────
  // Some generated apps auto-connect to a websocket on load. A real connection
  // against a random URL will just spam errors in the iframe. Replace it with
  // a no-op that looks connected.
  try {
    var NoopWS = function (url) {
      this.url = url;
      this.readyState = 1;
      this.onopen = null; this.onmessage = null; this.onerror = null; this.onclose = null;
      var self = this;
      setTimeout(function () { if (self.onopen) try { self.onopen({ target: self }); } catch (_) {} }, 0);
    };
    NoopWS.prototype.send    = function () {};
    NoopWS.prototype.close   = function () { this.readyState = 3; if (this.onclose) try { this.onclose({ target: this }); } catch (_) {} };
    NoopWS.CONNECTING = 0; NoopWS.OPEN = 1; NoopWS.CLOSING = 2; NoopWS.CLOSED = 3;
    window.WebSocket = NoopWS;
  } catch (_) {}
  // ─── EventSource (Server-Sent Events) stub ────────────────────────────
  // Apps that subscribe to SSE for live updates would otherwise spam network
  // errors and silently never fire onmessage — a common blank-screen cause for
  // dashboard-style apps.
  try {
    var NoopES = function (url) {
      this.url = url;
      this.readyState = 1;
      this.withCredentials = false;
      this.onopen = null; this.onmessage = null; this.onerror = null;
      var self = this;
      setTimeout(function () { if (self.onopen) try { self.onopen({ target: self }); } catch (_) {} }, 0);
    };
    NoopES.prototype.addEventListener = function () {};
    NoopES.prototype.removeEventListener = function () {};
    NoopES.prototype.dispatchEvent = function () { return true; };
    NoopES.prototype.close = function () { this.readyState = 2; };
    NoopES.CONNECTING = 0; NoopES.OPEN = 1; NoopES.CLOSED = 2;
    window.EventSource = NoopES;
  } catch (_) {}
  // ─── Console bridge → parent window (best-effort) ─────────────────────────
  var levels = ['log', 'info', 'warn', 'error'];
  for (var i = 0; i < levels.length; i++) {
    (function (lvl) {
      var orig = console[lvl] ? console[lvl].bind(console) : function () {};
      console[lvl] = function () {
        try {
          var args = [];
          for (var j = 0; j < arguments.length; j++) {
            try { args.push(typeof arguments[j] === 'string' ? arguments[j] : JSON.stringify(arguments[j])); }
            catch (_) { args.push(String(arguments[j])); }
          }
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ __devteamPreview: true, kind: 'console', level: lvl, message: args.join(' ') }, '*');
          }
        } catch (_) {}
        try { orig.apply(null, arguments); } catch (_) {}
      };
    })(levels[i]);
  }

  // ─── Global error handlers → visible fallback overlay ─────────────────────
  function renderFallback(title, message) {
    try {
      var existing = document.getElementById('__devteam_preview_fallback');
      if (existing) existing.parentNode.removeChild(existing);

      var host = document.createElement('div');
      host.id = '__devteam_preview_fallback';
      host.setAttribute('style', [
        'position:fixed', 'inset:0', 'z-index:2147483647',
        'display:flex', 'align-items:center', 'justify-content:center',
        'background:rgba(7,9,15,0.92)', 'color:#F1F5F9',
        'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
        'padding:24px', 'box-sizing:border-box'
      ].join(';'));

      var card = document.createElement('div');
      card.setAttribute('style', [
        'max-width:460px', 'width:100%',
        'background:#0F172A', 'border:1px solid rgba(245,158,11,0.35)',
        'border-radius:12px', 'padding:24px', 'text-align:center',
        'box-shadow:0 20px 60px rgba(0,0,0,0.5)'
      ].join(';'));

      card.innerHTML =
        '<div style="font-size:28px;line-height:1;margin-bottom:12px;">⚠️</div>' +
        '<div style="font-size:14px;font-weight:600;margin-bottom:6px;">' + String(title) + '</div>' +
        '<div style="font-size:12px;color:#94A3B8;margin-bottom:16px;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">' + String(message || '').slice(0, 500) + '</div>' +
        '<div style="font-size:11px;color:#64748B;">Preview kept alive — your app threw but the harness caught it.</div>';

      host.appendChild(card);
      (document.body || document.documentElement).appendChild(host);

      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ __devteamPreview: true, kind: 'error', title: String(title), message: String(message || '') }, '*');
      }
    } catch (_) { /* if even the fallback fails, there's nothing we can do */ }
  }

  window.addEventListener('error', function (event) {
    var msg = (event && event.message) || (event && event.error && event.error.message) || 'Unknown error';
    renderFallback('Runtime error in preview', msg);
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    var msg = reason && reason.message ? reason.message : (typeof reason === 'string' ? reason : 'Unhandled promise rejection');
    renderFallback('Unhandled promise rejection', msg);
  });

  // ─── Tell the parent we're alive ──────────────────────────────────────────
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ __devteamPreview: true, kind: 'ready' }, '*');
    }
  } catch (_) {}
})();
</script>`;
