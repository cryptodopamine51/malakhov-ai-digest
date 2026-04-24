# ComfyUI Editorial Collage Stack

Этот каталог собирает воспроизводимый контур для локальной генерации editorial collage / photomontage на отдельном GPU-сервере.

## Что внутри

- `docker-compose.yml` — основной сервис `ComfyUI`
- `Dockerfile` — сборка ComfyUI из стабильного upstream-тега `v0.15.1`
- `.env.example` — параметры путей, порта и переменных для модели/доступа
- `preflight.sh` — проверка сервера на соответствие минимальным требованиям
- `workflows/*.json` — импортируемые workflow для `txt2img` и `img2img/inpaint`
- `prompts/*` — style base, negative base и benchmark-пакет на 10 сюжетов

## Важный статус на 2026-04-20

Проверка текущего сервера `malakhov-ai-vps` показала, что он не подходит для этой спеки:

- `2 vCPU`
- `3.8 GiB RAM`
- `46 GiB free disk`
- `0 NVIDIA GPU`
- нет `nvidia-container-toolkit`

Это значит:

- на текущем VPS можно хранить конфиг, reverse proxy и доступ через VPN;
- на текущем VPS нельзя честно поднять production-grade ComfyUI под FLUX/SDXL benchmark;
- для реального запуска нужен отдельный GPU-host.

## Минимальный профиль GPU-хоста

- Ubuntu `22.04` или `24.04`
- `docker` + `docker compose`
- `nvidia-container-toolkit`
- минимум `1` NVIDIA GPU с `16+ GiB VRAM`
- минимум `32 GiB RAM`
- минимум `150 GiB` свободного SSD

Проверка:

```bash
bash infra/comfyui/preflight.sh local
bash infra/comfyui/preflight.sh malakhov-ai-vps
```

## Развёртывание на подходящем GPU-сервере

1. Скопировать каталог `infra/comfyui` на сервер.
2. Заполнить `.env` на основе `.env.example`.
3. Подготовить директории:

```bash
sudo mkdir -p /srv/comfyui/{cache,input,output}
sudo mkdir -p /srv/comfyui/models/{checkpoints,loras,controlnet,vae,upscale_models}
sudo mkdir -p /srv/comfyui/user/default/workflows
```

4. Положить модели под ожидаемые алиасы:

- `models/checkpoints/editorial_sdxl_base.safetensors`
- `models/checkpoints/editorial_sdxl_collage.safetensors`
- `models/loras/editorial_magazine_01.safetensors`
- `models/loras/paper_collage_01.safetensors`
- `models/loras/print_grain_matte_01.safetensors`
- `models/upscale_models/4x-UltraSharp.pth`

5. Поднять сервис:

```bash
cd infra/comfyui
cp .env.example .env
docker compose build
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:${COMFYUI_HOST_PORT:-18188}/system_stats
```

## Reverse Proxy и закрытый доступ

Рекомендуемый путь на уже существующем `Caddy`:

```caddy
comfy.malakhovai.ru {
	encode zstd gzip
	basicauth {
		{$COMFYUI_BASIC_AUTH_USER} {$COMFYUI_BASIC_AUTH_HASH}
	}
	reverse_proxy 127.0.0.1:18188
}
```

Если ComfyUI нужен только в приватном контуре, публичный DNS не обязателен. Достаточно оставить bind на `127.0.0.1:18188` и открывать через VPN или `ssh -L 18188:127.0.0.1:18188`.

## Workflow-профили

### `draft`

- `1344x768`
- `18` steps
- `cfg 5.5`
- без upscale-прохода

### `standard`

- `1344x768`
- `28` steps
- `cfg 6.5`
- upscale до `1920x1080`

### `hero`

- `1792x1024`
- `36` steps
- `cfg 7.0`
- upscale + ручная проверка героя под кроп

Workflow JSON сохранены в стандартном пресете `standard`. Для `draft` и `hero` меняются только параметры sampler/size.

## Workflow v1

`workflows/editorial_collage_v1.json`

- `txt2img`
- SDXL checkpoint + 3 LoRA
- metadata в PNG
- upscale-модель для финального выхода `1920x1080`

## Workflow v2

`workflows/editorial_collage_v2.json`

- `img2img / inpaint`
- RGBA layout reference или маска
- полезен для hero-визуалов и более жёсткой композиции

Паттерн входа:

- положить reference PNG в `input/`
- альфа-канал использовать как маску для зоны перерендера
- заменить `layout_reference_rgba.png` в workflow на нужный файл

## Benchmark

- prompt-pack: `prompts/editorial_collage_prompt_pack_v1.md`
- style base: `prompts/editorial_collage_style_base.txt`
- negative base: `prompts/editorial_collage_negative_base.txt`
- отчёт: `docs/comfyui_test_report_10_images.md`

После генерации 10 сюжетов нужно заполнить таблицу в отчёте и зафиксировать:

- seed
- checkpoint
- LoRA stack
- sampler settings
- wall-clock time
- verdict: `reject | usable | hero_candidate`
