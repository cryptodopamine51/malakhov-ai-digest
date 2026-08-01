#!/usr/bin/env bash
set -Eeuo pipefail

PUBLIC_URL=${PUBLIC_URL:-https://news.malakhovai.ru}
EXPECTED_IP=${EXPECTED_IP:-195.245.239.84}
HOST=${PUBLIC_URL#https://}
HOST=${HOST%%/*}

test "$(dig +short A "$HOST" @ns1.hosting.reg.ru | tail -n 1)" = "$EXPECTED_IP"
test "$(dig +short A "$HOST" @ns2.hosting.reg.ru | tail -n 1)" = "$EXPECTED_IP"
printf '' | openssl s_client -connect "$HOST:443" -servername "$HOST" 2>/dev/null \
  | openssl x509 -noout -checkend 604800 >/dev/null

for path in / /categories/ai-industry /guides /rss.xml /sitemap.xml /news-sitemap.xml /robots.txt; do
  code=$(curl -fsS --max-time 20 -o /dev/null -w '%{http_code}' "$PUBLIC_URL$path")
  test "$code" = 200
  printf 'surface=%s status=%s\n' "$path" "$code"
done

curl -fsS --max-time 20 "$PUBLIC_URL/api/feed?limit=1" \
  | python3 -c 'import json,sys; data=json.load(sys.stdin); assert data.get("total",0)>=741; print("feed_total="+str(data["total"]))'

curl -fsS --max-time 20 "$PUBLIC_URL/sitemap.xml" \
  | python3 -c 'import re,sys; text=sys.stdin.read(); urls=re.findall(r"<loc>(https://news[.]malakhovai[.]ru/categories/[^/<]+/[^<]+)</loc>",text)[:30]; assert len(urls)==30; print("\n".join(urls))' \
  | while IFS= read -r url; do
      body=$(curl -fsS --max-time 20 "$url")
      case "$body" in
        *"<link rel=\"canonical\" href=\"$url\""*) ;;
        *) printf 'canonical_mismatch=%s\n' "$url" >&2; exit 1 ;;
      esac
    done

printf 'external_smoke=passed canonical_article_urls=30 expected_ip=%s\n' "$EXPECTED_IP"
