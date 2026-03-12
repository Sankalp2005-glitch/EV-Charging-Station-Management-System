import math
from datetime import datetime, timedelta

from services.booking_config import (
    BOOKING_STATUS_CHARGING_COMPLETED,
    BOOKING_STATUS_CHARGING_STARTED,
    BOOKING_STATUS_WAITING_TO_START,
    MIN_BOOKING_MINUTES,
)

VEHICLE_CATEGORY_BIKE_SCOOTER = "bike_scooter"
VEHICLE_CATEGORY_CAR = "car"
VEHICLE_CATEGORIES = {
    VEHICLE_CATEGORY_BIKE_SCOOTER,
    VEHICLE_CATEGORY_CAR,
}

CHARGER_TYPES = {"normal", "fast"}

DEFAULT_POWER_KW_BY_CHARGER_PROFILE = {
    (VEHICLE_CATEGORY_BIKE_SCOOTER, "normal"): 3.3,
    (VEHICLE_CATEGORY_BIKE_SCOOTER, "fast"): 7.4,
    (VEHICLE_CATEGORY_CAR, "normal"): 7.4,
    (VEHICLE_CATEGORY_CAR, "fast"): 60.0,
}

DEFAULT_CONNECTOR_BY_CHARGER_PROFILE = {
    (VEHICLE_CATEGORY_BIKE_SCOOTER, "normal"): "Portable Socket",
    (VEHICLE_CATEGORY_BIKE_SCOOTER, "fast"): "LECCS",
    (VEHICLE_CATEGORY_CAR, "normal"): "Type 2",
    (VEHICLE_CATEGORY_CAR, "fast"): "CCS2",
}

DEFAULT_BATTERY_CAPACITY_KWH = {
    VEHICLE_CATEGORY_BIKE_SCOOTER: 3.5,
    VEHICLE_CATEGORY_CAR: 45.0,
}

BATTERY_CAPACITY_LIMITS_KWH = {
    VEHICLE_CATEGORY_BIKE_SCOOTER: (1.0, 8.0),
    VEHICLE_CATEGORY_CAR: (10.0, 120.0),
}

CHARGING_EFFICIENCY = {
    VEHICLE_CATEGORY_BIKE_SCOOTER: 0.90,
    VEHICLE_CATEGORY_CAR: 0.92,
}

TOP_OFF_TAPER_FACTOR = {
    VEHICLE_CATEGORY_BIKE_SCOOTER: 0.75,
    VEHICLE_CATEGORY_CAR: 0.82,
}


def normalize_vehicle_category(value):
    normalized = str(value or "").strip().lower().replace("/", "_").replace("-", "_")
    if normalized in {"bike", "scooter", "bike_scooter", "bike scooter"}:
        return VEHICLE_CATEGORY_BIKE_SCOOTER
    if normalized == VEHICLE_CATEGORY_CAR:
        return VEHICLE_CATEGORY_CAR
    return None


def normalize_charger_type(value):
    normalized = str(value or "").strip().lower()
    return normalized if normalized in CHARGER_TYPES else None


def normalize_connector_type(value):
    connector_type = str(value or "").strip()
    return connector_type or None


def default_power_kw(vehicle_category, charger_type):
    return DEFAULT_POWER_KW_BY_CHARGER_PROFILE.get(
        (vehicle_category, charger_type),
        DEFAULT_POWER_KW_BY_CHARGER_PROFILE[(VEHICLE_CATEGORY_CAR, "normal")],
    )


def default_connector_type(vehicle_category, charger_type):
    return DEFAULT_CONNECTOR_BY_CHARGER_PROFILE.get(
        (vehicle_category, charger_type),
        DEFAULT_CONNECTOR_BY_CHARGER_PROFILE[(VEHICLE_CATEGORY_CAR, "normal")],
    )


def is_battery_capacity_valid(vehicle_category, battery_capacity_kwh):
    limits = BATTERY_CAPACITY_LIMITS_KWH.get(vehicle_category)
    if limits is None:
        return False
    minimum, maximum = limits
    return minimum <= float(battery_capacity_kwh) <= maximum


def classify_charging_speed(power_kw, vehicle_category):
    power_value = float(power_kw or 0)
    if vehicle_category == VEHICLE_CATEGORY_BIKE_SCOOTER:
        if power_value >= 6:
            return "rapid"
        if power_value >= 3:
            return "standard"
        return "slow"

    if power_value >= 120:
        return "ultra-fast"
    if power_value >= 40:
        return "fast"
    if power_value >= 11:
        return "standard"
    return "slow"


def format_duration_human(duration_minutes):
    try:
        total_minutes = max(0, int(math.ceil(float(duration_minutes or 0))))
    except (TypeError, ValueError):
        return "0 Minutes"

    hours, minutes = divmod(total_minutes, 60)
    parts = []
    if hours:
        parts.append(f"{hours} Hour" if hours == 1 else f"{hours} Hours")
    if minutes or not parts:
        parts.append(f"{minutes} Minute" if minutes == 1 else f"{minutes} Minutes")
    return " ".join(parts)


def estimate_charging_duration(
    *,
    battery_capacity_kwh,
    current_battery_percent,
    target_battery_percent,
    charger_power_kw,
    vehicle_category,
):
    vehicle_category = normalize_vehicle_category(vehicle_category)
    if vehicle_category not in VEHICLE_CATEGORIES:
        raise ValueError("Unsupported vehicle category")

    battery_capacity_kwh = float(battery_capacity_kwh)
    current_battery_percent = float(current_battery_percent)
    target_battery_percent = float(target_battery_percent)
    charger_power_kw = float(charger_power_kw)

    if charger_power_kw <= 0:
        raise ValueError("charger_power_kw must be positive")
    if not is_battery_capacity_valid(vehicle_category, battery_capacity_kwh):
        minimum, maximum = BATTERY_CAPACITY_LIMITS_KWH[vehicle_category]
        raise ValueError(
            f"battery_capacity_kwh must be between {minimum:.1f} and {maximum:.1f} for {vehicle_category}"
        )
    if current_battery_percent < 0 or current_battery_percent >= 100:
        raise ValueError("current_battery_percent must be between 0 and 99.99")
    if target_battery_percent <= current_battery_percent or target_battery_percent > 100:
        raise ValueError("target_battery_percent must be greater than current_battery_percent and at most 100")

    energy_required_kwh = battery_capacity_kwh * ((target_battery_percent - current_battery_percent) / 100.0)
    efficiency = CHARGING_EFFICIENCY[vehicle_category]
    taper_factor = TOP_OFF_TAPER_FACTOR[vehicle_category]

    pre_taper_target = min(target_battery_percent, 80.0)
    pre_taper_energy_kwh = 0.0
    if pre_taper_target > current_battery_percent:
        pre_taper_energy_kwh = battery_capacity_kwh * ((pre_taper_target - current_battery_percent) / 100.0)
    post_taper_energy_kwh = max(0.0, energy_required_kwh - pre_taper_energy_kwh)

    pre_taper_hours = pre_taper_energy_kwh / max(charger_power_kw * efficiency, 0.1)
    post_taper_hours = post_taper_energy_kwh / max(charger_power_kw * efficiency * taper_factor, 0.1)
    raw_duration_minutes = int(math.ceil((pre_taper_hours + post_taper_hours) * 60))
    duration_minutes = max(MIN_BOOKING_MINUTES, raw_duration_minutes)

    return {
        "vehicle_category": vehicle_category,
        "energy_required_kwh": round(energy_required_kwh, 3),
        "duration_minutes": duration_minutes,
        "duration_display": format_duration_human(duration_minutes),
        "charging_speed": classify_charging_speed(charger_power_kw, vehicle_category),
    }


def build_live_charging_snapshot(
    *,
    booking_status,
    charging_started_at=None,
    charging_completed_at=None,
    estimated_duration_minutes=None,
    current_battery_percent=None,
    target_battery_percent=None,
    energy_required_kwh=None,
    now=None,
):
    status = str(booking_status or "").strip().lower()
    now = now or datetime.now()

    try:
        duration_minutes = max(0, int(math.ceil(float(estimated_duration_minutes or 0))))
    except (TypeError, ValueError):
        duration_minutes = 0

    try:
        battery_start = float(current_battery_percent) if current_battery_percent is not None else None
    except (TypeError, ValueError):
        battery_start = None
    try:
        battery_target = float(target_battery_percent) if target_battery_percent is not None else None
    except (TypeError, ValueError):
        battery_target = None
    try:
        energy_required = float(energy_required_kwh) if energy_required_kwh is not None else None
    except (TypeError, ValueError):
        energy_required = None

    progress_percent = 0.0
    estimated_completion_time = None
    remaining_minutes = None

    if charging_started_at and duration_minutes > 0:
        estimated_completion_time = charging_started_at + timedelta(minutes=duration_minutes)

    if status == BOOKING_STATUS_CHARGING_COMPLETED or charging_completed_at:
        progress_percent = 100.0
        remaining_minutes = 0
        if charging_completed_at:
            estimated_completion_time = charging_completed_at
    elif status == BOOKING_STATUS_CHARGING_STARTED and charging_started_at and duration_minutes > 0:
        elapsed_minutes = max((now - charging_started_at).total_seconds() / 60.0, 0.0)
        progress_percent = min((elapsed_minutes / duration_minutes) * 100.0, 100.0)
        remaining_minutes = max(int(math.ceil(duration_minutes - elapsed_minutes)), 0)
    elif status == BOOKING_STATUS_WAITING_TO_START:
        progress_percent = 0.0

    estimated_current_battery_percent = None
    if battery_start is not None and battery_target is not None:
        delta = max(battery_target - battery_start, 0.0)
        estimated_current_battery_percent = min(
            battery_start + (delta * (progress_percent / 100.0)),
            battery_target,
        )

    estimated_energy_delivered_kwh = None
    if energy_required is not None:
        estimated_energy_delivered_kwh = min(
            max(energy_required * (progress_percent / 100.0), 0.0),
            energy_required,
        )

    return {
        "progress_percent": round(progress_percent, 1),
        "estimated_completion_time": estimated_completion_time,
        "remaining_minutes": remaining_minutes,
        "estimated_current_battery_percent": (
            round(estimated_current_battery_percent, 1)
            if estimated_current_battery_percent is not None
            else None
        ),
        "estimated_energy_delivered_kwh": (
            round(estimated_energy_delivered_kwh, 3)
            if estimated_energy_delivered_kwh is not None
            else None
        ),
    }
