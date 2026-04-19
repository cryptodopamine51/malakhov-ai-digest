from __future__ import annotations

from datetime import date, timedelta


def default_daily_issue_date(today: date) -> date:
    return today - timedelta(days=1)


def default_weekly_issue_date(today: date) -> date:
    current_week_monday = today - timedelta(days=today.weekday())
    previous_week_sunday = current_week_monday - timedelta(days=1)
    return previous_week_sunday
