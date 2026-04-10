# Telegram Proxy Runtime Guide

Дата актуальности: 2026-04-10

Этот документ фиксирует текущую рабочую конфигурацию личного прокси для Telegram на VPS.

## Что поднято

- `MTProto` прокси для Telegram
- `SOCKS5` прокси для Telegram
- мультиплексирование `HTTPS + SOCKS5` на внешнем `443`

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
- Внешние порты:
  - `443/tcp` через `sslh` как основной стабильный вариант
  - `10888/tcp` как прямой запасной вариант
- Аутентификация: логин и пароль

### Как устроен `443`

- `Caddy` больше не публикует внешний `443` напрямую
- `Caddy` слушает `127.0.0.1:8444`
- `sslh` принимает внешний `443`
- `HTTPS` трафик отправляется в `127.0.0.1:8444`
- `SOCKS5` трафик отправляется в `127.0.0.1:10888`
- редирект `443 -> 4443` делается отдельным systemd-сервисом через `iptables`

Проверки:

```bash
ssh malakhov-ai-vps 'systemctl is-active xray'
ssh malakhov-ai-vps 'ss -tulpn | grep 10888'
ssh malakhov-ai-vps 'systemctl is-active sslh-mux.service'
ssh malakhov-ai-vps 'systemctl is-active sslh-redirect.service'
```

Сквозная проверка:

```bash
ssh malakhov-ai-vps 'curl --proxy socks5h://USER:PASS@127.0.0.1:10888 -fsS https://api.ipify.org'
```

Внешняя проверка основного варианта:

```bash
curl --proxy socks5h://USER:PASS@api.malakhovai.ru:443 -fsS https://api.ipify.org
```

## Что должно быть открыто

- `2443/tcp` для `MTProto`
- `10888/tcp` для `SOCKS5`
- `443/tcp` для сайта и основного `SOCKS5`

## Где живет серверная конфигурация

- `xray`:
  - `/usr/local/etc/xray/config.json`
- `MTProto` контейнер:
  - `docker ps --filter name=malakhov_mtg`
- `sslh`:
  - `/etc/systemd/system/sslh-mux.service`
  - `/etc/systemd/system/sslh-redirect.service`

## Важные замечания

- Секрет `MTProto` и пароль `SOCKS5` не хранятся в репозитории.
- Актуальные ссылки для подключения нужно хранить вне git.
- Для телефона рекомендуется использовать `SOCKS5` на `443` как основной вариант.
- `MTProto` держать как запасной.
- Прямой `SOCKS5` на `10888` держать как дополнительный резерв.
