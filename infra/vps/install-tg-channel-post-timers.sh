#!/usr/bin/env bash
# Install exact Telegram primary timers without starting any delivery service.
set -Eeuo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SYSTEMD_DIR=${SYSTEMD_DIR:-/etc/systemd/system}
LIBEXEC_DIR=${LIBEXEC_DIR:-/usr/local/libexec}
ENV_DIR=${ENV_DIR:-/etc/malakhov-ai-digest}
ENV_FILE=${ENV_FILE:-$ENV_DIR/tg-channel-post.env}
APP_CONTAINER=${APP_CONTAINER:-malakhov-digest-production-app}
TG_CHANNEL_POST_URL=${TG_CHANNEL_POST_URL:-https://news.malakhovai.ru/api/cron/tg-channel-post}

test "$(id -u)" = 0
command -v systemctl >/dev/null
command -v systemd-analyze >/dev/null
command -v docker >/dev/null
command -v curl >/dev/null

install -d -m 755 "$SYSTEMD_DIR" "$LIBEXEC_DIR"
install -d -m 700 "$ENV_DIR"
if test ! -s "$ENV_FILE"; then
  # Read only from the already running app environment and write directly to a
  # root-only file. Neither this command nor its value is printed.
  cron_secret=$(docker inspect "$APP_CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^CRON_SECRET=//p' | sed -n '1p')
  test -n "$cron_secret"
  umask 077
  {
    printf 'TG_CHANNEL_POST_URL=%s\n' "$TG_CHANNEL_POST_URL"
    printf 'TG_CHANNEL_POST_CRON_SECRET=%s\n' "$cron_secret"
  } > "$ENV_FILE"
  unset cron_secret
fi
chmod 600 "$ENV_FILE"
test "$(stat -c '%a' "$ENV_FILE")" = 600
grep -q '^TG_CHANNEL_POST_URL=https://' "$ENV_FILE"
grep -q '^TG_CHANNEL_POST_CRON_SECRET=.' "$ENV_FILE"

install -m 750 "$SCRIPT_DIR/run-tg-channel-post.sh" "$LIBEXEC_DIR/malakhov-tg-channel-post"
install -m 644 "$SCRIPT_DIR/malakhov-tg-channel-post@.service" "$SYSTEMD_DIR/malakhov-tg-channel-post@.service"
for slot in 1 2 3 4 5; do
  install -m 644 "$SCRIPT_DIR/malakhov-tg-channel-post-$slot.timer" "$SYSTEMD_DIR/malakhov-tg-channel-post-$slot.timer"
done

systemd-analyze verify "$SYSTEMD_DIR/malakhov-tg-channel-post@.service" "$SYSTEMD_DIR"/malakhov-tg-channel-post-*.timer
systemctl daemon-reload
systemctl enable --now malakhov-tg-channel-post-{1,2,3,4,5}.timer
systemctl list-timers --all --no-pager 'malakhov-tg-channel-post-*'
