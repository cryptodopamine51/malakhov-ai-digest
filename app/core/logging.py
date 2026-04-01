import logging
import json
from collections.abc import Mapping
from typing import Any


class AiogramPollingLogBridge(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        if record.name != "aiogram.dispatcher":
            return
        message = record.getMessage()
        bridge_logger = logging.getLogger("app.bot.polling")
        if "TelegramConflictError" in message:
            log_structured(bridge_logger, "bot_polling_conflict", source_logger=record.name, message=message)
        elif "Connection established" in message:
            log_structured(bridge_logger, "bot_polling_recovered", source_logger=record.name, message=message)
        elif "Run polling for bot" in message:
            log_structured(bridge_logger, "bot_polling_started", source_logger=record.name, message=message)


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )
    aiogram_logger = logging.getLogger("aiogram.dispatcher")
    if not any(isinstance(handler, AiogramPollingLogBridge) for handler in aiogram_logger.handlers):
        aiogram_logger.addHandler(AiogramPollingLogBridge())


def log_structured(logger: logging.Logger, event: str, **fields: Any) -> None:
    payload: dict[str, Any] = {"event": event}
    for key, value in fields.items():
        if isinstance(value, Mapping):
            payload[key] = dict(value)
        else:
            payload[key] = value
    logger.info(json.dumps(payload, ensure_ascii=False, default=str))
