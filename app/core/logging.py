import logging
import json
from collections.abc import Mapping
from typing import Any


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )


def log_structured(logger: logging.Logger, event: str, **fields: Any) -> None:
    payload: dict[str, Any] = {"event": event}
    for key, value in fields.items():
        if isinstance(value, Mapping):
            payload[key] = dict(value)
        else:
            payload[key] = value
    logger.info(json.dumps(payload, ensure_ascii=False, default=str))
