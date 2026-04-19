#!/bin/bash
# Скрипт для установки GitHub Actions Secrets через gh CLI
# Запускай после: gh auth login
# Использование: bash scripts/setup-secrets.sh

set -e

# Загружаем .env.local
if [ ! -f ".env.local" ]; then
  echo "Ошибка: .env.local не найден. Запусти из корня проекта."
  exit 1
fi

source .env.local

echo "Устанавливаю GitHub Actions Secrets..."

gh secret set SUPABASE_URL          --body "$SUPABASE_URL"
echo "✓ SUPABASE_URL"

gh secret set SUPABASE_SERVICE_KEY  --body "$SUPABASE_SERVICE_KEY"
echo "✓ SUPABASE_SERVICE_KEY"

gh secret set ANTHROPIC_API_KEY     --body "$ANTHROPIC_API_KEY"
echo "✓ ANTHROPIC_API_KEY"

gh secret set DEEPL_API_KEY         --body "$DEEPL_API_KEY"
echo "✓ DEEPL_API_KEY"

gh secret set TELEGRAM_BOT_TOKEN    --body "$TELEGRAM_BOT_TOKEN"
echo "✓ TELEGRAM_BOT_TOKEN"

gh secret set TELEGRAM_CHANNEL_ID   --body "-1001003966448216"
echo "✓ TELEGRAM_CHANNEL_ID"

gh secret set NEXT_PUBLIC_SITE_URL  --body "https://news.malakhovai.ru"
echo "✓ NEXT_PUBLIC_SITE_URL"

echo ""
echo "Список установленных секретов:"
gh secret list
