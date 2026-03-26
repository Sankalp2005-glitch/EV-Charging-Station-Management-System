from datetime import datetime, timedelta

from services.booking_config import (
    BOOKING_STATUS_CHARGING_STARTED,
    BOOKING_STATUS_WAITING_TO_START,
    DEFAULT_PRICE_PER_KWH_BY_SLOT_TYPE,
    GRACE_PERIOD_MINUTES,
    LEGACY_BOOKING_STATUS_CONFIRMED,
    MAX_BOOKING_MINUTES,
)
from services.charging_profiles import default_power_kw, estimate_charging_duration
from services.slot_repository import fetch_slot_with_pricing as _fetch_slot_with_pricing
from services.value_utils import format_dt as _format_dt

ACTIVE_BOOKING_STATUSES = (
    BOOKING_STATUS_WAITING_TO_START,
    BOOKING_STATUS_CHARGING_STARTED,
    LEGACY_BOOKING_STATUS_CONFIRMED,
)

QR_VERIFICATION_BOOKING_STATUSES = (
    BOOKING_STATUS_WAITING_TO_START,
    LEGACY_BOOKING_STATUS_CONFIRMED,
)


class BookingMutationError(Exception):
    def __init__(self, message, status_code=400, payload=None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.payload = payload or {}


def payment_requires_upfront_confirmation(payment_method):
    return str(payment_method or "").lower() != "cash"


def resolve_initial_payment_status(payment_method):
    return "pending" if str(payment_method or "").lower() == "cash" else "paid"


def is_payment_ready_for_qr(payment_method, payment_status):
    method = str(payment_method or "").lower()
    status = str(payment_status or "").lower()
    return method == "cash" or status == "paid"


def is_booking_in_active_window(status, start_time, end_time, now=None):
    reference_time = now or datetime.now()
    normalized_status = str(status or "").lower()
    if normalized_status not in ACTIVE_BOOKING_STATUSES:
        return False
    if not start_time or not end_time:
        return False
    return start_time <= reference_time < end_time


def is_booking_in_qr_window(status, start_time, end_time, now=None):
    reference_time = now or datetime.now()
    normalized_status = str(status or "").lower()
    if normalized_status not in ACTIVE_BOOKING_STATUSES:
        return False
    if not start_time or not end_time:
        return False
    qr_window_start = start_time - timedelta(minutes=GRACE_PERIOD_MINUTES)
    return qr_window_start <= reference_time < end_time


def is_booking_ready_for_qr_verification(
    status,
    start_time,
    end_time,
    payment_method,
    payment_status,
    *,
    charging_started_at=None,
    now=None,
):
    normalized_status = str(status or "").lower()
    if normalized_status not in QR_VERIFICATION_BOOKING_STATUSES:
        return False
    if charging_started_at is not None:
        return False
    return is_booking_in_qr_window(normalized_status, start_time, end_time, now=now) and is_payment_ready_for_qr(
        payment_method, payment_status
    )


def prepare_booking_mutation(
    cursor,
    *,
    slot_id,
    start_time,
    vehicle_category,
    battery_capacity_kwh,
    current_battery_percent,
    target_battery_percent,
    exclude_booking_id=None,
):
    slot = _fetch_slot_with_pricing(cursor, slot_id)
    if not slot:
        raise BookingMutationError("Slot not found", status_code=404)

    slot_status = str(slot.get("status") or "").lower()
    if slot_status == "out_of_service":
        raise BookingMutationError("Charger is currently out of service", status_code=409)

    slot_vehicle_category = slot.get("vehicle_category")
    if slot_vehicle_category and slot_vehicle_category != vehicle_category:
        raise BookingMutationError(
            (
                f"This charger supports {slot_vehicle_category}. "
                f"Select a compatible {slot_vehicle_category} charger."
            ),
            status_code=409,
        )

    slot_type = slot["slot_type"]
    power_kw = slot["power_kw"] or default_power_kw(vehicle_category, slot_type)
    try:
        charging_estimate = estimate_charging_duration(
            battery_capacity_kwh=battery_capacity_kwh,
            current_battery_percent=current_battery_percent,
            target_battery_percent=target_battery_percent,
            charger_power_kw=power_kw,
            vehicle_category=vehicle_category,
        )
    except ValueError as error:
        raise BookingMutationError(str(error), status_code=400) from error

    energy_required_kwh = charging_estimate["energy_required_kwh"]
    duration_minutes = charging_estimate["duration_minutes"]
    if duration_minutes > MAX_BOOKING_MINUTES:
        raise BookingMutationError(
            (
                "Estimated charging duration exceeds the maximum booking duration. "
                "Use a faster charger or lower the target battery percentage."
            ),
            status_code=400,
            payload={"estimated_duration_minutes": duration_minutes},
        )

    end_time = start_time + timedelta(minutes=duration_minutes)

    price_per_kwh = slot["price_per_kwh"]
    price_per_minute = slot["price_per_minute"]
    if price_per_kwh is None and price_per_minute is None:
        price_per_kwh = DEFAULT_PRICE_PER_KWH_BY_SLOT_TYPE.get(slot_type, 12.0)

    if price_per_kwh is not None:
        pricing_model = "per_kwh"
        rate = price_per_kwh
        estimated_cost = round(energy_required_kwh * rate, 2)
    else:
        pricing_model = "per_minute"
        rate = price_per_minute
        estimated_cost = round(duration_minutes * rate, 2)

    query = """
        SELECT booking_id, start_time, end_time
        FROM Booking
        WHERE slot_id = %s
          AND status IN (%s, %s, %s)
          AND (%s < end_time AND %s > start_time)
    """
    params = [
        slot_id,
        ACTIVE_BOOKING_STATUSES[0],
        ACTIVE_BOOKING_STATUSES[1],
        ACTIVE_BOOKING_STATUSES[2],
        start_time,
        end_time,
    ]
    if exclude_booking_id is not None:
        query += " AND booking_id <> %s"
        params.append(exclude_booking_id)
    query += " ORDER BY start_time ASC LIMIT 1"
    cursor.execute(query, tuple(params))
    conflict = cursor.fetchone()
    if conflict:
        raise BookingMutationError(
            "Slot already booked for this time range",
            status_code=409,
            payload={
                "conflicting_booking": {
                    "booking_id": int(conflict[0]),
                    "start_time": _format_dt(conflict[1]),
                    "end_time": _format_dt(conflict[2]),
                }
            },
        )

    return {
        "slot": slot,
        "slot_type": slot_type,
        "power_kw": power_kw,
        "charging_estimate": charging_estimate,
        "energy_required_kwh": energy_required_kwh,
        "duration_minutes": duration_minutes,
        "end_time": end_time,
        "pricing_model": pricing_model,
        "rate": rate,
        "estimated_cost": estimated_cost,
    }
