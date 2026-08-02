#!/usr/bin/env sh
set -eu
# apply-migrations.sh — apply pending Sentinel .sql migrations to $DATABASE_URL.
#
# Mirrors the estate migrator (bentech-infra/scripts/apply-migrations.sh) but
# tracks state in ops.schema_migrations (Sentinel lives in its own `ops` schema).
#
# - Only NEW files run (tracked in ops.schema_migrations), ordered by filename.
#   The db/init/*.sql files are zero-padded (01_, 02_, ... 22_) so a lexical sort
#   is a numeric sort.
# - Each migration runs in a SINGLE TRANSACTION (--single-transaction) together
#   with its tracking INSERT: any error rolls the whole file back and aborts
#   (ON_ERROR_STOP=1), so a bad migration can't leave the DB half-changed and
#   can't be recorded as applied.
# - Re-runs are idempotent: already-recorded files are skipped, so only genuinely
#   new files execute.
# - Set BASELINE=1 to mark all current files as applied WITHOUT running them
#   (used once when adopting a DB that already has that schema).
#
# DATABASE_URL is injected by the image entrypoint from the mounted Docker secret
# sentinel_migrator_db_uri. That role MUST be privileged enough to run Sentinel's
# DDL: CREATE SCHEMA ops, CREATE EXTENSION vector (13_hermes_kb.sql — pgvector is
# NOT a trusted extension, so this needs superuser), sequences, RLS toggles, etc.
# A plain app role cannot do this — use the postgres superuser or a dedicated
# migrator role granted ownership/superuser on the ops schema. See
# docs/sentinel-autodeploy.md.

: "${DATABASE_URL:?DATABASE_URL not set}"
MIG_DIR="${MIG_DIR:-/migrations}"
q() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qtA "$@"; }

DB="$(q -c 'SELECT current_database()')"
echo ">> sentinel migration run against db=$DB  (baseline=${BASELINE:-0})"

# The tracking table lives in the ops schema, which 01_schema.sql creates. On a
# fresh DB the schema does not exist yet, so ensure it before the tracking table.
q -c "CREATE SCHEMA IF NOT EXISTS ops;"
q -c "CREATE TABLE IF NOT EXISTS ops.schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());"

any=0
for f in "$MIG_DIR"/*.sql; do
  [ -e "$f" ] || { echo "   (no .sql files in $MIG_DIR)"; break; }
  any=1
  base="$(basename "$f")"
  if [ -n "$(q -c "SELECT 1 FROM ops.schema_migrations WHERE filename='$base'")" ]; then
    echo "=  skip   $base"
    continue
  fi
  if [ "${BASELINE:-0}" = "1" ]; then
    echo "~  baseline $base (recorded, not executed)"
    q -c "INSERT INTO ops.schema_migrations(filename) VALUES('$base')"
    continue
  fi
  echo "+  apply  $base"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
    -f "$f" \
    -c "INSERT INTO ops.schema_migrations(filename) VALUES('$base')"
  echo "   ok     $base"
done
[ "$any" = "1" ] || true
echo ">> sentinel migrations complete on db=$DB"
