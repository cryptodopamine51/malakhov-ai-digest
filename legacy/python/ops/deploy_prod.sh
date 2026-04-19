#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/opt/malakhov-ai-digest"
APP_DIR="$ROOT_DIR/app"
COMPOSE_FILE="$APP_DIR/deploy/compose.production.yml"
ENV_FILE="$ROOT_DIR/env/.env.production"

cd "$APP_DIR"
git fetch --all --prune
git checkout deploy/render-bootstrap
git pull --ff-only origin deploy/render-bootstrap
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d
