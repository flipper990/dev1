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
    role: 'admin',
    avatar: null,
    createdAt: new Date(Date.now() - 86400000 * 7).toISOString()
  };
  var FAKE_TOKEN = 'preview.mock.token.not_real';

  function rid() { return 'preview-' + Math.random().toString(36).slice(2, 10); }
  function rdate() { return new Date(Date.now() - Math.floor(Math.random() * 86400000 * 30)).toISOString(); }
  function listOf(factory, n) {
    var out = [];
    for (var i = 0; i < (n || 3); i++) out.push(factory(i));
    return out;
  }

  function inferMockBody(path, method) {
    path = String(path || '');
    method = String(method || 'GET').toUpperCase();

    if (/\\/(auth|login|signin|token)/i.test(path)) {
      return { user: FAKE_USER, token: FAKE_TOKEN, accessToken: FAKE_TOKEN, refreshToken: FAKE_TOKEN + '.refresh' };
    }
    if (/\\/(me|profile|account)(\\?|$)/i.test(path)) {
      return { user: FAKE_USER, profile: FAKE_USER };
    }
    if (/\\/(logout|signout)/i.test(path)) {
      return { success: true };
    }
    if (method === 'DELETE') {
      return { success: true, deleted: true };
    }
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      return { success: true, id: rid(), createdAt: rdate(), updatedAt: rdate() };
    }
    // Default GET response — a small, shape-agnostic list of items.
    return {
      items: listOf(function (i) {
        return {
          id: rid(),
          name: 'Item ' + (i + 1),
          title: 'Sample ' + (i + 1),
          description: 'Mocked preview response — no real backend is involved.',
          createdAt: rdate(),
          updatedAt: rdate(),
          status: 'active'
        };
      }, 4),
      total: 4,
      page: 1,
      pageSize: 20
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
