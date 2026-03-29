#!/usr/bin/env bash
set -euo pipefail

docker compose --env-file /opt/malakhov-ai-digest/env/.env.production -f /opt/malakhov-ai-digest/app/deploy/compose.production.yml ps
