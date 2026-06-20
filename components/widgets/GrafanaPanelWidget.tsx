'use client';

import { useState } from 'react';

// Embeds a single Grafana panel via <iframe>. The panel URL is configurable:
// pass a `src` prop, or set NEXT_PUBLIC_GRAFANA_PANEL_URL (read at build time)
// as the default. With no URL configured it renders a "set a Grafana panel URL"
// state instead of a broken iframe — so it's safe to add from the tray before
// the embed is wired up.
//
// IMPORTANT (deploy): for the iframe to actually render, Grafana must be started
// with `allow_embedding = true` (security section / GF_SECURITY_ALLOW_EMBEDDING=true)
// AND the panel must be reachable without an interactive login — either enable
// anonymous access (auth.anonymous) or use a panel URL carrying a token / a
// public dashboard "share → embed" link. Grafana is reachable at
// https://grafana.bentech.dev (and internally http://yt-monitoring_grafana:3000,
// but a browser <iframe> needs a browser-reachable URL → use the public host).
// Tip: append `&kiosk` to the share URL for a chromeless panel embed.

const ENV_URL = (process.env.NEXT_PUBLIC_GRAFANA_PANEL_URL || '').trim();

export function GrafanaPanelWidget({ src }: { src?: string } = {}) {
  const url = (src || ENV_URL).trim();
  const [errored, setErrored] = useState(false);

  if (!url) {
    return (
      <div className="mon-grafana-empty">
        <div className="mon-metric-l">Grafana panel</div>
        <p className="mon-note">
          Set a Grafana panel URL to embed it here — pass a <code>src</code> prop or set{' '}
          <code>NEXT_PUBLIC_GRAFANA_PANEL_URL</code>. Use Grafana&apos;s panel “Share → Embed” link
          (add <code>&amp;kiosk</code> for a chromeless view). Requires{' '}
          <code>allow_embedding=true</code> plus anonymous access or a token.
        </p>
      </div>
    );
  }

  if (errored) {
    return (
      <div className="mon-grafana-empty">
        <div className="mon-state">Grafana embed blocked</div>
        <p className="mon-note">
          The iframe failed to load. Confirm <code>allow_embedding=true</code> and that the panel is
          reachable without an interactive login (anonymous access or a token).
        </p>
      </div>
    );
  }

  return (
    <div className="mon-grafana">
      <iframe
        className="mon-grafana-frame"
        src={url}
        title="Grafana panel"
        loading="lazy"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-popups"
        onError={() => setErrored(true)}
      />
    </div>
  );
}
