#!/usr/bin/env bash
set -euo pipefail
# run-sentinel-migrations.sh
# Runs the Sentinel migrator image as a one-shot Swarm job ON THE HOST via the
# Portainer Docker API (the DB is network-isolated, so the job must run inside the
# swarm on the ytdb_ytdb network). Polls the job to completion, prints its logs,
# cleans up, and exits non-zero if the migration failed.
#
# Adapted from bentech-infra/scripts/run-migrations.sh. Sentinel-specific:
#   - secret:  sentinel_migrator_db_uri (mounted at the SAME filename, which the
#              image entrypoint reads: /run/secrets/sentinel_migrator_db_uri)
#   - image:   ghcr.io/lewis159/sentinel-migrator:latest (override with MIGRATOR_IMAGE)
#   - network: ytdb_ytdb (same self-hosted Postgres network as the estate)
#
# Requires env: PORTAINER_URL, PORTAINER_TOKEN. Needs: curl, jq.

IMAGE="${MIGRATOR_IMAGE:-ghcr.io/lewis159/sentinel-migrator:latest}"
EP="${ENDPOINT_ID:-3}"
SECRET="sentinel_migrator_db_uri"
SVC="migrate-sentinel"
B="$PORTAINER_URL/api/endpoints/$EP/docker"
auth=(-H "X-API-Key: $PORTAINER_TOKEN")

echo "== run-sentinel-migrations image=$IMAGE =="
SECRET_ID="$(curl -fsS "${auth[@]}" "$B/secrets" | jq -r --arg n "$SECRET" '.[]|select(.Spec.Name==$n)|.ID')"
[ -n "$SECRET_ID" ] && [ "$SECRET_ID" != "null" ] || { echo "ERROR: secret '$SECRET' not found"; exit 1; }
NET_ID="$(curl -fsS "${auth[@]}" "$B/networks" | jq -r '.[]|select(.Name=="ytdb_ytdb")|.Id')"
[ -n "$NET_ID" ] && [ "$NET_ID" != "null" ] || { echo "ERROR: network ytdb_ytdb not found"; exit 1; }

# remove any prior run
curl -fsS "${auth[@]}" -X DELETE "$B/services/$SVC" >/dev/null 2>&1 || true
sleep 2

# Mount the secret at target filename == secret name, because the migrator
# entrypoint reads /run/secrets/sentinel_migrator_db_uri.
BODY="$(jq -n --arg img "$IMAGE" --arg sid "$SECRET_ID" --arg sname "$SECRET" --arg net "$NET_ID" --arg svc "$SVC" '{
  Name:$svc,
  TaskTemplate:{
    ContainerSpec:{ Image:$img, Secrets:[{ File:{Name:$sname,UID:"0",GID:"0",Mode:292}, SecretID:$sid, SecretName:$sname }] },
    Networks:[{Target:$net}],
    RestartPolicy:{Condition:"none",MaxAttempts:0}
  },
  Mode:{ReplicatedJob:{MaxConcurrent:1,TotalCompletions:1}}
}')"
curl -fsS "${auth[@]}" -H 'Content-Type: application/json' -d "$BODY" "$B/services/create" >/dev/null
echo "created job $SVC"

state="pending"
for i in $(seq 1 60); do
  state="$(curl -fsS "${auth[@]}" --get --data-urlencode "filters={\"service\":[\"$SVC\"]}" "$B/tasks" \
            | jq -r 'sort_by(.CreatedAt)|last|.Status.State // "pending"')"
  echo "  [$i] task state: $state"
  case "$state" in complete|failed|rejected|shutdown) break;; esac
  sleep 5
done

echo "=== sentinel migrator logs ==="
curl -fsS "${auth[@]}" "$B/services/$SVC/logs?stdout=1&stderr=1&timestamps=1" | tr -cd '\11\12\15\40-\176' || true
echo ""
curl -fsS "${auth[@]}" -X DELETE "$B/services/$SVC" >/dev/null 2>&1 || true

if [ "$state" = "complete" ]; then echo "SENTINEL MIGRATIONS OK"; else echo "SENTINEL MIGRATIONS FAILED: state=$state"; exit 1; fi
