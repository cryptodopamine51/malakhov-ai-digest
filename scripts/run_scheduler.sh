#!/usr/bin/env bash
set -euo pipefail

exec python -m app.jobs.scheduler_runner
