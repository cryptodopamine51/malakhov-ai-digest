from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = Field(default="local", alias="APP_ENV")
    app_host: str = Field(default="0.0.0.0", alias="APP_HOST")
    app_port: int = Field(default=8000, alias="APP_PORT")
    database_url: str = Field(alias="DATABASE_URL")
    bot_token: str = Field(alias="BOT_TOKEN")
    bot_polling_enabled: bool = Field(default=False, alias="BOT_POLLING_ENABLED")
    default_timezone: str = Field(default="Europe/Moscow", alias="DEFAULT_TIMEZONE")
    ingestion_interval_minutes: int = Field(default=30, alias="INGESTION_INTERVAL_MINUTES")
    ingestion_scheduler_enabled: bool = Field(default=True, alias="INGESTION_SCHEDULER_ENABLED")
    ingestion_http_timeout_seconds: float = Field(default=10.0, alias="INGESTION_HTTP_TIMEOUT_SECONDS")
    process_events_interval_minutes: int = Field(default=15, alias="PROCESS_EVENTS_INTERVAL_MINUTES")
    process_events_scheduler_enabled: bool = Field(default=True, alias="PROCESS_EVENTS_SCHEDULER_ENABLED")
    daily_digest_hour: int = Field(default=9, alias="DAILY_DIGEST_HOUR")
    weekly_digest_weekday: str = Field(default="mon", alias="WEEKLY_DIGEST_WEEKDAY")
    weekly_digest_hour: int = Field(default=9, alias="WEEKLY_DIGEST_HOUR")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
