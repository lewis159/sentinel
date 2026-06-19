# NPM Proxy Host — ops.bentech.dev (Sentinel app-only validation)

Cloudflare: `ops.bentech.dev` is **DNS-only (grey cloud)** → NPM serves the Let's
Encrypt cert directly; no Cloudflare origin-SSL mode to set.

## Proxy Host → Details
| Field | Value |
|-------|-------|
| Domain Names | `ops.bentech.dev` |
| Scheme | `http` |
| Forward Hostname / IP | `sentinel-ops-app_app` |
| Forward Port | `3000` |
| Websockets Support | **ON** |
| Block Common Exploits | ON (optional) |
| Cache Assets | off |

## Proxy Host → SSL
| Field | Value |
|-------|-------|
| SSL Certificate | Request a new Let's Encrypt certificate |
| Force SSL | ON |
| HTTP/2 Support | ON |
| HSTS | off until confirmed working, then optional |

## Notes
- **Forward hostname** = `<stack-name>_app`. Deploy the stack as **`sentinel-ops-app`**
  (the service is `app`) → resolves to `sentinel-ops-app_app`. If you name the stack
  differently, set the forward host to `<your-stack-name>_app`.
- NPM and the app share the **`yt-shared`** overlay (same as the YT app), so the
  service name resolves over the internal network — no published ports needed.
- **SSL issues now** (challenge only needs the domain → server + NPM on :80).
- **Expect `502 Bad Gateway`** on the host until the `sentinel-ops-app` stack is
  actually deployed (no upstream yet). The 502 turns into the app once it's up.
- Port `3000` = the Next.js server inside the container (matches the `/api/ping`
  healthcheck).
