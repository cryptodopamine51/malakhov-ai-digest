# ComfyUI Test Report: 10-image Benchmark

Дата: 2026-04-20

## Текущий статус

### Preflight по существующему серверу `malakhov-ai-vps`

- Проверка выполнена: `2026-04-20`
- Результат: `FAIL`
- Причины:
  - нет NVIDIA GPU
  - нет `nvidia-container-toolkit`
  - `3.8 GiB RAM` вместо целевых `32+ GiB`
  - `46 GiB` свободного диска вместо целевых `150+ GiB`

Вывод: текущий VPS годится как control-plane / VPN / reverse-proxy-узел, но не как GPU-runner для ComfyUI benchmark.

## Что нужно перед реальным тестом

1. Выделить отдельный GPU-сервер, проходящий `infra/comfyui/preflight.sh`.
2. Разложить модели и LoRA по путям из `infra/comfyui/.env.example`.
3. Поднять `docker compose` из `infra/comfyui`.
4. Импортировать `editorial_collage_v1.json` и `editorial_collage_v2.json`.
5. Прогнать prompt-pack `infra/comfyui/prompts/editorial_collage_prompt_pack_v1.md`.

## Benchmark Table

| # | Scenario | Seed | Checkpoint | LoRA stack | Preset | Time | File | Verdict | Notes |
|---|---|---:|---|---|---|---|---|---|---|
| 1 | ai_regulation_institutions | 41021 | pending | pending | standard | pending | pending | pending | pending |
| 2 | new_model_human_interface | 41022 | pending | pending | standard | pending | pending | pending | pending |
| 3 | open_source_workshop | 41023 | pending | pending | standard | pending | pending | pending | pending |
| 4 | chips_supply_chain | 41024 | pending | pending | standard | pending | pending | pending | pending |
| 5 | media_newsroom_documents | 41025 | pending | pending | standard | pending | pending | pending | pending |
| 6 | safety_transparency_glass | 41026 | pending | pending | standard | pending | pending | pending | pending |
| 7 | labour_robotization_factory | 41027 | pending | pending | standard | pending | pending | pending | pending |
| 8 | education_ai_classroom | 41028 | pending | pending | standard | pending | pending | pending | pending |
| 9 | geopolitics_maps_borders | 41029 | pending | pending | standard | pending | pending | pending | pending |
| 10 | russian_ai_context | 41030 | pending | pending | standard | pending | pending | pending | pending |

## Quality Bar

Картинка считается удачной только если одновременно:

- выглядит как editorial visual, а не как generic AI-art;
- держит один сильный фокус;
- не уходит в клише;
- не ломается по анатомии и перспективе;
- нормально переносит hero-crop `16:9`;
- может жить в серии, не копируя соседние кадры.

## Итоговое решение

- `usable_count`: pending
- `hero_candidate_count`: pending
- `decision`: pending
- `next_step`: pending
