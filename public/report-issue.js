/*
 * Sentinel — embeddable "Report issue" widget.
 *
 * Drop-in for any estate app. Injects a floating "Report issue" button + modal
 * and POSTs reports to Sentinel's /api/ingest/issue endpoint. Self-contained:
 * no dependencies, no framework, scoped styles, single global namespace.
 *
 * Embed (see REPORT_ISSUE_EMBED.md):
 *   <script
 *     src="https://ops.bentech.dev/report-issue.js"
 *     data-endpoint="https://ops.bentech.dev/api/ingest/issue"
 *     data-token="YOUR_OPS_INGEST_SECRET"
 *     data-app="YT"
 *     defer></script>
 *
 * Config can also be set before the script loads:
 *   window.SentinelReportIssue = { endpoint, token, app };
 *
 * The token is the shared OPS_INGEST_SECRET for the estate. It IS visible in the
 * browser — acceptable for trusted internal apps; it only grants "create a
 * report ticket", nothing else. For untrusted/public surfaces, proxy through
 * your own backend and sign with HMAC instead (x-ingest-signature).
 */
(function () {
  'use strict';
  if (window.__sentinelReportIssueLoaded) return;
  window.__sentinelReportIssueLoaded = true;

  // ---- Config: data-* on the <script> tag, then window.SentinelReportIssue ----
  var script = document.currentScript || (function () {
    var s = document.querySelectorAll('script[src*="report-issue.js"]');
    return s[s.length - 1] || null;
  })();
  var ds = (script && script.dataset) || {};
  var cfg = window.SentinelReportIssue || {};
  var ENDPOINT = ds.endpoint || cfg.endpoint || '/api/ingest/issue';
  var TOKEN = ds.token || cfg.token || '';
  var APP = ds.app || cfg.app || 'Estate';

  var TYPES = ['bug', 'incident', 'request', 'feedback'];
  var SEVERITIES = ['critical', 'high', 'medium', 'low'];

  // ---- Scoped styles ----
  var css = '' +
    '.sri-fab{position:fixed;right:18px;bottom:18px;z-index:2147483000;background:#2D6CFF;color:#fff;border:none;border-radius:22px;padding:10px 16px;font:600 13px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.3)}' +
    '.sri-fab:hover{background:#1B4DD1}' +
    '.sri-overlay{position:fixed;inset:0;background:rgba(8,10,14,.6);z-index:2147483001;display:flex;align-items:flex-start;justify-content:center;padding:8vh 16px;font:14px/1.5 system-ui,sans-serif}' +
    '.sri-modal{background:#161922;color:#E7EAF0;border:1px solid #272D3A;border-radius:12px;width:100%;max-width:460px;box-shadow:0 24px 60px rgba(0,0,0,.5)}' +
    '.sri-h{display:flex;justify-content:space-between;align-items:center;padding:15px 17px;border-bottom:1px solid #272D3A;font-weight:700;font-size:15px}' +
    '.sri-x{background:none;border:none;color:#8A93A6;font-size:20px;cursor:pointer;line-height:1}' +
    '.sri-body{padding:16px 17px}' +
    '.sri-f{display:flex;flex-direction:column;gap:5px;margin-bottom:12px}' +
    '.sri-f>label{font-size:11px;text-transform:uppercase;letter-spacing:.5px;font-weight:600;color:#8A93A6}' +
    '.sri-in,.sri-sel,.sri-ta{width:100%;background:#0B0D11;border:1px solid #272D3A;border-radius:8px;padding:8px 11px;font:13px system-ui,sans-serif;color:#E7EAF0;box-sizing:border-box}' +
    '.sri-in:focus,.sri-sel:focus,.sri-ta:focus{outline:none;border-color:#2D6CFF}' +
    '.sri-ta{resize:vertical;min-height:74px}' +
    '.sri-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}' +
    '.sri-foot{display:flex;justify-content:flex-end;gap:8px;padding:13px 17px;border-top:1px solid #272D3A}' +
    '.sri-btn{background:#2D6CFF;color:#fff;border:none;border-radius:8px;padding:8px 14px;font:600 13px system-ui;cursor:pointer}' +
    '.sri-btn[disabled]{opacity:.6;cursor:default}' +
    '.sri-btn.ghost{background:#1C2030;border:1px solid #272D3A;color:#E7EAF0}' +
    '.sri-msg{padding:6px 0;font-size:13px}' +
    '.sri-ok{color:#5fd49b}.sri-err{color:#ff8b8e}';

  function injectStyles() {
    if (document.getElementById('sri-styles')) return;
    var st = document.createElement('style');
    st.id = 'sri-styles';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    attrs = attrs || {};
    for (var k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) {
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  function options(values) {
    return values.map(function (v) { return el('option', { value: v }, [v]); });
  }

  function openModal() {
    var overlay = el('div', { class: 'sri-overlay' });
    var titleIn = el('input', { class: 'sri-in', placeholder: 'Short summary' });
    var descTa = el('textarea', { class: 'sri-ta', placeholder: 'What happened? Steps to reproduce?' });
    var typeSel = el('select', { class: 'sri-sel' }, options(TYPES));
    var sevSel = el('select', { class: 'sri-sel' }, options(SEVERITIES));
    sevSel.value = 'medium';
    var msg = el('div', { class: 'sri-msg' });
    var submitBtn = el('button', { class: 'sri-btn' }, ['Send report']);
    var cancelBtn = el('button', { class: 'sri-btn ghost' }, ['Cancel']);

    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    cancelBtn.onclick = close;
    overlay.onclick = function (e) { if (e.target === overlay) close(); };

    submitBtn.onclick = function () {
      var title = (titleIn.value || '').trim();
      if (!title) { msg.className = 'sri-msg sri-err'; msg.textContent = 'A title is required.'; return; }
      submitBtn.disabled = true;
      msg.className = 'sri-msg'; msg.textContent = 'Sending…';
      var headers = { 'Content-Type': 'application/json' };
      if (TOKEN) headers['x-ingest-token'] = TOKEN;
      fetch(ENDPOINT, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          app: APP,
          title: title,
          description: descTa.value || '',
          type: typeSel.value,
          severity: sevSel.value,
          url: window.location.href,
          reporter: (cfg.reporter || (window.SentinelReportIssue && window.SentinelReportIssue.reporter) || '')
        })
      }).then(function (r) {
        return r.json().then(function (d) { return { ok: r.ok, d: d }; });
      }).then(function (res) {
        if (res.ok && res.d && res.d.ref) {
          msg.className = 'sri-msg sri-ok';
          msg.textContent = 'Reported as ' + res.d.ref + '. Thank you!';
          submitBtn.textContent = 'Sent';
          setTimeout(close, 2200);
        } else {
          submitBtn.disabled = false;
          msg.className = 'sri-msg sri-err';
          msg.textContent = (res.d && res.d.error) ? res.d.error : 'Could not send report.';
        }
      }).catch(function () {
        submitBtn.disabled = false;
        msg.className = 'sri-msg sri-err';
        msg.textContent = 'Network error — please try again.';
      });
    };

    function field(label, control) { return el('div', { class: 'sri-f' }, [el('label', {}, [label]), control]); }

    var modal = el('div', { class: 'sri-modal' }, [
      el('div', { class: 'sri-h' }, ['Report an issue', (function () { var x = el('button', { class: 'sri-x', 'aria-label': 'Close' }, ['×']); x.onclick = close; return x; })()]),
      el('div', { class: 'sri-body' }, [
        field('Title', titleIn),
        field('Description', descTa),
        el('div', { class: 'sri-grid' }, [field('Type', typeSel), field('Severity', sevSel)]),
        msg
      ]),
      el('div', { class: 'sri-foot' }, [cancelBtn, submitBtn])
    ]);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    titleIn.focus();
  }

  function mount() {
    injectStyles();
    var fab = el('button', { class: 'sri-fab', type: 'button' }, ['Report issue']);
    fab.onclick = openModal;
    document.body.appendChild(fab);
  }

  // Expose a programmatic opener too (e.g. wire to your own menu item).
  window.SentinelReportIssue = Object.assign({}, cfg, {
    endpoint: ENDPOINT, token: TOKEN, app: APP, open: openModal,
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
