#!/usr/bin/env sh
set -eu

/srv/malakhov-ai-digest/infra/vps/bootstrap-foundation.sh
cd /srv/malakhov-ai-digest/supabase-source/docker
docker compose pull
docker compose up -d --wait --wait-timeout 240
/srv/malakhov-ai-digest/infra/vps/preflight.sh
