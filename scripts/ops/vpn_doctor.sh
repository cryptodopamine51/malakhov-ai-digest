#!/usr/bin/env bash
set -euo pipefail

SERVER_DOMAIN="${SERVER_DOMAIN:-api.malakhovai.ru}"
WS_PATH="${WS_PATH:-/vless-a4c5a3b624212c6bfa26d18ea9e5c458}"
SOCKS_HOST="${SOCKS_HOST:-127.0.0.1}"
SOCKS_PORT="${SOCKS_PORT:-10888}"
SOCKS_USER="${SOCKS_USER:-}"
SOCKS_PASS="${SOCKS_PASS:-}"

header() {
  printf '\n== %s ==\n' "$1"
}

ok() {
  printf '[ok] %s\n' "$1"
}

warn() {
  printf '[warn] %s\n' "$1"
}

fail() {
  printf '[fail] %s\n' "$1"
}

check_tcp() {
  local host="$1"
  local port="$2"
  python3 - "$host" "$port" <<'PY'
import socket, sys
host = sys.argv[1]
port = int(sys.argv[2])
s = socket.socket()
s.settimeout(8)
try:
    s.connect((host, port))
    print("OPEN")
except Exception as exc:
    print(f"FAIL {exc!r}")
finally:
    s.close()
PY
}

header "xray"
if systemctl is-active --quiet xray; then
  ok "xray active"
else
  fail "xray inactive"
fi
systemctl show xray -p ActiveState -p SubState -p Restart -p NRestarts -p ExecMainStartTimestamp

header "mtproto"
if docker ps --filter name=malakhov_mtg --format '{{.Names}} {{.Status}}' | grep -q '^malakhov_mtg '; then
  ok "malakhov_mtg running"
else
  fail "malakhov_mtg not running"
fi
docker inspect malakhov_mtg --format '{{json .HostConfig.RestartPolicy}}' 2>/dev/null || true

header "ports"
for port in 443 2443 8443 9443 10888; do
  result="$(check_tcp "$SERVER_DOMAIN" "$port")"
  if [[ "$result" == OPEN* ]]; then
    ok "$SERVER_DOMAIN:$port reachable"
  else
    fail "$SERVER_DOMAIN:$port $result"
  fi
done

header "listeners"
ss -tulpn | grep -E ':(443|2443|8443|9443|10888|10000)\b' || true

header "ufw"
ufw status numbered | grep -E '443|2443|8443|9443|10888|10000' || true

header "websocket route"
ws_headers="$(curl --http1.1 -skI --max-time 15 "https://${SERVER_DOMAIN}${WS_PATH}" \
  -H 'Connection: Upgrade' \
  -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' || true)"
printf '%s\n' "$ws_headers"
if printf '%s' "$ws_headers" | grep -qE 'HTTP/1\.1 400|HTTP/1\.1 405'; then
  ok "ws route responds"
else
  warn "ws route did not return expected smoke-check status"
fi

header "socks egress"
if [[ -n "$SOCKS_USER" && -n "$SOCKS_PASS" ]]; then
  if ip="$(curl --proxy "socks5h://${SOCKS_USER}:${SOCKS_PASS}@${SOCKS_HOST}:${SOCKS_PORT}" -fsS --max-time 20 https://api.ipify.org 2>/dev/null)"; then
    ok "socks egress ${ip}"
  else
    fail "socks egress failed"
  fi
else
  warn "SOCKS_USER/SOCKS_PASS not set, skipping socks egress check"
fi

header "recent xray log"
tail -n 40 /var/log/xray/error.log 2>/dev/null || true

header "recent access tail"
tail -n 40 /var/log/xray/access.log 2>/dev/null || true
