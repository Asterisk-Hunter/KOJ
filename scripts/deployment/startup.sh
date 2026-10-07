#!/usr/bin/env bash
set -Eeuo pipefail
set +x

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl git docker.io python3 python3-venv
systemctl enable --now docker

metadata_value() {
  curl -fsS -H 'Metadata-Flavor: Google' \
    "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1" 2>/dev/null || true
}
KOJ_GIT_SHA="${KOJ_GIT_SHA:-$(metadata_value KOJ_GIT_SHA)}"
KOJ_SOURCE_BUCKET="${KOJ_SOURCE_BUCKET:-$(metadata_value KOJ_SOURCE_BUCKET)}"
KOJ_SOURCE_SHA256="${KOJ_SOURCE_SHA256:-$(metadata_value KOJ_SOURCE_SHA256)}"
KOJ_SANDBOX_IMAGE="${KOJ_SANDBOX_IMAGE:-$(metadata_value KOJ_SANDBOX_IMAGE)}"
KOJ_API_DB_SECRET="${KOJ_API_DB_SECRET:-$(metadata_value KOJ_API_DB_SECRET)}"
KOJ_WORKER_DB_SECRET="${KOJ_WORKER_DB_SECRET:-$(metadata_value KOJ_WORKER_DB_SECRET)}"
KOJ_INTERNAL_SECRET_NAME="${KOJ_INTERNAL_SECRET_NAME:-$(metadata_value KOJ_INTERNAL_SECRET_NAME)}"
required=(KOJ_GIT_SHA KOJ_SOURCE_BUCKET KOJ_SOURCE_SHA256 KOJ_SANDBOX_IMAGE KOJ_API_DB_SECRET KOJ_WORKER_DB_SECRET KOJ_INTERNAL_SECRET_NAME)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required instance metadata: ${name}" >&2
    exit 1
  fi
done
if [[ ! "${KOJ_GIT_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "KOJ_GIT_SHA must be a full 40-character commit SHA" >&2
  exit 1
fi
if [[ "$KOJ_SOURCE_BUCKET" != "koj-source-285568391757" || ! "$KOJ_SOURCE_SHA256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "Invalid pinned KOJ source archive configuration" >&2
  exit 1
fi
if [[ ! "${KOJ_SANDBOX_IMAGE}" =~ ^asia-southeast1-docker\.pkg\.dev/project-8c50e5eb-7ddd-4a46-9c8/koj/judge@sha256:[0-9a-f]{64}$ ]]; then
  echo "KOJ_SANDBOX_IMAGE must be an immutable digest in the KOJ judge Artifact Registry repository" >&2
  exit 1
fi

install -d -o root -g root -m 0755 /etc/koj /opt/koj /var/lib/koj
if ! getent group docker >/dev/null; then
  echo "Docker group is missing" >&2
  exit 1
fi
if ! id koj >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/koj --shell /usr/sbin/nologin koj
fi
usermod -aG docker koj
install -d -o koj -g koj -m 0750 /var/lib/koj /tmp/koj
install -o koj -g koj -m 0660 /dev/null /var/lib/koj/execution.lock
cat >/etc/docker/daemon.json <<'JSON'
{
  "live-restore": true,
  "log-driver": "local",
  "log-opts": {"max-size": "10m", "max-file": "3"}
}
JSON
chown root:root /etc/docker/daemon.json
chmod 0644 /etc/docker/daemon.json
systemctl restart docker

access_token="$(curl -fsS -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')"
source_archive="$(mktemp /run/koj-source.XXXXXX.tar.gz)"
source_stage="$(mktemp -d /opt/koj/.source.XXXXXX)"
trap '[[ -z "${source_archive:-}" ]] || rm -f -- "$source_archive"; [[ -z "${source_stage:-}" ]] || rm -rf -- "$source_stage"' EXIT
curl -fsS -H "Authorization: Bearer ${access_token}" \
  "https://storage.googleapis.com/${KOJ_SOURCE_BUCKET}/${KOJ_GIT_SHA}.tar.gz" -o "$source_archive"
unset access_token
printf '%s  %s\n' "$KOJ_SOURCE_SHA256" "$source_archive" | sha256sum --check --status
tar --extract --gzip --file "$source_archive" --directory "$source_stage" --no-same-owner --no-same-permissions
rm -f -- "$source_archive"
release_path="/opt/koj/releases/$KOJ_GIT_SHA"
install -d -o root -g root -m 0755 /opt/koj/releases
if [[ -e "$release_path" ]]; then
  if [[ ! -d "$release_path" || -L "$release_path" ]]; then
    echo "KOJ source release path is not a directory: ${release_path}" >&2
    exit 1
  fi
  chown root:root "$release_path"
  chmod 0755 "$release_path"
  rm -rf -- "$source_stage"
  source_stage=""
else
  chown -R root:root "$source_stage"
  chmod -R go-w "$source_stage"
  chmod 0755 "$source_stage"
  mv -- "$source_stage" "$release_path"
  source_stage=""
fi
python3 -m venv /opt/koj/venv
/opt/koj/venv/bin/pip install --no-cache-dir -r "$release_path/api/requirements.txt"
install -o root -g root -m 0644 "$release_path/api/seccomp-koj.json" /etc/koj/seccomp-koj.json

for secret_name in "$KOJ_API_DB_SECRET" "$KOJ_WORKER_DB_SECRET" "$KOJ_INTERNAL_SECRET_NAME"; do
  if [[ ! "$secret_name" =~ ^[A-Za-z0-9_-]+$ ]]; then
    echo "Secret names must contain only letters, numbers, underscores, and hyphens" >&2
    exit 1
  fi
done
project_id="$(curl -fsS -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/project/project-id)"
access_token="$(curl -fsS -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')"
artifact_registry="asia-southeast1-docker.pkg.dev"
export DOCKER_CONFIG="$(mktemp -d /run/koj-docker-auth.XXXXXX)"
chmod 0700 "$DOCKER_CONFIG"
cleanup_registry_auth() {
  docker logout "$artifact_registry" >/dev/null 2>&1 || true
  rm -rf -- "$DOCKER_CONFIG"
}
trap cleanup_registry_auth EXIT
printf '%s' "$access_token" | docker login --username oauth2accesstoken --password-stdin "$artifact_registry"
docker pull "$KOJ_SANDBOX_IMAGE"
docker logout "$artifact_registry"
rm -rf -- "$DOCKER_CONFIG"
unset DOCKER_CONFIG
trap - EXIT
access_token="$(curl -fsS -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')"
read_secret() {
  local secret_name="$1"
  curl -fsS -H "Authorization: Bearer ${access_token}" \
    "https://secretmanager.googleapis.com/v1/projects/${project_id}/secrets/${secret_name}/versions/latest:access" \
    | python3 -c 'import base64,json,sys; sys.stdout.write(base64.b64decode(json.load(sys.stdin)["payload"]["data"]).decode("utf-8"))'
}
api_db="$(read_secret "$KOJ_API_DB_SECRET")"
worker_db="$(read_secret "$KOJ_WORKER_DB_SECRET")"
judge_secret="$(read_secret "$KOJ_INTERNAL_SECRET_NAME")"
unset access_token
for value in "$api_db" "$worker_db" "$judge_secret"; do
  if [[ -z "$value" || "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
    echo "Secret Manager returned an empty or multiline secret" >&2
    exit 1
  fi
done
internal_ip="$(curl -fsS -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/ip)"
umask 077
printf 'DATABASE_URL=%s\nDATABASE_TLS_VERIFY=true\nJUDGE_SANDBOX_MODE=docker\nJUDGE_HTTP_EXECUTION_ENABLED=true\nJUDGE_MAX_CONCURRENT=1\nJUDGE_HOST_EXECUTION_LOCK=/var/lib/koj/execution.lock\nJUDGE_DOCKER_CPUS=1.0\nJUDGE_DOCKER_PIDS_LIMIT=64\nJUDGE_SECCOMP_PROFILE=/etc/koj/seccomp-koj.json\nFASTAPI_HOST=%s\nFASTAPI_PORT=8000\nJUDGE_INTERNAL_SECRET=%s\nJUDGE_DOCKER_IMAGE_PYTHON=%s\nJUDGE_DOCKER_IMAGE_GCC=%s\nJUDGE_DOCKER_IMAGE_JAVA=%s\nJUDGE_DOCKER_IMAGE_GO=%s\nJUDGE_DOCKER_IMAGE_RUST=%s\nJUDGE_DOCKER_IMAGE_NODE=%s\n' \
  "$api_db" "$internal_ip" "$judge_secret" "$KOJ_SANDBOX_IMAGE" "$KOJ_SANDBOX_IMAGE" "$KOJ_SANDBOX_IMAGE" "$KOJ_SANDBOX_IMAGE" "$KOJ_SANDBOX_IMAGE" "$KOJ_SANDBOX_IMAGE" >/etc/koj/api.env
printf 'DATABASE_URL=%s\nDATABASE_TLS_VERIFY=true\nJUDGE_SANDBOX_MODE=docker\nJUDGE_HOST_EXECUTION_LOCK=/var/lib/koj/execution.lock\nJUDGE_DOCKER_CPUS=1.0\nJUDGE_DOCKER_PIDS_LIMIT=64\nJUDGE_SECCOMP_PROFILE=/etc/koj/seccomp-koj.json\nJUDGE_DOCKER_IMAGE_PYTHON=%s\nJUDGE_DOCKER_IMAGE_GCC=%s\nJUDGE_DOCKER_IMAGE_JAVA=%s\nJUDGE_DOCKER_IMAGE_GO=%s\nJUDGE_DOCKER_IMAGE_RUST=%s\nJUDGE_DOCKER_IMAGE_NODE=%s\n' \
  "$worker_db" "$KOJ_SANDBOX_IMAGE" "$KOJ_SANDBOX_IMAGE" "$KOJ_SANDBOX_IMAGE" "$KOJ_SANDBOX_IMAGE" "$KOJ_SANDBOX_IMAGE" "$KOJ_SANDBOX_IMAGE" >/etc/koj/worker.env
chown root:root /etc/koj/api.env /etc/koj/worker.env
chmod 0600 /etc/koj/api.env /etc/koj/worker.env
unset api_db worker_db judge_secret

install -o root -g root -m 0644 "$release_path/scripts/deployment/koj-api.service" /etc/systemd/system/koj-api.service
install -o root -g root -m 0644 "$release_path/scripts/deployment/koj-worker.service" /etc/systemd/system/koj-worker.service
source_link="/opt/koj/.source-link.$$"
ln -s "releases/$KOJ_GIT_SHA" "$source_link"
if [[ -e /opt/koj/source || -L /opt/koj/source ]]; then
  for service in koj-api.service koj-worker.service; do
    if systemctl is-active --quiet "$service"; then
      systemctl stop "$service"
    fi
  done
  if [[ -d /opt/koj/source && ! -L /opt/koj/source ]]; then
    old_revision="$(cat /opt/koj/source-revision 2>/dev/null || true)"
    if [[ "$old_revision" =~ ^[0-9a-f]{40}$ ]]; then
      legacy_suffix="$old_revision"
    else
      legacy_suffix="$(date -u +%Y%m%dT%H%M%SZ)"
    fi
    legacy_source="/opt/koj/source.legacy.${legacy_suffix}"
    if [[ -e "$legacy_source" || -L "$legacy_source" ]]; then
      legacy_source="${legacy_source}.$(date -u +%Y%m%dT%H%M%SZ).$$"
    fi
    mv -- /opt/koj/source "$legacy_source"
  fi
fi
mv -Tf "$source_link" /opt/koj/source
revision_file="/opt/koj/.source-revision.$$"
printf '%s\n' "$KOJ_GIT_SHA" >"$revision_file"
mv -f -- "$revision_file" /opt/koj/source-revision
systemctl daemon-reload
systemctl enable koj-api.service koj-worker.service
systemctl restart koj-api.service koj-worker.service
docker info --format '{{.CgroupVersion}} {{.Driver}}'
echo "KOJ judge host provisioned at ${KOJ_GIT_SHA}; run scripts/deployment/verify-docker-host.py before enabling public judging."
