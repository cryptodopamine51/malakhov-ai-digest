# Telegram Proxy Runtime Guide

Дата актуальности: 2026-04-10

Этот документ фиксирует текущую рабочую конфигурацию личного прокси для Telegram на VPS.

## Что поднято

- `MTProto` прокси для Telegram
- `SOCKS5` прокси для Telegram как запасной вариант

Оба варианта развернуты на том же сервере `malakhov-ai-vps`.

## MTProto

- Реализация: контейнер `nineseconds/mtg`
- Имя контейнера: `malakhov_mtg`
- Автозапуск: `restart unless-stopped`
- Внешний порт: `2443/tcp`
- Внутренний порт контейнера: `3128`

Проверки:

```bash
ssh malakhov-ai-vps 'docker ps --filter name=malakhov_mtg'
ssh malakhov-ai-vps 'docker logs --tail 100 malakhov_mtg'
```

## SOCKS5

- Реализация: отдельный inbound в системном `xray`
- Внешний порт: `10888/tcp`
- Аутентификация: логин и пароль

Проверки:

```bash
ssh malakhov-ai-vps 'systemctl is-active xray'
ssh malakhov-ai-vps 'ss -tulpn | grep 10888'
```

Сквозная проверка:

```bash
ssh malakhov-ai-vps 'curl --proxy socks5h://USER:PASS@127.0.0.1:10888 -fsS https://api.ipify.org'
```

## Что должно быть открыто

- `2443/tcp` для `MTProto`
- `10888/tcp` для `SOCKS5`

## Где живет серверная конфигурация

- `xray`:
  - `/usr/local/etc/xray/config.json`
- `MTProto` контейнер:
  - `docker ps --filter name=malakhov_mtg`

## Важные замечания

- Секрет `MTProto` и пароль `SOCKS5` не хранятся в репозитории.
- Актуальные ссылки для подключения нужно хранить вне git.
- Для телефона рекомендуется использовать `MTProto` как основной вариант.
- `SOCKS5` держать как запасной.
