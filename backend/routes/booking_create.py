from datetime import datetime, timedelta

from flask import current_app, jsonify, request

from extensions import mysql
from routes.booking_bp import booking_bp
from services.booking_config import BOOKING_STATUS_WAITING_TO_START, DATETIME_FMT, GRACE_PERIOD_MINUTES
from services.booking_mutations import (
    BookingMutationError,
    payment_requires_upfront_confirmation,
    prepare_booking_mutation,
    resolve_initial_payment_status,
)
from services.charging_profiles import normalize_vehicle_category
from services.booking_lifecycle import (
    emit_lifecycle_updates as _emit_lifecycle_updates,
    refresh_single_slot_status as _refresh_single_slot_status,
    run_booking_lifecycle_updates as _run_booking_lifecycle_updates,
)
from services.booking_schema import ensure_phase5_tables as _ensure_phase5_tables
from services.booking_security import (
    encode_qr_token as _encode_qr_token,
    parse_bool as _parse_bool,
    parse_payment_method as _parse_payment_method,
)
from services.value_utils import (
    close_cursor as _close_cursor,
    format_dt as _format_dt,
    parse_percent as _parse_percent,
    parse_positive_float as _parse_positive_float,
    parse_start_time as _parse_start_time,
)
from utils.jwt_handler import role_required, token_required
from utils.realtime_events import emit_booking_update


@booking_bp.route("/book-slot", methods=["POST"])
@token_required
@role_required("customer")
def book_slot(current_user):
    payload = request.get_json(silent=True) or {}

    try:
        slot_id = int(payload.get("slot_id"))
        if slot_id <= 0:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({"error": "slot_id must be a positive integer"}), 400

    start_time = _parse_start_time(payload.get("start_time"))
    if not start_time:
        return jsonify({"error": f"start_time must match {DATETIME_FMT}"}), 400

    vehicle_category = normalize_vehicle_category(payload.get("vehicle_category"))
    if not vehicle_category:
        return jsonify({"error": "vehicle_category must be one of: bike_scooter, car"}), 400

    battery_capacity_kwh = _parse_positive_float(payload.get("battery_capacity_kwh"))
    if battery_capacity_kwh is None:
        return jsonify({"error": "battery_capacity_kwh must be a positive number"}), 400

    current_battery_percent = _parse_percent(payload.get("current_battery_percent"))
    if current_battery_percent is None:
        return jsonify({"error": "current_battery_percent must be between 0 and 100"}), 400

    target_battery_percent = _parse_percent(payload.get("target_battery_percent"))
    if target_battery_percent is None:
        return jsonify({"error": "target_battery_percent must be between 0 and 100"}), 400
    if current_battery_percent >= 100:
        return jsonify({"error": "current_battery_percent must be below 100"}), 400
    if target_battery_percent <= current_battery_percent:
        return jsonify({"error": "target_battery_percent must be greater than current_battery_percent"}), 400

    if start_time < datetime.now():
        return jsonify({"error": "Cannot book a slot in the past"}), 400

    payment_method = _parse_payment_method(payload.get("payment_method"))
    if not payment_method:
        return jsonify({"error": "payment_method must be one of: upi, card, cash"}), 400

    payment_success = _parse_bool(payload.get("payment_success"))
    if payment_requires_upfront_confirmation(payment_method) and payment_success is not True:
        return (
            jsonify(
                {
                    "error": "Payment required before booking confirmation",
                    "payment_status": "failed",
                    "payment_success": False,
                }
            ),
            402,
        )

    cursor = None
    slot = None
    booking_id = None
    payment_status = resolve_initial_payment_status(payment_method)
    lifecycle_records = []

    try:
        cursor = mysql.connection.cursor()
        _ensure_phase5_tables(cursor)
        lifecycle_records = _run_booking_lifecycle_updates(cursor)
        mutation = prepare_booking_mutation(
            cursor,
            slot_id=slot_id,
            start_time=start_time,
            vehicle_category=vehicle_category,
            battery_capacity_kwh=battery_capacity_kwh,
            current_battery_percent=current_battery_percent,
            target_battery_percent=target_battery_percent,
        )
        slot = mutation["slot"]
        slot_type = mutation["slot_type"]
        power_kw = mutation["power_kw"]
        charging_estimate = mutation["charging_estimate"]
        energy_required_kwh = mutation["energy_required_kwh"]
        duration_minutes = mutation["duration_minutes"]
        end_time = mutation["end_time"]
        pricing_model = mutation["pricing_model"]
        rate = mutation["rate"]
        estimated_cost = mutation["estimated_cost"]

        cursor.execute(
            """
            INSERT INTO Booking (
                user_id,
                slot_id,
                start_time,
                end_time,
                status,
                vehicle_category,
                battery_capacity_kwh,
                current_battery_percent,
                target_battery_percent,
                energy_required_kwh,
                estimated_duration_minutes
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                current_user["user_id"],
                slot_id,
                start_time,
                end_time,
                BOOKING_STATUS_WAITING_TO_START,
                vehicle_category,
                battery_capacity_kwh,
                current_battery_percent,
                target_battery_percent,
                energy_required_kwh,
                duration_minutes,
            ),
        )
        booking_id = cursor.lastrowid
        cursor.execute(
            """
            INSERT INTO Payment (booking_id, amount, payment_method, payment_status)
            VALUES (%s, %s, %s, %s)
            """,
            (booking_id, estimated_cost, payment_method, payment_status),
        )
        _refresh_single_slot_status(cursor, slot_id)
        mysql.connection.commit()
    except BookingMutationError as error:
        mysql.connection.rollback()
        payload = {"error": error.message}
        payload.update(error.payload)
        return jsonify(payload), error.status_code
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception(
            "Failed to create booking for user_id=%s slot_id=%s",
            current_user.get("user_id"),
            payload.get("slot_id"),
        )
        return jsonify({"error": "Failed to create booking"}), 500
    finally:
        _close_cursor(cursor)

    _emit_lifecycle_updates(lifecycle_records)
    emit_booking_update(
        "booking_created",
        station_id=slot.get("station_id") if slot else None,
        slot_id=slot_id,
        booking_id=booking_id,
        status=BOOKING_STATUS_WAITING_TO_START,
        extra={
            "payment_status": payment_status,
            "grace_period_minutes": GRACE_PERIOD_MINUTES,
        },
    )

    qr_token = _encode_qr_token(booking_id, current_user["user_id"], slot_id)
    qr_value = f"evcs://booking/{booking_id}?token={qr_token}"

    return jsonify(
        {
            "message": "Booking successful",
            "booking_id": booking_id,
            "slot_id": slot_id,
            "station_id": slot.get("station_id") if slot else None,
            "start_time": _format_dt(start_time),
            "end_time": _format_dt(end_time),
            "charger_name": slot.get("charger_name"),
            "charger_type": slot_type,
            "vehicle_category": vehicle_category,
            "connector_type": slot.get("connector_type"),
            "battery_capacity_kwh": round(battery_capacity_kwh, 2),
            "current_battery_percent": round(current_battery_percent, 2),
            "target_battery_percent": round(target_battery_percent, 2),
            "energy_required_kwh": round(energy_required_kwh, 3),
            "charger_power_kw": round(power_kw, 2),
            "duration_minutes": duration_minutes,
            "duration_display": charging_estimate["duration_display"],
            "charging_speed": charging_estimate["charging_speed"],
            "pricing_model": pricing_model,
            "rate": round(rate, 2),
            "estimated_cost": estimated_cost,
            "status": BOOKING_STATUS_WAITING_TO_START,
            "payment_method": payment_method,
            "payment_status": payment_status,
            "payment_success": payment_status == "paid",
            "grace_period_minutes": GRACE_PERIOD_MINUTES,
            "qr_token": qr_token,
            "qr_value": qr_value,
        }
    ), 201
