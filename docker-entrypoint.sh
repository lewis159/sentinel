#!/bin/sh
# =============================================================================
# Sentinel runtime entrypoint shim (POSIX sh / Alpine)
# -----------------------------------------------------------------------------
# Docker/Swarm secrets are mounted as files at /run/secrets/<name>, but app
# SDKs (e.g. Clerk reading CLERK_SECRET_KEY / CLERK_ENCRYPTION_KEY, pg reading
# DATABASE_URL) expect ENVIRONMENT variables. This shim bridges that gap: it
# reads secret files into env vars BEFORE the app starts, then execs the
# container CMD as PID 1's child.
#
# It never prints secret values. Two sources are supported per variable:
#   1. Explicit pointer:  <VAR>_FILE=/path  -> read that path into <VAR>
#   2. Convention:        /run/secrets/<known_name> if <VAR> is still empty
# An already-set <VAR> always wins (e.g. local dev / plain-env stacks).
# =============================================================================
set -e

# Read a file into an env var, but only if the var is currently empty.
# Args: <VAR_NAME> <FILE_PATH>
load_secret() {
  var_name="$1"
  file_path="$2"
  eval "current=\${$var_name:-}"
  if [ -z "$current" ] && [ -f "$file_path" ] && [ -r "$file_path" ]; then
    value="$(cat "$file_path")"
    export "$var_name=$value"
  fi
}

# 1) Honour explicit *_FILE pointers first.
[ -n "${CLERK_SECRET_KEY_FILE:-}" ]     && load_secret CLERK_SECRET_KEY     "$CLERK_SECRET_KEY_FILE"
[ -n "${CLERK_ENCRYPTION_KEY_FILE:-}" ] && load_secret CLERK_ENCRYPTION_KEY "$CLERK_ENCRYPTION_KEY_FILE"
[ -n "${DATABASE_URL_FILE:-}" ]         && load_secret DATABASE_URL         "$DATABASE_URL_FILE"
[ -n "${OPS_INGEST_SECRET_FILE:-}" ]    && load_secret OPS_INGEST_SECRET    "$OPS_INGEST_SECRET_FILE"
[ -n "${OPS_REPORT_TOKEN_FILE:-}" ]     && load_secret OPS_REPORT_TOKEN     "$OPS_REPORT_TOKEN_FILE"
[ -n "${INFISICAL_CLIENT_SECRET_FILE:-}" ] && load_secret INFISICAL_CLIENT_SECRET "$INFISICAL_CLIENT_SECRET_FILE"

# 2) Fall back to conventional secret mount paths.
load_secret CLERK_SECRET_KEY     /run/secrets/clerk_secret_key
load_secret CLERK_ENCRYPTION_KEY /run/secrets/clerk_encryption_key
load_secret DATABASE_URL         /run/secrets/sentinel_database_url
load_secret OPS_INGEST_SECRET    /run/secrets/ops_ingest_secret
load_secret OPS_REPORT_TOKEN     /run/secrets/ops_report_token
# Infisical Universal Auth client secret (Sentinel reads OPENROUTER_API_KEY etc.
# from Infisical at runtime; only the client secret is a Docker secret — the
# client id / project id / site url are non-secret env). Hermes stays dormant if
# unset.
load_secret INFISICAL_CLIENT_SECRET /run/secrets/infisical_client_secret

# Hand off to the container CMD (e.g. node server.js) as PID 1's child.
exec "$@"
