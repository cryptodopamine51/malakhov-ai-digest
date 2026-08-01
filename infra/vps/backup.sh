#!/usr/bin/env sh
set -eu

# Local helper only. Iteration 3 must add encryption, offsite transfer,
# retention, alerting, and a restore drill before it is called a backup system.
root=/srv/malakhov-ai-digest
compose="$root/supabase-source/docker"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$root/backups/postgres-${stamp}.sql.gz"
umask 077
mkdir -p "$root/backups"
(cd "$compose" && docker compose exec -T db pg_dump -U postgres -d postgres --clean --if-exists) | gzip -9 > "$target"
sha256sum "$target" > "${target}.sha256"
chmod 600 "$target" "${target}.sha256"
printf '%s\n' "$target"
