#!/bin/bash
export $(grep -v '^#' /Users/malast/malakhov-ai-digest/.env.local | xargs)
cd /Users/malast/malakhov-ai-digest

echo "[$(date)] Waiting for API credits..."
while true; do
  RESULT=$(curl -s https://api.anthropic.com/v1/messages \
    -H "x-api-key: $ANTHROPIC_API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -H "content-type: application/json" \
    -d '{"model":"claude-haiku-4-5-20251001","max_tokens":5,"messages":[{"role":"user","content":"ping"}]}' \
    2>/dev/null)
  
  if echo "$RESULT" | grep -q '"type":"message"'; then
    echo "[$(date)] API credits available! Starting reenrich..."
    npx tsx scripts/reenrich-all.ts >> /tmp/reenrich-final.log 2>&1
    echo "[$(date)] Reenrich done. Running force digest..."
    FORCE_DIGEST=1 npx tsx bot/daily-digest.ts >> /tmp/digest-force.log 2>&1
    echo "[$(date)] All done!"
    break
  fi
  
  echo "[$(date)] Credits not yet available, retrying in 60s..."
  sleep 60
done
