#!/usr/bin/env bash
set -euo pipefail

alembic upgrade head
exec uvicorn app.api.main:app --host 0.0.0.0 --port 8000
