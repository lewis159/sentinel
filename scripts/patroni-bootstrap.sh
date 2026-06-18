#!/usr/bin/env bash
# Idempotent Patroni bootstrap: create the app role + database, apply the ops
# schema (incl. ops.jobs), and grant the app role. Run against the local
# Patroni cluster after it's up:  bash scripts/patroni-bootstrap.sh
set -uo pipefail
cd "$(dirname "$0")/.."

# Find the current leader (the node NOT in recovery).
LEADER=""
for c in sentinel-patroni-1 sentinel-patroni-2; do
  rec=$(docker exec "$c" psql -U postgres -tAc "select pg_is_in_recovery()" 2>/dev/null | tr -d '[:space:]')
  if [ "$rec" = "f" ]; then LEADER="$c"; break; fi
done
[ -z "$LEADER" ] && { echo "no leader found"; exit 1; }
echo "leader: $LEADER"

docker exec "$LEADER" psql -U postgres -c "create role sentinel login password 'sentinel'" 2>/dev/null || echo "role exists"
docker exec "$LEADER" psql -U postgres -c "create database sentinel owner sentinel" 2>/dev/null || echo "db exists"
docker exec -i "$LEADER" psql -U postgres -d sentinel -q < db/init/01_schema.sql
docker exec "$LEADER" psql -U postgres -d sentinel -c "
grant usage on schema ops to sentinel;
grant all on all tables in schema ops to sentinel;
grant all on all sequences in schema ops to sentinel;
alter default privileges in schema ops grant all on tables to sentinel;
alter default privileges in schema ops grant all on sequences to sentinel;
grant all on schema public to sentinel;
grant all on all tables in schema public to sentinel;
grant all on all sequences in schema public to sentinel;" >/dev/null
echo "bootstrap done — ops tables:"
docker exec "$LEADER" psql -U postgres -d sentinel -tAc "select string_agg(table_name,', ') from information_schema.tables where table_schema='ops';"
