/*
 * Sentinel — embeddable CUSTOMER SUPPORT CHAT widget.
 *
 * Drop-in for a public product site (e.g. scribuo.com). Injects a floating
 * launcher + chat panel and talks to Sentinel's P2 customer-intake API. Self-
 * contained: no dependencies, no framework, scoped styles, single global.
 *
 * Flow:
 *   L0 self-serve — a search box that hits /api/public/support/kb first and shows
 *                   relevant help articles (deflects many questions), plus a
 *                   coarse service status.
 *   L1 chat       — the customer types a question → POST /api/public/support/chat
 *                   → shows the AI (grounded) answer (long replies are chunked
 *                   into multiple bubbles).
 *   Escalate      — a "Talk to a human" button flags the ticket for the support
 *                   queue and confirms a human will follow up.
 *
 * Embed (see SUPPORT_CHAT_EMBED docs / final report):
 *   <script
 *     src="https://ops.scribuo.com/support-chat.js"
 *     data-api-base="https://ops.scribuo.com"
 *     data-token="YOUR_OPS_SUPPORT_TOKEN"
 *     data-app="Scribuo"
 *     defer></script>
 *
 * Config can also be set before the script loads:
 *   window.SentinelSupportChat = { apiBase, token, app, email, name, tenantRef };
 *
 * The token is OPS_SUPPORT_TOKEN — the dedicated, LEAST-PRIVILEGE token for this
 * widget. It IS visible in the browser, which is acceptable because it ONLY
 * grants "open/continue a support conversation" (create a support ticket + get an
 * L1 answer) via /api/public/support/*. It cannot post ticket updates, write the
 * roadmap/changelog, or push findings (those require the privileged
 * OPS_INGEST_SECRET, which must NEVER be placed in a browser).
 */
(function () {
  'use strict';
  if (window.__sentinelSupportChatLoaded) return;
  window.__sentinelSupportChatLoaded = true;

  // ---- Config: data-* on the <script> tag, then window.SentinelSupportChat ----
  var script = document.currentScript || (function () {
    var s = document.querySelectorAll('script[src*="support-chat.js"]');
    return s[s.length - 1] || null;
  })();
  var ds = (script && script.dataset) || {};
  var cfg = window.SentinelSupportChat || {};
  var API_BASE = (ds.apiBase || cfg.apiBase || '').replace(/\/$/, '');
  var TOKEN = ds.token || cfg.token || '';
  var APP = ds.app || cfg.app || 'Scribuo';
  var EMAIL = ds.email || cfg.email || '';
  var NAME = ds.name || cfg.name || '';
  var TENANT_REF = ds.tenantRef || cfg.tenantRef || null; // Clerk org id if signed in, else null

  var CHAT_URL = API_BASE + '/api/public/support/chat';
  var KB_URL = API_BASE + '/api/public/support/kb';
  var STATUS_URL = API_BASE + '/api/public/support/status';

  // ---- Runtime state ----
  var conversationId = null; // set from the first chat reply; threads the ticket
  var busy = false;

  // ---- Scoped styles (prefix shc-) ----
  var css = '' +
    '.shc-fab{position:fixed;right:18px;bottom:18px;z-index:2147483000;background:#2D6CFF;color:#fff;border:none;border-radius:26px;padding:12px 18px;font:600 14px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.3);display:flex;align-items:center;gap:8px}' +
    '.shc-fab:hover{background:#1B4DD1}' +
    '.shc-panel{position:fixed;right:18px;bottom:18px;z-index:2147483001;width:380px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 36px);background:#161922;color:#E7EAF0;border:1px solid #272D3A;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.5);display:flex;flex-direction:column;overflow:hidden;font:14px/1.5 system-ui,sans-serif}' +
    '.shc-h{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #272D3A;background:#0F1218}' +
    '.shc-h b{font-size:15px}.shc-h small{display:block;color:#8A93A6;font-size:11px;font-weight:400;margin-top:2px}' +
    '.shc-hd{display:flex;align-items:center;gap:8px}' +
    '.shc-dot{width:8px;height:8px;border-radius:50%;background:#5fd49b;box-shadow:0 0 0 3px rgba(95,212,155,.18)}' +
    '.shc-dot.warn{background:#ffcf5f;box-shadow:0 0 0 3px rgba(255,207,95,.18)}' +
    '.shc-dot.down{background:#ff6b6b;box-shadow:0 0 0 3px rgba(255,107,107,.18)}' +
    '.shc-x{background:none;border:none;color:#8A93A6;font-size:22px;cursor:pointer;line-height:1}' +
    '.shc-body{flex:1;overflow-y:auto;padding:14px 16px}' +
    '.shc-foot{border-top:1px solid #272D3A;padding:10px 12px;background:#0F1218}' +
    '.shc-row{display:flex;gap:8px}' +
    '.shc-in,.shc-search{flex:1;background:#0B0D11;border:1px solid #272D3A;border-radius:9px;padding:9px 12px;font:13px system-ui,sans-serif;color:#E7EAF0;box-sizing:border-box}' +
    '.shc-in:focus,.shc-search:focus{outline:none;border-color:#2D6CFF}' +
    '.shc-btn{background:#2D6CFF;color:#fff;border:none;border-radius:9px;padding:9px 14px;font:600 13px system-ui;cursor:pointer;white-space:nowrap}' +
    '.shc-btn[disabled]{opacity:.55;cursor:default}' +
    '.shc-btn.ghost{background:#1C2030;border:1px solid #272D3A;color:#E7EAF0}' +
    '.shc-btn.link{background:none;border:none;color:#7FA8FF;padding:6px 0;font-weight:600;cursor:pointer}' +
    '.shc-intro{color:#B9C0CE;margin:2px 0 12px}' +
    '.shc-sec{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#8A93A6;font-weight:700;margin:14px 0 8px}' +
    '.shc-kb{display:block;text-decoration:none;background:#0B0D11;border:1px solid #272D3A;border-radius:10px;padding:10px 12px;margin-bottom:8px;color:#E7EAF0}' +
    '.shc-kb:hover{border-color:#2D6CFF}' +
    '.shc-kb b{display:block;font-size:13px;margin-bottom:3px}' +
    '.shc-kb span{display:block;color:#8A93A6;font-size:12px;line-height:1.45;max-height:3.9em;overflow:hidden}' +
    '.shc-msg{max-width:82%;padding:9px 12px;border-radius:12px;margin-bottom:8px;font-size:13px;white-space:pre-wrap;word-wrap:break-word}' +
    '.shc-msg.them{background:#1C2030;border:1px solid #272D3A;border-bottom-left-radius:4px;align-self:flex-start}' +
    '.shc-msg.me{background:#2D6CFF;color:#fff;border-bottom-right-radius:4px;align-self:flex-end;margin-left:auto}' +
    '.shc-thread{display:flex;flex-direction:column}' +
    '.shc-note{color:#8A93A6;font-size:12px;text-align:center;margin:6px 0}' +
    '.shc-typing{color:#8A93A6;font-size:12px;font-style:italic;margin:2px 0 8px}' +
    '.shc-err{color:#ff8b8e;font-size:12px;margin:6px 0}' +
    '.shc-ref{color:#8A93A6;font-size:11px;margin-top:4px}';

  function injectStyles() {
    if (document.getElementById('shc-styles')) return;
    var st = document.createElement('style');
    st.id = 'shc-styles';
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
      if (c == null) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  function headers() {
    var h = { 'Content-Type': 'application/json' };
    if (TOKEN) h['x-ingest-token'] = TOKEN;
    return h;
  }

  // ---- Panel scaffolding --------------------------------------------------
  var panel, bodyEl, footEl, statusDot;

  function setStatus(status) {
    if (!statusDot) return;
    // Map the real service status to the dot colour + a human label. Unknown
    // values fall through to the safe 'operational' (green) default so the dot
    // never gets stuck in a scary state on a bad payload.
    var cls = 'shc-dot', label = 'All systems operational';
    if (status === 'down') { cls += ' down'; label = 'Service outage'; }
    else if (status && status !== 'operational') { cls += ' warn'; label = 'Degraded service'; }
    statusDot.className = cls;
    statusDot.setAttribute('title', 'Service status: ' + label);
  }

  // Fetch the real service status when the panel opens. Resilient: on ANY
  // failure (network, non-2xx, bad JSON) we leave the dot at its static
  // 'operational' default so the widget never breaks.
  function refreshStatus() {
    if (!STATUS_URL) return;
    fetch(STATUS_URL, { method: 'GET', headers: headers() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.status) setStatus(d.status); })
      .catch(function () { /* keep the static operational default */ });
  }

  function clearBody() { if (bodyEl) bodyEl.innerHTML = ''; }
  function clearFoot() { if (footEl) footEl.innerHTML = ''; }
  function scrollBottom() { if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight; }

  // ---- L0: self-serve home ------------------------------------------------
  function renderHome() {
    clearBody(); clearFoot();
    var intro = el('div', { class: 'shc-intro' }, ['Search our help articles, or ask a question and we’ll get you an answer.']);
    var searchIn = el('input', { class: 'shc-search', type: 'text', placeholder: 'Search for help…' });
    var searchBtn = el('button', { class: 'shc-btn' }, ['Search']);
    var results = el('div', {}, []);
    var askBtn = el('button', { class: 'shc-btn ghost', style: 'width:100%;margin-top:10px' }, ['Ask a question instead']);
    askBtn.onclick = function () { startChat(searchIn.value || ''); };

    function runSearch() {
      var q = (searchIn.value || '').trim();
      if (!q) { results.innerHTML = ''; return; }
      results.innerHTML = '';
      results.appendChild(el('div', { class: 'shc-typing' }, ['Searching…']));
      var url = KB_URL + '?q=' + encodeURIComponent(q) + '&limit=4';
      fetch(url, { method: 'GET', headers: headers() })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          results.innerHTML = '';
          if (res.d && res.d.status) setStatus(res.d.status);
          var items = (res.ok && res.d && Array.isArray(res.d.results)) ? res.d.results : [];
          if (!items.length) {
            results.appendChild(el('div', { class: 'shc-note' }, ['No articles matched — try asking us directly.']));
            return;
          }
          results.appendChild(el('div', { class: 'shc-sec' }, ['Suggested articles']));
          items.forEach(function (a) {
            var card = el('a', { class: 'shc-kb', href: a.url || '#', target: '_blank', rel: 'noopener' }, [
              el('b', {}, [a.title || a.slug]),
              el('span', {}, [a.body || ''])
            ]);
            results.appendChild(card);
          });
        })
        .catch(function () {
          results.innerHTML = '';
          results.appendChild(el('div', { class: 'shc-err' }, ['Could not reach help search — you can still ask us below.']));
        });
    }

    searchBtn.onclick = runSearch;
    searchIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') runSearch(); });

    bodyEl.appendChild(intro);
    bodyEl.appendChild(el('div', { class: 'shc-row' }, [searchIn, searchBtn]));
    bodyEl.appendChild(results);
    bodyEl.appendChild(askBtn);
    setTimeout(function () { searchIn.focus(); }, 30);
  }

  // ---- L1: chat -----------------------------------------------------------
  var thread; // the messages container

  function addBubble(who, text) {
    var b = el('div', { class: 'shc-msg ' + (who === 'me' ? 'me' : 'them') }, [text]);
    thread.appendChild(b);
    scrollBottom();
    return b;
  }

  function renderChat(seed) {
    clearBody(); clearFoot();
    thread = el('div', { class: 'shc-thread' }, []);
    bodyEl.appendChild(thread);

    var input = el('input', { class: 'shc-in', type: 'text', placeholder: 'Type your message…' });
    if (seed && seed.trim()) input.value = seed.trim();
    var sendBtn = el('button', { class: 'shc-btn' }, ['Send']);
    var humanBtn = el('button', { class: 'shc-btn link' }, ['Talk to a human']);

    function send(text, opts) {
      opts = opts || {};
      var message = (text != null ? text : input.value || '').trim();
      if (!message || busy) return;
      busy = true; sendBtn.disabled = true;
      if (!opts.escalate) addBubble('me', message);
      input.value = '';
      var typing = el('div', { class: 'shc-typing' }, [opts.escalate ? 'Connecting you to a human…' : 'Support is typing…']);
      thread.appendChild(typing); scrollBottom();

      fetch(CHAT_URL, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          conversationId: conversationId,
          message: message,
          email: EMAIL || undefined,
          name: NAME || undefined,
          tenantRef: TENANT_REF || undefined,
          app: APP,
          escalate: opts.escalate === true
        })
      }).then(function (r) {
        return r.json().then(function (d) { return { ok: r.ok, d: d }; });
      }).then(function (res) {
        if (typing.parentNode) typing.parentNode.removeChild(typing);
        busy = false; sendBtn.disabled = false;
        if (!res.ok || !res.d) {
          thread.appendChild(el('div', { class: 'shc-err' }, [(res.d && res.d.error) || 'Something went wrong — please try again.']));
          scrollBottom(); return;
        }
        var d = res.d;
        if (d.conversationId) conversationId = d.conversationId;
        var chunks = Array.isArray(d.chunks) && d.chunks.length ? d.chunks : [d.reply || ''];
        chunks.forEach(function (c) { if (c) addBubble('them', c); });
        if (d.escalated) {
          thread.appendChild(el('div', { class: 'shc-note' }, ['A member of our team has been notified.']));
        }
        if (d.ticketRef) {
          thread.appendChild(el('div', { class: 'shc-ref' }, ['Reference: ' + d.ticketRef]));
        }
        scrollBottom();
      }).catch(function () {
        if (typing.parentNode) typing.parentNode.removeChild(typing);
        busy = false; sendBtn.disabled = false;
        thread.appendChild(el('div', { class: 'shc-err' }, ['Network error — please try again.']));
        scrollBottom();
      });
    }

    sendBtn.onclick = function () { send(null, {}); };
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(null, {}); });
    humanBtn.onclick = function () {
      addBubble('me', 'I’d like to talk to a human, please.');
      send('I’d like to talk to a human, please.', { escalate: true });
    };

    footEl.appendChild(el('div', { class: 'shc-row' }, [input, sendBtn]));
    footEl.appendChild(el('div', { style: 'text-align:center;margin-top:4px' }, [humanBtn]));
    setTimeout(function () { input.focus(); }, 30);
  }

  function startChat(seed) {
    // Carry a question typed on the L0 search straight into the chat input so the
    // customer can review and send it (or edit first).
    renderChat(seed);
    addBubble('them', 'Hi! How can we help today?');
  }

  // ---- Panel open/close ---------------------------------------------------
  function buildPanel() {
    statusDot = el('span', { class: 'shc-dot', title: 'Service status' }, []);
    var closeBtn = el('button', { class: 'shc-x', 'aria-label': 'Close' }, ['×']);
    bodyEl = el('div', { class: 'shc-body' }, []);
    footEl = el('div', { class: 'shc-foot' }, []);
    panel = el('div', { class: 'shc-panel', role: 'dialog', 'aria-label': 'Support chat' }, [
      el('div', { class: 'shc-h' }, [
        el('div', { class: 'shc-hd' }, [statusDot, el('div', {}, [el('b', {}, [APP + ' Support']), el('small', {}, ['We typically reply in a few minutes'])])]),
        closeBtn
      ]),
      bodyEl,
      footEl
    ]);
    closeBtn.onclick = closePanel;
    document.body.appendChild(panel);
  }

  var fab;
  function openPanel() {
    if (panel) return;
    if (fab) fab.style.display = 'none';
    buildPanel();
    renderHome();
    refreshStatus();
  }
  function closePanel() {
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null;
    if (fab) fab.style.display = '';
  }

  function mount() {
    injectStyles();
    fab = el('button', { class: 'shc-fab', type: 'button', 'aria-label': 'Open support chat' }, ['Support']);
    fab.onclick = openPanel;
    document.body.appendChild(fab);
  }

  // Programmatic API (wire to your own "Help" menu item).
  window.SentinelSupportChat = Object.assign({}, cfg, {
    apiBase: API_BASE, token: TOKEN, app: APP,
    open: openPanel, close: closePanel,
    setUser: function (u) { u = u || {}; if (u.email != null) EMAIL = u.email; if (u.name != null) NAME = u.name; if (u.tenantRef !== undefined) TENANT_REF = u.tenantRef; },
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
