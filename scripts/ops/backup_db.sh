#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/opt/malakhov-ai-digest"
ENV_FILE="$ROOT_DIR/env/.env.production"
BACKUP_DIR="$ROOT_DIR/backups"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

set -a
. "$ENV_FILE"
set +a

mkdir -p "$BACKUP_DIR"
docker exec malakhov_ai_digest_db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$BACKUP_DIR/postgres_${TIMESTAMP}.dump"
echo "backup_created=$BACKUP_DIR/postgres_${TIMESTAMP}.dump"
