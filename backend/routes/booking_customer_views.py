from datetime import datetime

from flask import current_app, jsonify, request

from extensions import mysql
from routes.booking_bp import booking_bp
from services.booking_lifecycle import (
    emit_lifecycle_updates as _emit_lifecycle_updates,
    refresh_single_slot_status as _refresh_single_slot_status,
    run_booking_lifecycle_updates as _run_booking_lifecycle_updates,
)
from services.booking_schema import ensure_phase5_tables as _ensure_phase5_tables
from services.value_utils import (
    close_cursor as _close_cursor,
    format_dt as _format_dt,
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

    if not view:
        view = "all" if include_history else "upcoming"
    if view not in {"upcoming", "past", "all"}:
        return jsonify({"error": "view must be one of: upcoming, past, all"}), 400

    now = datetime.now()
    lifecycle_records = []

    try:
        cursor = mysql.connection.cursor()
        _ensure_phase5_tables(cursor)
        lifecycle_records = _run_booking_lifecycle_updates(cursor)
        mysql.connection.commit()

        query = """
            SELECT
                b.booking_id,
                b.slot_id,
                cs.station_name,
                cs.location,
                sl.slot_number,
                sl.slot_type,
                b.start_time,
                b.end_time,
                b.status,
                p.payment_status,
                p.payment_method,
                sess.start_time AS charging_started_at
            FROM Booking b
            JOIN ChargingSlot sl ON b.slot_id = sl.slot_id
            JOIN ChargingStation cs ON sl.station_id = cs.station_id
            LEFT JOIN Payment p ON p.booking_id = b.booking_id
            LEFT JOIN ChargingSession sess ON sess.booking_id = b.booking_id
            WHERE b.user_id = %s
        """
        params = [current_user["user_id"]]

        if view == "upcoming":
            query += " AND b.status = 'confirmed' AND b.end_time >= NOW()"
        elif view == "past":
            query += " AND (b.status IN ('completed', 'cancelled') OR b.end_time < NOW())"

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
        duration_minutes = int((row[7] - row[6]).total_seconds() // 60)
        status = _to_str(row[8])
        payment_status = (_to_str(row[9]) or "pending").lower()
        payment_method = (_to_str(row[10]) or "").lower() or None
        charging_started_at = row[11]
        can_cancel = status == "confirmed" and row[7] > now and charging_started_at is None
        is_future_booking = row[6] >= now
        can_show_qr = status == "confirmed" and row[7] > now and payment_status == "paid"
        can_start_charging = can_show_qr and charging_started_at is None

        result.append(
            {
                "booking_id": row[0],
                "slot_id": row[1],
                "station_name": _to_str(row[2]),
                "location": _to_str(row[3]),
                "slot_number": row[4],
                "slot_type": _to_str(row[5]),
                "start_time": _format_dt(row[6]),
                "end_time": _format_dt(row[7]),
                "duration_minutes": duration_minutes,
                "status": status,
                "can_cancel": can_cancel,
                "is_future_booking": is_future_booking,
                "payment_status": payment_status,
                "payment_method": payment_method,
                "charging_started_at": _format_dt(charging_started_at),
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
        if status != "confirmed":
            return jsonify({"error": "Only confirmed bookings can be cancelled"}), 409
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
