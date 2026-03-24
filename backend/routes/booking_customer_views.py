from datetime import datetime

from MySQLdb import OperationalError
from flask import current_app, jsonify, request

from extensions import mysql
from routes.booking_bp import booking_bp
from services.booking_config import BOOKING_STATUS_WAITING_TO_START, DATETIME_FMT
from services.booking_mutations import (
    BookingMutationError,
    is_booking_in_active_window,
    is_payment_ready_for_qr,
    prepare_booking_mutation,
)
from services.charging_profiles import build_live_charging_snapshot, format_duration_human, normalize_vehicle_category
from services.booking_lifecycle import (
    emit_lifecycle_updates as _emit_lifecycle_updates,
    refresh_single_slot_status as _refresh_single_slot_status,
    run_booking_lifecycle_updates as _run_booking_lifecycle_updates,
)
from services.booking_schema import ensure_phase5_tables as _ensure_phase5_tables
from services.db_errors import is_retryable_transaction_error
from services.value_utils import (
    close_cursor as _close_cursor,
    ensure_station_geo_columns,
    format_dt as _format_dt,
    haversine_distance_km,
    normalize_coordinate_pair,
    parse_geo_filters,
    parse_percent as _parse_percent,
    parse_positive_float as _parse_positive_float,
    parse_start_time as _parse_start_time,
    to_str as _to_str,
)
from utils.jwt_handler import role_required, token_required
from utils.realtime_events import emit_booking_update


@booking_bp.route("/my-bookings", methods=["GET"])
@token_required
@role_required("customer")
def my_bookings(current_user):
    cursor = None
    view = (request.args.get("view") or "").strip().lower()
    include_history = (request.args.get("include_history") or "").strip().lower() in {
        "1",
        "true",
        "yes",
    }
    geo_filters, geo_error = parse_geo_filters(request.args)
    if geo_error:
        return jsonify({"error": geo_error}), 400

    if not view:
        view = "all" if include_history else "upcoming"
    if view not in {"upcoming", "past", "all"}:
        return jsonify({"error": "view must be one of: upcoming, past, all"}), 400

    now = datetime.now()
    lifecycle_records = []
    bookings = []

    for attempt in range(2):
        try:
            cursor = mysql.connection.cursor()
            _ensure_phase5_tables(cursor)
            ensure_station_geo_columns(cursor)
            lifecycle_records = _run_booking_lifecycle_updates(cursor)
            mysql.connection.commit()

            query = """
                SELECT
                    b.booking_id,
                    b.slot_id,
                    cs.station_name,
                    cs.location,
                    cs.latitude,
                    cs.longitude,
                    sl.slot_number,
                    sl.slot_type,
                    sl.charger_name,
                    sl.vehicle_category,
                    b.start_time,
                    b.end_time,
                    b.status,
                    p.payment_status,
                    p.payment_method,
                    sess.start_time AS charging_started_at,
                    sess.end_time AS charging_completed_at,
                    b.estimated_duration_minutes,
                    b.battery_capacity_kwh,
                    b.current_battery_percent,
                    b.target_battery_percent,
                    b.energy_required_kwh,
                    sl.power_kw
                FROM Booking b
                JOIN ChargingSlot sl ON b.slot_id = sl.slot_id
                JOIN ChargingStation cs ON sl.station_id = cs.station_id
                LEFT JOIN Payment p ON p.booking_id = b.booking_id
                LEFT JOIN ChargingSession sess ON sess.booking_id = b.booking_id
                WHERE b.user_id = %s
            """
            params = [current_user["user_id"]]

            if view == "upcoming":
                query += " AND b.status IN ('waiting_to_start', 'charging_started', 'confirmed') AND b.end_time >= NOW()"
            elif view == "past":
                query += " AND (b.status IN ('charging_completed', 'cancelled', 'completed') OR b.end_time < NOW())"

            if view == "past":
                query += " ORDER BY b.start_time DESC"
            else:
                query += " ORDER BY b.start_time ASC"

            cursor.execute(query, tuple(params))
            bookings = cursor.fetchall()
            break
        except OperationalError as error:
            mysql.connection.rollback()
            if attempt == 0 and is_retryable_transaction_error(error):
                current_app.logger.warning(
                    "Retrying bookings fetch after transient database error for user_id=%s: %s",
                    current_user.get("user_id"),
                    error,
                )
                continue
            current_app.logger.exception(
                "Failed to fetch bookings for user_id=%s", current_user.get("user_id")
            )
            return jsonify({"error": "Failed to fetch bookings"}), 500
        except Exception:
            mysql.connection.rollback()
            current_app.logger.exception(
                "Failed to fetch bookings for user_id=%s", current_user.get("user_id")
            )
            return jsonify({"error": "Failed to fetch bookings"}), 500
        finally:
            _close_cursor(cursor)
            cursor = None

    _emit_lifecycle_updates(lifecycle_records)

    result = []
    for row in bookings:
        latitude, longitude = normalize_coordinate_pair(row[4], row[5])
        distance_km = None
        if geo_filters:
            distance_km = haversine_distance_km(
                geo_filters["latitude"],
                geo_filters["longitude"],
                latitude,
                longitude,
            )
            if distance_km is None or distance_km > geo_filters["radius_km"]:
                continue

        duration_minutes = int(row[17] or max(int((row[11] - row[10]).total_seconds() // 60), 0))
        status = _to_str(row[12])
        payment_status = (_to_str(row[13]) or "pending").lower()
        payment_method = (_to_str(row[14]) or "").lower() or None
        charging_started_at = row[15]
        charging_completed_at = row[16]
        battery_capacity_kwh = float(row[18]) if row[18] is not None else None
        current_battery_percent = float(row[19]) if row[19] is not None else None
        target_battery_percent = float(row[20]) if row[20] is not None else None
        energy_required_kwh = float(row[21]) if row[21] is not None else None
        charger_power_kw = float(row[22]) if row[22] is not None else None
        can_cancel = status == BOOKING_STATUS_WAITING_TO_START and row[11] > now and charging_started_at is None
        can_edit = status == BOOKING_STATUS_WAITING_TO_START and row[10] > now and charging_started_at is None
        is_future_booking = row[10] >= now
        can_show_qr = is_booking_in_active_window(status, row[10], row[11], now=now) and is_payment_ready_for_qr(
            payment_method, payment_status
        )
        can_start_charging = can_show_qr and charging_started_at is None
        live_snapshot = build_live_charging_snapshot(
            booking_status=status,
            charging_started_at=charging_started_at,
            charging_completed_at=charging_completed_at,
            estimated_duration_minutes=duration_minutes,
            current_battery_percent=current_battery_percent,
            target_battery_percent=target_battery_percent,
            energy_required_kwh=energy_required_kwh,
            now=now,
        )

        result.append(
            {
                "booking_id": row[0],
                "slot_id": row[1],
                "station_name": _to_str(row[2]),
                "location": _to_str(row[3]),
                "station_latitude": latitude,
                "station_longitude": longitude,
                "distance_km": round(distance_km, 2) if distance_km is not None else None,
                "slot_number": row[6],
                "slot_type": _to_str(row[7]),
                "charger_name": _to_str(row[8]),
                "vehicle_category": _to_str(row[9]),
                "start_time": _format_dt(row[10]),
                "end_time": _format_dt(row[11]),
                "duration_minutes": duration_minutes,
                "duration_display": format_duration_human(duration_minutes),
                "status": status,
                "can_cancel": can_cancel,
                "can_edit": can_edit,
                "is_future_booking": is_future_booking,
                "payment_status": payment_status,
                "payment_method": payment_method,
                "charging_started_at": _format_dt(charging_started_at),
                "charging_completed_at": _format_dt(charging_completed_at),
                "battery_capacity_kwh": battery_capacity_kwh,
                "current_battery_percent": current_battery_percent,
                "target_battery_percent": target_battery_percent,
                "energy_required_kwh": energy_required_kwh,
                "charger_power_kw": charger_power_kw,
                "charging_progress_percent": live_snapshot["progress_percent"],
                "estimated_current_battery_percent": live_snapshot["estimated_current_battery_percent"],
                "estimated_completion_time": _format_dt(live_snapshot["estimated_completion_time"]),
                "remaining_minutes": live_snapshot["remaining_minutes"],
                "estimated_energy_delivered_kwh": live_snapshot["estimated_energy_delivered_kwh"],
                "can_show_qr": can_show_qr,
                "can_start_charging": can_start_charging,
            }
        )

    return jsonify(result), 200


@booking_bp.route("/<int:booking_id>", methods=["PUT"])
@token_required
@role_required("customer")
def update_booking(current_user, booking_id):
    payload = request.get_json(silent=True) or {}

    start_time = _parse_start_time(payload.get("start_time"))
    if not start_time:
        return jsonify({"error": f"start_time must match {DATETIME_FMT}"}), 400
    if start_time < datetime.now():
        return jsonify({"error": "Cannot reschedule a booking into the past"}), 400

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

    cursor = None
    now = datetime.now()
    lifecycle_records = []
    slot_id = None
    station_id = None
    payment_method = None
    payment_status = "pending"

    try:
        cursor = mysql.connection.cursor()
        _ensure_phase5_tables(cursor)
        lifecycle_records = _run_booking_lifecycle_updates(cursor)
        mysql.connection.commit()

        cursor.execute(
            """
            SELECT
                b.user_id,
                b.slot_id,
                b.start_time,
                b.status,
                sl.station_id,
                p.payment_method,
                p.payment_status,
                sess.start_time AS charging_started_at
            FROM Booking b
            JOIN ChargingSlot sl ON sl.slot_id = b.slot_id
            LEFT JOIN Payment p ON p.booking_id = b.booking_id
            LEFT JOIN ChargingSession sess ON sess.booking_id = b.booking_id
            WHERE b.booking_id = %s
            LIMIT 1
            """,
            (booking_id,),
        )
        booking = cursor.fetchone()
        if not booking:
            return jsonify({"error": "Booking not found"}), 404
        if booking[0] != current_user["user_id"]:
            return jsonify({"error": "Unauthorized"}), 403

        status = _to_str(booking[3])
        if status != BOOKING_STATUS_WAITING_TO_START:
            return jsonify({"error": "Only waiting-to-start bookings can be edited"}), 409
        if booking[2] <= now:
            return jsonify({"error": "Only future bookings can be edited"}), 409
        if booking[7] is not None:
            return jsonify({"error": "Charging already started for this booking"}), 409

        slot_id = int(booking[1])
        station_id = int(booking[4] or 0)
        payment_method = (_to_str(booking[5]) or "").lower() or None
        payment_status = (_to_str(booking[6]) or "pending").lower()

        mutation = prepare_booking_mutation(
            cursor,
            slot_id=slot_id,
            start_time=start_time,
            vehicle_category=vehicle_category,
            battery_capacity_kwh=battery_capacity_kwh,
            current_battery_percent=current_battery_percent,
            target_battery_percent=target_battery_percent,
            exclude_booking_id=booking_id,
        )

        cursor.execute(
            """
            UPDATE Booking
            SET
                start_time = %s,
                end_time = %s,
                vehicle_category = %s,
                battery_capacity_kwh = %s,
                current_battery_percent = %s,
                target_battery_percent = %s,
                energy_required_kwh = %s,
                estimated_duration_minutes = %s
            WHERE booking_id = %s
            """,
            (
                start_time,
                mutation["end_time"],
                vehicle_category,
                battery_capacity_kwh,
                current_battery_percent,
                target_battery_percent,
                mutation["energy_required_kwh"],
                mutation["duration_minutes"],
                booking_id,
            ),
        )
        cursor.execute(
            """
            UPDATE Payment
            SET amount = %s
            WHERE booking_id = %s
            """,
            (mutation["estimated_cost"], booking_id),
        )
        _refresh_single_slot_status(cursor, slot_id)
        mysql.connection.commit()
    except BookingMutationError as error:
        mysql.connection.rollback()
        response = {"error": error.message}
        response.update(error.payload)
        return jsonify(response), error.status_code
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception(
            "Failed to update booking_id=%s for user_id=%s",
            booking_id,
            current_user.get("user_id"),
        )
        return jsonify({"error": "Failed to update booking"}), 500
    finally:
        _close_cursor(cursor)

    _emit_lifecycle_updates(lifecycle_records)
    emit_booking_update(
        "booking_updated",
        station_id=station_id,
        slot_id=slot_id,
        booking_id=booking_id,
        status=BOOKING_STATUS_WAITING_TO_START,
        extra={"payment_status": payment_status},
    )

    return (
        jsonify(
            {
                "message": "Booking updated successfully",
                "booking_id": booking_id,
                "slot_id": slot_id,
                "station_id": station_id,
                "start_time": _format_dt(start_time),
                "end_time": _format_dt(mutation["end_time"]),
                "vehicle_category": vehicle_category,
                "battery_capacity_kwh": round(battery_capacity_kwh, 2),
                "current_battery_percent": round(current_battery_percent, 2),
                "target_battery_percent": round(target_battery_percent, 2),
                "energy_required_kwh": round(mutation["energy_required_kwh"], 3),
                "charger_power_kw": round(mutation["power_kw"], 2),
                "duration_minutes": mutation["duration_minutes"],
                "duration_display": mutation["charging_estimate"]["duration_display"],
                "charging_speed": mutation["charging_estimate"]["charging_speed"],
                "pricing_model": mutation["pricing_model"],
                "rate": round(mutation["rate"], 2),
                "estimated_cost": mutation["estimated_cost"],
                "payment_method": payment_method,
                "payment_status": payment_status,
            }
        ),
        200,
    )


@booking_bp.route("/cancel/<int:booking_id>", methods=["PUT"])
@token_required
@role_required("customer")
def cancel_booking(current_user, booking_id):
    cursor = None
    now = datetime.now()
    lifecycle_records = []
    slot_id = None
    station_id = None

    try:
        cursor = mysql.connection.cursor()
        _ensure_phase5_tables(cursor)
        lifecycle_records = _run_booking_lifecycle_updates(cursor)
        mysql.connection.commit()

        cursor.execute(
            """
            SELECT b.user_id, b.slot_id, b.end_time, b.status, sl.station_id, sess.start_time
            FROM Booking b
            JOIN ChargingSlot sl ON sl.slot_id = b.slot_id
            LEFT JOIN ChargingSession sess ON sess.booking_id = b.booking_id
            WHERE b.booking_id = %s
            """,
            (booking_id,),
        )
        booking = cursor.fetchone()

        if not booking:
            return jsonify({"error": "Booking not found"}), 404
        if booking[0] != current_user["user_id"]:
            return jsonify({"error": "Unauthorized"}), 403

        status = _to_str(booking[3])
        if status != BOOKING_STATUS_WAITING_TO_START:
            return jsonify({"error": "Only waiting-to-start bookings can be cancelled"}), 409
        if booking[2] <= now:
            return jsonify({"error": "Booking already ended"}), 409
        if booking[5] is not None:
            return jsonify({"error": "Charging already started for this booking"}), 409

        cursor.execute(
            """
            UPDATE Booking
            SET status = 'cancelled'
            WHERE booking_id = %s
            """,
            (booking_id,),
        )
        slot_id = int(booking[1])
        station_id = int(booking[4] or 0)
        _refresh_single_slot_status(cursor, slot_id)
        mysql.connection.commit()
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception(
            "Failed to cancel booking_id=%s for user_id=%s",
            booking_id,
            current_user.get("user_id"),
        )
        return jsonify({"error": "Failed to cancel booking"}), 500
    finally:
        _close_cursor(cursor)

    _emit_lifecycle_updates(lifecycle_records)
    emit_booking_update(
        "booking_cancelled",
        station_id=station_id,
        slot_id=slot_id,
        booking_id=booking_id,
        status="cancelled",
    )

    return jsonify({"message": "Booking cancelled successfully"}), 200
