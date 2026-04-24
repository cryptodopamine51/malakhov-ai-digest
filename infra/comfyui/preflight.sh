#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-local}"

run_cmd() {
  local cmd="$1"
  if [[ "$TARGET" == "local" ]]; then
    bash -lc "$cmd"
  else
    ssh -o BatchMode=yes "$TARGET" "$cmd"
  fi
}

mem_kb="$(run_cmd "awk '/MemTotal/ {print \$2}' /proc/meminfo")"
disk_gb="$(run_cmd "df -BG --output=avail / | tail -n 1 | tr -dc '0-9'")"
cpu_count="$(run_cmd "nproc")"
docker_ok="$(run_cmd "command -v docker >/dev/null 2>&1 && echo yes || echo no")"
compose_ok="$(run_cmd "docker compose version >/dev/null 2>&1 && echo yes || echo no")"
gpu_line="$(run_cmd "nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null || true")"
gpu_count="$(printf '%s\n' "$gpu_line" | sed '/^$/d' | wc -l | tr -d ' ')"
nvidia_toolkit_ok="$(run_cmd "dpkg -l | grep -q nvidia-container-toolkit && echo yes || echo no")"
os_name="$(run_cmd ". /etc/os-release && printf '%s %s' \"\$NAME\" \"\$VERSION_ID\"")"

mem_gb=$((mem_kb / 1024 / 1024))

status="PASS"
failures=()

if [[ "$docker_ok" != "yes" ]]; then
  failures+=("docker missing")
fi

if [[ "$compose_ok" != "yes" ]]; then
  failures+=("docker compose missing")
fi

if [[ "$gpu_count" -lt 1 ]]; then
  failures+=("no NVIDIA GPU visible")
fi

if [[ "$nvidia_toolkit_ok" != "yes" ]]; then
  failures+=("nvidia-container-toolkit missing")
fi

if [[ "$mem_gb" -lt 32 ]]; then
  failures+=("RAM ${mem_gb}GiB < 32GiB")
fi

if [[ "$disk_gb" -lt 150 ]]; then
  failures+=("disk ${disk_gb}GiB < 150GiB")
fi

echo "Target: $TARGET"
echo "OS: $os_name"
echo "CPU: ${cpu_count} vCPU"
echo "RAM: ${mem_gb} GiB"
echo "Disk free on /: ${disk_gb} GiB"
echo "Docker: $docker_ok"
echo "Docker Compose: $compose_ok"
echo "nvidia-container-toolkit: $nvidia_toolkit_ok"
echo "Visible GPUs: $gpu_count"
if [[ "$gpu_count" -gt 0 ]]; then
  echo "$gpu_line"
fi

if [[ "${#failures[@]}" -gt 0 ]]; then
  status="FAIL"
fi

echo "Status: $status"
if [[ "${#failures[@]}" -gt 0 ]]; then
  printf 'Reasons:\n'
  printf ' - %s\n' "${failures[@]}"
  exit 1
fi
