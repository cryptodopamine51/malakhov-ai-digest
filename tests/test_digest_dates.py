from datetime import date

from app.core.digest_dates import default_daily_issue_date, default_weekly_issue_date


def test_default_daily_issue_date_uses_previous_day():
    assert default_daily_issue_date(date(2026, 3, 26)) == date(2026, 3, 25)
    assert default_daily_issue_date(date(2026, 3, 1)) == date(2026, 2, 28)


def test_default_weekly_issue_date_uses_last_completed_sunday():
    assert default_weekly_issue_date(date(2026, 3, 26)) == date(2026, 3, 22)
    assert default_weekly_issue_date(date(2026, 3, 23)) == date(2026, 3, 22)
    assert default_weekly_issue_date(date(2026, 3, 22)) == date(2026, 3, 15)
