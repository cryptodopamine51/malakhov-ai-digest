#!/usr/bin/env sh
# Emergency rotation for the pinned legacy self-hosted Supabase JWT triple.
# Secret values are kept in root-only files/environment and are never printed.
set -eu

ROOT=${ROOT:-/srv/malakhov-ai-digest}
COMPOSE=${COMPOSE:-$ROOT/supabase-source/docker}
ENV_FILE=$COMPOSE/.env
LOCK_FILE=$ROOT/.jwt-rotation.lock
EVIDENCE_DIR=$ROOT/evidence
RUN_STAMP=$(date -u +%Y%m%dT%H%M%SZ)
LOG_FILE=$EVIDENCE_DIR/jwt-rotation-$RUN_STAMP.log
ROLLBACK_ENV=/run/malakhov-jwt-rollback.$$.env
OLD_KEYS=/run/malakhov-jwt-old-keys.$$.env
ROTATED=false

test "$(id -u)" = 0
test -r "$ENV_FILE"
command -v python3 >/dev/null
command -v flock >/dev/null

umask 077
install -d -m 700 "$EVIDENCE_DIR"
touch "$LOG_FILE"
chmod 600 "$LOG_FILE"
# Detach all long-running Compose/build output from the SSH channel. The log is
# intentionally status-only; none of the commands below print secret values.
exec >>"$LOG_FILE" 2>&1
printf 'jwt_rotation_started=%s\n' "$RUN_STAMP"
exec 9>"$LOCK_FILE"
flock -n 9 || {
  printf '%s\n' 'jwt_rotation=blocked reason=lock_held' >&2
  exit 75
}

cp "$ENV_FILE" "$ROLLBACK_ENV"
chmod 600 "$ROLLBACK_ENV"

redeploy_app_consumers() {
  if test -x "$ROOT/app-staging/infra/vps/deploy-staging.sh"; then
    "$ROOT/app-staging/infra/vps/deploy-staging.sh" >/dev/null
  fi
  if test -L "$ROOT/app-current"; then
    current_release=$(readlink -f "$ROOT/app-current")
    RELEASE="$current_release" RELEASE_ID=$(basename "$current_release") \
      "$current_release/infra/vps/deploy-production.sh" >/dev/null
  fi
}

restore_previous_runtime() {
  test "$ROTATED" = true || return 0
  cp "$ROLLBACK_ENV" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  (
    cd "$COMPOSE"
    docker compose up -d --no-deps --force-recreate \
      auth rest realtime storage functions kong studio supavisor db >/dev/null
    docker compose exec -T db sh -c \
      'psql -q -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < /docker-entrypoint-initdb.d/init-scripts/99-jwt.sql' \
      >/dev/null
  )
  redeploy_app_consumers
  printf '%s\n' 'jwt_rotation=rolled_back'
}

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if test "$status" -ne 0; then restore_previous_runtime || true; fi
  rm -f "$ROLLBACK_ENV" "$OLD_KEYS"
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

python3 - "$ENV_FILE" "$OLD_KEYS" <<'PY'
import base64
import hashlib
import hmac
import json
import os
import secrets
import stat
import sys
import time

env_path, old_keys_path = sys.argv[1:]
with open(env_path, encoding="utf-8") as handle:
    lines = handle.read().splitlines()

values = {}
for line in lines:
    if "=" not in line or line.lstrip().startswith("#"):
        continue
    key, value = line.split("=", 1)
    values[key] = value

required = ("JWT_SECRET", "ANON_KEY", "SERVICE_ROLE_KEY")
if any(not values.get(key) for key in required):
    raise SystemExit("legacy JWT triple is incomplete")

with open(old_keys_path, "w", encoding="utf-8") as handle:
    for key in required:
        handle.write(f"{key}={values[key]}\n")
os.chmod(old_keys_path, stat.S_IRUSR | stat.S_IWUSR)

def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")

secret = secrets.token_urlsafe(48)
issued_at = int(time.time())
expires_at = issued_at + 5 * 365 * 24 * 60 * 60
header = b64url(b'{"alg":"HS256","typ":"JWT"}')

def token(role: str) -> str:
    payload = json.dumps(
        {"role": role, "iss": "supabase", "iat": issued_at, "exp": expires_at},
        separators=(",", ":"),
    ).encode("utf-8")
    signed = f"{header}.{b64url(payload)}"
    signature = hmac.new(secret.encode("utf-8"), signed.encode("ascii"), hashlib.sha256).digest()
    return f"{signed}.{b64url(signature)}"

replacements = {
    "JWT_SECRET": secret,
    "ANON_KEY": token("anon"),
    "SERVICE_ROLE_KEY": token("service_role"),
}
seen = set()
updated = []
for line in lines:
    if "=" in line:
        key = line.split("=", 1)[0]
        if key in replacements:
            updated.append(f"{key}={replacements[key]}")
            seen.add(key)
            continue
    updated.append(line)
for key in required:
    if key not in seen:
        updated.append(f"{key}={replacements[key]}")

temp_path = f"{env_path}.rotate.{os.getpid()}"
with open(temp_path, "w", encoding="utf-8") as handle:
    handle.write("\n".join(updated) + "\n")
os.chmod(temp_path, stat.S_IRUSR | stat.S_IWUSR)
os.replace(temp_path, env_path)
PY
ROTATED=true

(
  cd "$COMPOSE"
  docker compose config >/dev/null
  docker compose up -d --no-deps --force-recreate \
    auth rest realtime storage functions kong studio supavisor db
  docker compose exec -T db sh -c \
    'psql -q -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < /docker-entrypoint-initdb.d/init-scripts/99-jwt.sql' \
    >/dev/null
  docker compose up -d --wait --wait-timeout 240
)

redeploy_app_consumers
"$ROOT/app-staging/infra/vps/verify-api-roles.sh" >/dev/null

set -a
# shellcheck disable=SC1090
. "$OLD_KEYS"
set +a
export OLD_ANON_KEY="$ANON_KEY" OLD_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
unset JWT_SECRET ANON_KEY SERVICE_ROLE_KEY

docker run --rm -i --network supabase_default \
  -e OLD_ANON_KEY -e OLD_SERVICE_ROLE_KEY \
  node:22.16.0-bookworm-slim node - <<'NODE'
const root = 'http://kong:8000/rest/v1/articles?select=id&limit=1'
for (const [label, key] of [
  ['old_anon', process.env.OLD_ANON_KEY],
  ['old_service', process.env.OLD_SERVICE_ROLE_KEY],
]) {
  if (!key) throw new Error(`${label} key missing`)
  const response = await fetch(root, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  })
  if (![401, 403].includes(response.status)) {
    throw new Error(`${label} unexpectedly accepted: ${response.status}`)
  }
  console.log(`${label}_rejected=${response.status}`)
}
NODE

unset OLD_ANON_KEY OLD_SERVICE_ROLE_KEY
ROTATED=false
printf 'jwt_rotation_finished=%s\n' "$(date -u +%Y%m%dT%H%M%SZ)"
printf '%s\n' 'jwt_rotation=passed old_keys=rejected new_keys=accepted values_logged=false'
