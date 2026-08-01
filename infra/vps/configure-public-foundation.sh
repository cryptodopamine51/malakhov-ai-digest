#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=${ROOT:-/srv/malakhov-ai-digest}
COMPOSE=${COMPOSE:-$ROOT/supabase-source/docker}
ENV_FILE=$COMPOSE/.env
PUBLIC_URL=${PUBLIC_URL:-https://news.malakhovai.ru}

test "$(id -u)" = 0
test -r "$ENV_FILE"
umask 077

python3 - "$ENV_FILE" "$PUBLIC_URL" <<'PY'
import os
import stat
import sys

path, public_url = sys.argv[1:]
replacements = {
    "SUPABASE_PUBLIC_URL": public_url,
    "API_EXTERNAL_URL": f"{public_url}/auth/v1",
    "SITE_URL": public_url,
}
with open(path, encoding="utf-8") as handle:
    lines = handle.read().splitlines()
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
for key, value in replacements.items():
    if key not in seen:
        updated.append(f"{key}={value}")
temp = f"{path}.public.{os.getpid()}"
with open(temp, "w", encoding="utf-8") as handle:
    handle.write("\n".join(updated) + "\n")
os.chmod(temp, stat.S_IRUSR | stat.S_IWUSR)
os.replace(temp, path)
PY

(
  cd "$COMPOSE"
  docker compose config >/dev/null
  docker compose up -d --no-deps --force-recreate auth storage functions studio >/dev/null
  docker compose up -d --wait --wait-timeout 240 >/dev/null
)
printf 'foundation_public_url=configured hostname=%s values_logged=false\n' "${PUBLIC_URL#https://}"
