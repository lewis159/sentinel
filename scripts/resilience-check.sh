#!/usr/bin/env bash
# Sentinel resilience / self-test runner. Runs destructive + scalability checks
# against the local HA stack and records the result to ops.resilience_runs
# (shown in the website's Resilience section).
#
#   bash scripts/resilience-check.sh [suite]
#   suite = all (default) | db-failover | app-replica | worker | headers | scale
#
# Safe to re-run: containers are restarted after each kill.
set -uo pipefail
SUITE="${1:-all}"
APP_URL="${APP_URL:-http://localhost:3000}"
START=$(date +%s%3N 2>/dev/null || date +%s000)
declare -A R   # check -> pass/fail
declare -A D   # check -> detail

ping_count() { local n="$1" ok=0; for _ in $(seq 1 "$n"); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$APP_URL/api/ping")" = "200" ] && ok=$((ok+1)); sleep "${2:-1}"; done; echo "$ok"; }
leader_ct() { for c in $(docker ps --format '{{.Names}}' | grep -E '^sentinel-patroni-'); do
  [ "$(docker exec "$c" psql -U postgres -tAc 'select pg_is_in_recovery()' 2>/dev/null | tr -d '[:space:]')" = "f" ] && { echo "$c"; return; }; done; }
live_pg() { docker ps --format '{{.Names}}' | grep -m1 -E '^sentinel-patroni-'; }
dbq() { docker exec -e PGPASSWORD=sentinel "$(live_pg)" psql -h haproxy -U sentinel -d sentinel -tAc "$1" 2>/dev/null | tr -d '[:space:]'; }

check_db_failover() {
  echo "## db-failover"; local L; L=$(leader_ct); [ -z "$L" ] && { R[db-failover]=fail; D[db-failover]="no leader"; return; }
  echo "  leader=$L — killing"; docker stop "$L" >/dev/null
  local ok; ok=$(ping_count 12 2)
  local q; q=$(dbq "select 1")    # routed via HAProxy to the promoted leader
  docker start "$L" >/dev/null
  if [ "$ok" -ge 10 ] && [ "$q" = "1" ]; then R[db-failover]=pass; else R[db-failover]=fail; fi
  D[db-failover]="app 200x$ok/12 during outage; post-failover query=$q"
  echo "  ${R[db-failover]} — ${D[db-failover]}"
}
check_app_replica() {
  echo "## app-replica"; local A; A=$(docker ps --format '{{.Names}}' | grep -m1 -E '^sentinel-app-'); [ -z "$A" ] && { R[app-replica]=fail; D[app-replica]="no app"; return; }
  echo "  killing $A"; docker stop "$A" >/dev/null; sleep 3
  local ok; ok=$(ping_count 6 1); docker start "$A" >/dev/null
  [ "$ok" -ge 6 ] && R[app-replica]=pass || R[app-replica]=fail
  D[app-replica]="LB served 200x$ok/6 with one replica down"; echo "  ${R[app-replica]} — ${D[app-replica]}"
}
check_worker() {
  echo "## worker"; local W; W=$(docker ps --format '{{.Names}}' | grep -m1 -E '^sentinel-worker-'); [ -z "$W" ] && { R[worker]=fail; D[worker]="no worker"; return; }
  local before; before=$(dbq "select count(*) from ops.jobs where status='done'"); echo "  killing $W (done=$before)"
  docker stop "$W" >/dev/null; sleep 35; local after; after=$(dbq "select count(*) from ops.jobs where status='done'"); docker start "$W" >/dev/null
  [ "${after:-0}" -gt "${before:-0}" ] && R[worker]=pass || R[worker]=fail
  D[worker]="jobs done ${before}->${after} with one worker down"; echo "  ${R[worker]} — ${D[worker]}"
}
check_headers() {
  echo "## headers (security scanner)"; local n; n=$(dbq "select count(*) from ops.findings where source='headers'")
  [ "${n:-0}" -gt 0 ] && R[headers]=pass || R[headers]=fail
  D[headers]="$n header findings produced by the worker scanner"; echo "  ${R[headers]} — ${D[headers]}"
}
check_scale() {
  echo "## scale (30 rapid requests)"; local ok=0; for _ in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$APP_URL/api/ping")" = "200" ] && ok=$((ok+1)); done
  [ "$ok" -ge 29 ] && R[scale]=pass || R[scale]=fail
  D[scale]="$ok/30 OK across the LB+replicas"; echo "  ${R[scale]} — ${D[scale]}"
}

run() { case "$1" in
  db-failover) check_db_failover;; app-replica) check_app_replica;; worker) check_worker;;
  headers) check_headers;; scale) check_scale;;
  all) check_headers; check_scale; check_app_replica; check_worker; check_db_failover;;
  *) echo "unknown suite: $1"; exit 2;; esac; }

run "$SUITE"

# Assemble results JSON + overall pass, record to ops.resilience_runs.
PASS=true; JSON="{"
for k in "${!R[@]}"; do [ "${R[$k]}" = "fail" ] && PASS=false
  JSON="$JSON\"$k\":{\"passed\":$([ "${R[$k]}" = pass ] && echo true || echo false),\"detail\":\"${D[$k]//\"/}\"},"; done
JSON="${JSON%,}}"
DUR=$(( $(date +%s%3N 2>/dev/null || date +%s000) - START ))
echo ""; echo "=== SUITE '$SUITE' overall: $([ "$PASS" = true ] && echo PASS || echo FAIL) (${DUR}ms) ==="
dbq "insert into ops.resilience_runs (suite,passed,results,duration_ms) values ('$SUITE',$PASS,'$JSON'::jsonb,$DUR)" >/dev/null \
  && echo "recorded to ops.resilience_runs" || echo "warn: could not record result"
[ "$PASS" = true ]
