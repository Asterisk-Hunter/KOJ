#!/usr/bin/env bash
set -Eeuo pipefail
set +x

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl docker.io python3
systemctl enable --now docker

metadata_value() {
  curl -fsS -H 'Metadata-Flavor: Google' \
    "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1"
}

KOJ_WORKER_IMAGE="$(metadata_value KOJ_WORKER_IMAGE)"
KOJ_SANDBOX_IMAGE="$(metadata_value KOJ_SANDBOX_IMAGE)"
KOJ_DATABASE_SECRET="$(metadata_value KOJ_DATABASE_SECRET)"
KOJ_SQL_INSTANCE="$(metadata_value KOJ_SQL_INSTANCE)"
KOJ_ORGANIZATION_ID="$(metadata_value KOJ_ORGANIZATION_ID)"

if [[ ! "$KOJ_WORKER_IMAGE" =~ ^us-central1-docker\.pkg\.dev/.+/koj-research/worker@sha256:[a-f0-9]{64}$ ]]; then
  echo "Worker image must be pinned by Artifact Registry digest" >&2
  exit 1
fi
if [[ ! "$KOJ_SANDBOX_IMAGE" =~ ^us-central1-docker\.pkg\.dev/.+/koj-research/python-sandbox@sha256:[a-f0-9]{64}$ ]]; then
  echo "Sandbox image must be a pinned Artifact Registry digest" >&2
  exit 1
fi
if [[ ! "$KOJ_DATABASE_SECRET" =~ ^[A-Za-z0-9_-]+$ || ! "$KOJ_SQL_INSTANCE" =~ ^[a-z][a-z0-9-]{0,62}:[a-z][a-z0-9-]{0,62}:[a-z][a-z0-9-]{0,62}$ || ! "$KOJ_ORGANIZATION_ID" =~ ^[1-9][0-9]{0,8}$ ]]; then
  echo "Invalid research worker bootstrap metadata" >&2
  exit 1
fi

metadata_token() {
  curl -fsS -H 'Metadata-Flavor: Google' \
    http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])'
}

project_id="$(curl -fsS -H 'Metadata-Flavor: Google' \
  http://metadata.google.internal/computeMetadata/v1/project/project-id)"
read_secret() {
  local token="$1"
  curl -fsS -H "Authorization: Bearer ${token}" \
    "https://secretmanager.googleapis.com/v1/projects/${project_id}/secrets/${KOJ_DATABASE_SECRET}/versions/latest:access" \
    | python3 -c 'import base64,json,sys; sys.stdout.write(base64.b64decode(json.load(sys.stdin)["payload"]["data"]).decode("utf-8"))'
}

install -d -o root -g root -m 0755 /etc/koj
export DOCKER_CONFIG="$(mktemp -d /run/koj-registry-auth.XXXXXX)"
chmod 0700 "$DOCKER_CONFIG"
cleanup_registry_auth() {
  docker logout us-central1-docker.pkg.dev >/dev/null 2>&1 || true
  rm -rf -- "$DOCKER_CONFIG"
}
trap cleanup_registry_auth EXIT
metadata_token | docker login --username oauth2accesstoken --password-stdin us-central1-docker.pkg.dev
docker pull "$KOJ_WORKER_IMAGE"
docker pull "$KOJ_SANDBOX_IMAGE"
docker logout us-central1-docker.pkg.dev >/dev/null 2>&1 || true
rm -rf -- "$DOCKER_CONFIG"
unset DOCKER_CONFIG
trap - EXIT

docker pull gcr.io/cloud-sql-connectors/cloud-sql-proxy:2.25.4

worker_container="$(docker create "$KOJ_WORKER_IMAGE")"
docker cp "$worker_container:/usr/local/share/koj/seccomp-koj.json" /etc/koj/seccomp-koj.json
docker rm "$worker_container" >/dev/null
chmod 0644 /etc/koj/seccomp-koj.json

install -d -o root -g root -m 0777 /cloudsql
docker run -d --name koj-research-sql-proxy --restart unless-stopped --network host \
  --volume /cloudsql:/cloudsql \
  gcr.io/cloud-sql-connectors/cloud-sql-proxy:2.25.4 \
  --private-ip --unix-socket=/cloudsql "$KOJ_SQL_INSTANCE"

for _ in $(seq 1 60); do
  if find /cloudsql -type s -print -quit | grep -q .; then break; fi
  sleep 1
done
if ! find /cloudsql -type s -print -quit | grep -q .; then
  echo "Cloud SQL Auth Proxy did not create its Unix socket" >&2
  exit 1
fi

token="$(metadata_token)"
database_url="$(read_secret "$token")"
unset token
if [[ -z "$database_url" || "$database_url" == *$'\n'* || "$database_url" == *$'\r'* || "$database_url" != *"/cloudsql/${KOJ_SQL_INSTANCE}"* ]]; then
  echo "Research database URL secret is empty, multiline, or not bound to the private socket" >&2
  exit 1
fi

sandbox_ref="$(docker image inspect --format '{{index .RepoDigests 0}}' "$KOJ_SANDBOX_IMAGE")"
docker_gid="$(stat -c '%g' /var/run/docker.sock)"
umask 077
printf 'DATABASE_URL=%s\nDATABASE_TLS_VERIFY=false\nTRAINING_WORKER_ENABLED=true\nTRAINING_ORGANIZATION_ID=%s\nJUDGE_SANDBOX_MODE=docker\nJUDGE_MAX_CONCURRENT=1\nJUDGE_SECCOMP_PROFILE=/etc/koj/seccomp-koj.json\nJUDGE_DOCKER_IMAGE_PYTHON=%s\nJUDGE_DOCKER_CPUS=1.0\nJUDGE_DOCKER_PIDS_LIMIT=64\n' \
  "$database_url" "$KOJ_ORGANIZATION_ID" "$sandbox_ref" >/etc/koj/research-worker.env
unset database_url
chmod 0600 /etc/koj/research-worker.env

docker run -d --name koj-research-worker --restart unless-stopped \
  --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --memory 2g --cpus 2 --pids-limit 256 --user 10001:10001 --group-add "$docker_gid" \
  --volume /var/run/docker.sock:/var/run/docker.sock \
  --volume /tmp:/tmp \
  --volume /cloudsql:/cloudsql \
  --volume /etc/koj/seccomp-koj.json:/etc/koj/seccomp-koj.json:ro \
  --env-file /etc/koj/research-worker.env \
  "$KOJ_WORKER_IMAGE"
