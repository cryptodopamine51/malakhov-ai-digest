# VPN Runtime Guide

Дата актуальности: 2026-04-10

Этот документ фиксирует текущую рабочую конфигурацию VPN на сервере `malakhov-ai-vps`.

## Что развернуто

- Сервис: `xray`
- Типы профилей:
  - `VLESS TCP TLS` на `9443` — основной профиль
  - `VLESS TCP REALITY` на `8443` — запасной профиль
  - `VLESS WS TLS` через `api.malakhovai.ru:443` — резервный профиль
- Публичный домен для всех профилей: `api.malakhovai.ru`

## Где живет конфигурация

- Основной конфиг `xray`:
  - `/usr/local/etc/xray/config.json`
- Сертификаты для `VLESS TCP TLS`:
  - `/usr/local/etc/xray/certs/api.malakhovai.ru.crt`
  - `/usr/local/etc/xray/certs/api.malakhovai.ru.key`
- Источник сертификатов:
  - `/opt/malakhov-ai-digest/volumes/caddy-data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/api.malakhovai.ru/`
- Прокси-маршрут для `WS`:
  - [deploy/Caddyfile](/Users/malast/malakhov-ai-digest/deploy/Caddyfile)

Важно: `xray` не живет в Docker-стеке сайта. Это отдельный системный сервис на VPS.

## Активные входящие каналы

### 1. Основной: VLESS TCP TLS

- Адрес: `api.malakhovai.ru`
- Порт: `9443`
- Transport: `tcp`
- Security: `tls`
- SNI: `api.malakhovai.ru`
- UUID: `ab9e51a4-f848-4044-81fb-07f3083b1dbb`

URI:

```text
vless://ab9e51a4-f848-4044-81fb-07f3083b1dbb@api.malakhovai.ru:9443?encryption=none&security=tls&sni=api.malakhovai.ru&fp=safari&type=tcp#Malakhov%20VLESS%20TCP%20TLS
```

### 2. Запасной: VLESS TCP REALITY

- Адрес: `api.malakhovai.ru`
- Порт: `8443`
- Transport: `tcp`
- Security: `reality`
- Flow: `xtls-rprx-vision`
- SNI: `www.cloudflare.com`
- Public key: `dnZJOIMlaOyMQccZXjca_GsFSnQJwueseaEKi8MEdlI`
- Short ID: `6ba85179d8`
- UUID: `ab9e51a4-f848-4044-81fb-07f3083b1dbb`

URI:

```text
vless://ab9e51a4-f848-4044-81fb-07f3083b1dbb@api.malakhovai.ru:8443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.cloudflare.com&fp=safari&pbk=dnZJOIMlaOyMQccZXjca_GsFSnQJwueseaEKi8MEdlI&sid=6ba85179d8&type=tcp#Malakhov%20VLESS%20TCP%20REALITY
```

### 3. Резервный: VLESS WS TLS

- Адрес: `api.malakhovai.ru`
- Порт: `443`
- Transport: `ws`
- Security: `tls`
- Path: `/vless-a4c5a3b624212c6bfa26d18ea9e5c458`
- Host: `api.malakhovai.ru`
- SNI: `api.malakhovai.ru`
- UUID: `ab9e51a4-f848-4044-81fb-07f3083b1dbb`

URI:

```text
vless://ab9e51a4-f848-4044-81fb-07f3083b1dbb@api.malakhovai.ru:443?encryption=none&security=tls&type=ws&host=api.malakhovai.ru&path=%2Fvless-a4c5a3b624212c6bfa26d18ea9e5c458&sni=api.malakhovai.ru&fp=safari#Malakhov%20VLESS%20WS%20TLS
```

## Что должно быть открыто на сервере

- `443/tcp`
- `8443/tcp`
- `9443/tcp`

## Базовая проверка после любых правок

### Проверка сервиса

```bash
ssh malakhov-ai-vps 'systemctl is-active xray && systemctl status xray --no-pager -n 40'
```

### Проверка слушающих портов

```bash
ssh malakhov-ai-vps 'ss -tulpn | grep -E ":(8443|9443|10000)\\b"'
```

### Проверка WebSocket-маршрута

```bash
curl --http1.1 -skI https://api.malakhovai.ru/vless-a4c5a3b624212c6bfa26d18ea9e5c458 \
  -H 'Connection: Upgrade' \
  -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ=='
```

Ожидаемо: не `404`. Ответ `400/405` допустим для smoke-check.

### Проверка прямого TCP снаружи

```bash
python3 - <<'PY'
import socket
for port in (8443, 9443):
    s = socket.socket()
    s.settimeout(10)
    try:
        s.connect(("api.malakhovai.ru", port))
        print(port, "OPEN")
    except Exception as exc:
        print(port, "FAIL", repr(exc))
    finally:
        s.close()
PY
```

## Что уже ломалось раньше

1. Из `Caddy` выпадал маршрут `WS` до `xray`, и тогда `api.malakhovai.ru/...path...` уходил в API с `404`.
2. Был только один клиентский путь, поэтому при сбое не было нормального резерва.
3. `REALITY` на нестандартном порту может быть менее совместим с отдельными приложениями и сетями.

## Рекомендуемый порядок профилей в телефоне

1. `VLESS TCP TLS` на `9443`
2. `VLESS TCP REALITY` на `8443`
3. `VLESS WS TLS` на `443`

## Локальные файлы с профилями

Они лежат вне репозитория:

- `/Users/malast/vless-tcp-tls-malakhovai.txt`
- `/Users/malast/vless-tcp-reality-malakhovai.txt`
- `/Users/malast/vless-ws-tls-malakhovai.txt`
- `/Users/malast/vpn-malakhovai-current.md`
