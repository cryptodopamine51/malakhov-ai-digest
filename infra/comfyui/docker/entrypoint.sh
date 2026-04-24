#!/usr/bin/env bash
set -euo pipefail

mkdir -p \
  /opt/ComfyUI/models/checkpoints \
  /opt/ComfyUI/models/loras \
  /opt/ComfyUI/models/controlnet \
  /opt/ComfyUI/models/vae \
  /opt/ComfyUI/models/upscale_models \
  /opt/ComfyUI/input \
  /opt/ComfyUI/output \
  /opt/ComfyUI/user/default/workflows

if [[ -d /srv/bootstrap/workflows ]]; then
  cp -an /srv/bootstrap/workflows/. /opt/ComfyUI/user/default/workflows/ || true
fi

exec python3 /opt/ComfyUI/main.py ${COMFYUI_ARGS:-"--listen 0.0.0.0 --port 8188 --disable-api-nodes"}
