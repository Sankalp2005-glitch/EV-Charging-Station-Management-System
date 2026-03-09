from datetime import datetime

from services.booking_config import DATETIME_FMT


def to_str(value):
    return value.decode("utf-8") if isinstance(value, bytes) else value


def format_dt(value):
    return value.strftime(DATETIME_FMT) if isinstance(value, datetime) else value


def close_cursor(cursor):
    if cursor:
        cursor.close()


def parse_start_time(start_time_raw):
    if not isinstance(start_time_raw, str) or not start_time_raw.strip():
        return None
    try:
        return datetime.strptime(start_time_raw, DATETIME_FMT)
    except ValueError:
        return None


def parse_positive_float(value):
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed <= 0:
        return None
    return parsed


def parse_percent(value):
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed < 0 or parsed > 100:
        return None
    return parsed
