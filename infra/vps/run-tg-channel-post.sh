#!/usr/bin/env bash
# Invoke the in-app protected cron route for exactly one channel slot.
# The response body is deliberately discarded: journal records only HTTP success/failure.
set -Eeuo pipefail

slot=${1:?slot 1..5 is required}
case "$slot" in 1|2|3|4|5) ;; *) printf 'tg_channel_post result=invalid_slot\n' >&2; exit 64 ;; esac

: "${TG_CHANNEL_POST_URL:?TG_CHANNEL_POST_URL is required}"
: "${TG_CHANNEL_POST_CRON_SECRET:?TG_CHANNEL_POST_CRON_SECRET is required}"

case "$TG_CHANNEL_POST_URL" in https://*) ;; *) printf 'tg_channel_post result=unsafe_url\n' >&2; exit 64 ;; esac

curl_config=$(mktemp /run/malakhov-tg-channel-post.XXXXXX)
chmod 600 "$curl_config"
cleanup() { rm -f -- "$curl_config"; }
trap cleanup EXIT HUP INT TERM

# Keep Authorization out of argv and journal output. CRON_SECRET is generated as
# a single-line value; reject a malformed value rather than emitting it.
case "$TG_CHANNEL_POST_CRON_SECRET" in *$'\n'*|*$'\r'*) printf 'tg_channel_post result=invalid_secret\n' >&2; exit 64 ;; esac
{
  printf 'url = "%s?slot=%s"\n' "$TG_CHANNEL_POST_URL" "$slot"
  printf 'header = "Authorization: Bearer %s"\n' "$TG_CHANNEL_POST_CRON_SECRET"
  printf '%s\n' 'fail'
  printf '%s\n' 'silent'
  printf '%s\n' 'show-error'
  printf '%s\n' 'connect-timeout = 10'
  printf '%s\n' 'max-time = 75'
  printf '%s\n' 'retry = 2'
  printf '%s\n' 'retry-all-errors'
  printf '%s\n' 'retry-delay = 2'
  printf '%s\n' 'output = "/dev/null"'
} > "$curl_config"

curl --config "$curl_config"
printf 'tg_channel_post slot=%s result=http_2xx\n' "$slot"
