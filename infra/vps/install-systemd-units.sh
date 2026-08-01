#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=${ROOT:-/srv/malakhov-ai-digest}
CURRENT=$ROOT/app-current

test "$(id -u)" = 0
test -L "$CURRENT"
for unit in malakhov-backup.service malakhov-backup.timer malakhov-monitor.service malakhov-monitor.timer; do
  install -m 644 "$CURRENT/infra/vps/systemd/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable --now malakhov-backup.timer malakhov-monitor.timer
systemctl start malakhov-monitor.service
printf '%s\n' 'systemd_units=installed backup_timer=enabled monitor_timer=enabled'
