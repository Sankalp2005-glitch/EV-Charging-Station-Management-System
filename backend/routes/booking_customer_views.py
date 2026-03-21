from datetime import datetime

from flask import current_app, jsonify, request

from extensions import mysql
from routes.booking_bp import booking_bp
from services.booking_config import BOOKING_STATUS_WAITING_TO_START
from services.charging_profiles import build_live_charging_snapshot, format_duration_human
from services.booking_lifecycle import (
    emit_lifecycle_updates as _emit_lifecycle_updates,
    refresh_single_slot_status as _refresh_single_slot_status,
    run_booking_lifecycle_updates as _run_booking_lifecycle_updates,
)
from services.booking_schema import ensure_phase5_tables as _ensure_phase5_tables
from services.value_utils import (
    close_cursor as _close_cursor,
    ensure_station_geo_columns,
    format_dt as _format_dt,
    haversine_distance_km,
    normalize_coordinate_pair,
    parse_geo_filters,
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
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception(
            "Failed to fetch bookings for user_id=%s", current_user.get("user_id")
        )
        return jsonify({"error": "Failed to fetch bookings"}), 500
    finally:
        _close_cursor(cursor)

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
        is_future_booking = row[10] >= now
        can_show_qr = status == BOOKING_STATUS_WAITING_TO_START and row[11] > now and payment_status == "paid"
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
