/*
 * Sentinel — embeddable SALES / LEAD-CAPTURE form widget.
 *
 * Drop-in for a public product / marketing site (e.g. scribuo.com). Injects a
 * small inline enquiry form and POSTs to Sentinel's public lead-intake API.
 * Self-contained: no dependencies, no framework, scoped styles, single global.
 * Deliberately minimal — a companion to support-chat.js, sharing the same token.
 *
 * Embed:
 *   <div id="sentinel-lead-form"></div>
 *   <script
 *     src="https://ops.scribuo.com/leads-form.js"
 *     data-api-base="https://ops.scribuo.com"
 *     data-token="YOUR_OPS_SUPPORT_TOKEN"
 *     data-source="website"
 *     defer></script>
 *
 * Config can also be set before the script loads:
 *   window.SentinelLeadForm = { apiBase, token, source, mountId };
 *
 * The token is OPS_SUPPORT_TOKEN — the dedicated LEAST-PRIVILEGE browser token,
 * shared with the support widget. It only permits opening an enquiry, and the
 * whole surface is inert unless HERMES_LEADS_ENABLED is on server-side.
 */
(function () {
  var script = document.currentScript || (function () {
    var s = document.getElementsByTagName('script');
    return s[s.length - 1];
  })();
  var cfg = window.SentinelLeadForm || {};
  var apiBase = cfg.apiBase || (script && script.getAttribute('data-api-base')) || '';
  var token = cfg.token || (script && script.getAttribute('data-token')) || '';
  var source = cfg.source || (script && script.getAttribute('data-source')) || 'website';
  var mountId = cfg.mountId || (script && script.getAttribute('data-mount')) || 'sentinel-lead-form';

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text) e.textContent = text;
    return e;
  }

  function mount() {
    var host = document.getElementById(mountId);
    if (!host) return;

    var form = el('form', { class: 'sentinel-lead' });
    var status = el('div', { class: 'sentinel-lead-status', 'aria-live': 'polite' });

    var fields = [
      { name: 'name', placeholder: 'Your name', type: 'text' },
      { name: 'email', placeholder: 'Work email', type: 'email' },
      { name: 'company', placeholder: 'Company', type: 'text' },
    ];
    var inputs = {};
    fields.forEach(function (f) {
      var i = el('input', { type: f.type, name: f.name, placeholder: f.placeholder });
      inputs[f.name] = i;
      form.appendChild(i);
    });
    var message = el('textarea', { name: 'message', placeholder: 'How can we help? (pricing, a demo, enterprise…)', rows: '3', required: 'required' });
    form.appendChild(message);

    var submit = el('button', { type: 'submit' }, 'Send enquiry');
    form.appendChild(submit);
    form.appendChild(status);
    host.appendChild(form);

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var msg = (message.value || '').trim();
      if (!msg) { status.textContent = 'Please add a short message.'; return; }
      submit.disabled = true;
      status.textContent = 'Sending…';

      fetch((apiBase || '') + '/api/public/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ingest-token': token },
        body: JSON.stringify({
          name: (inputs.name.value || '').trim() || undefined,
          email: (inputs.email.value || '').trim() || undefined,
          company: (inputs.company.value || '').trim() || undefined,
          message: msg,
          source: source,
        }),
      })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { ok: r.ok, b: b }; }); })
        .then(function (res) {
          if (res.ok && res.b && res.b.ok) {
            form.reset();
            status.textContent = 'Thanks — we’ll be in touch shortly.';
          } else {
            status.textContent = (res.b && res.b.error) ? res.b.error : 'Sorry, that didn’t go through. Please try again.';
          }
        })
        .catch(function () { status.textContent = 'Network error — please try again.'; })
        .then(function () { submit.disabled = false; });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
