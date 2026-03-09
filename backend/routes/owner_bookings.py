from datetime import datetime

from flask import Blueprint, current_app, jsonify, request

from extensions import mysql
from services.booking_lifecycle import (
    emit_lifecycle_updates as _emit_lifecycle_updates,
    refresh_single_slot_status as _refresh_single_slot_status,
    run_booking_lifecycle_updates as _run_booking_lifecycle_updates,
)
from services.value_utils import format_dt as _format_dt, to_str as _to_str
from utils.jwt_handler import role_required, token_required
from utils.realtime_events import emit_booking_update

owner_bookings_bp = Blueprint("owner_bookings", __name__, url_prefix="/api/owner")


@owner_bookings_bp.route("/stations/<int:station_id>/bookings", methods=["GET"])
@token_required
@role_required("owner")
def get_owner_station_bookings(current_user, station_id):
    view = (request.args.get("view") or "upcoming").strip().lower()
    if view not in {"upcoming", "past", "all"}:
        return jsonify({"error": "view must be one of: upcoming, past, all"}), 400

    cursor = None
    now = datetime.now()
    lifecycle_records = []
    try:
        cursor = mysql.connection.cursor()
        lifecycle_records = _run_booking_lifecycle_updates(cursor)
        mysql.connection.commit()

        cursor.execute(
            """
            SELECT station_id, station_name
            FROM ChargingStation
            WHERE station_id = %s AND user_id = %s
            LIMIT 1
            """,
            (station_id, current_user["user_id"]),
        )
        station = cursor.fetchone()
        if not station:
            return jsonify({"error": "Station not found"}), 404

        cursor.execute(
            """
            SELECT
                sl.slot_id,
                sl.slot_number,
                sl.slot_type,
                CASE
                    WHEN EXISTS (
                        SELECT 1
                        FROM Booking b2
                        WHERE b2.slot_id = sl.slot_id
                          AND b2.status = 'confirmed'
                          AND b2.start_time <= NOW()
                          AND b2.end_time > NOW()
                    ) THEN 'occupied'
                    ELSE 'available'
                END AS current_status
            FROM ChargingSlot sl
            WHERE sl.station_id = %s
            ORDER BY sl.slot_number ASC
            """,
            (station_id,),
        )
        slots = cursor.fetchall()

        query = """
            SELECT
                b.booking_id,
                b.slot_id,
                sl.slot_number,
                sl.slot_type,
                u.user_id,
                u.name,
                u.email,
                b.start_time,
                b.end_time,
                b.status,
                sess.start_time
            FROM Booking b
            JOIN ChargingSlot sl ON b.slot_id = sl.slot_id
            JOIN Users u ON b.user_id = u.user_id
            LEFT JOIN ChargingSession sess ON sess.booking_id = b.booking_id
            WHERE sl.station_id = %s
        """
        params = [station_id]

        if view == "upcoming":
            query += " AND b.status = 'confirmed' AND b.end_time >= NOW()"
        elif view == "past":
            query += " AND (b.status IN ('completed', 'cancelled') OR b.end_time < NOW())"

        if view == "past":
            query += " ORDER BY sl.slot_number ASC, b.start_time DESC"
        else:
            query += " ORDER BY sl.slot_number ASC, b.start_time ASC"

        cursor.execute(query, tuple(params))
        bookings = cursor.fetchall()
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception(
            "Failed to fetch station bookings for station_id=%s owner_user_id=%s",
            station_id,
            current_user.get("user_id"),
        )
        return jsonify({"error": "Failed to fetch station bookings"}), 500
    finally:
        if cursor:
            cursor.close()

    _emit_lifecycle_updates(lifecycle_records)

    slots_map = {}
    ordered_slots = []
    for slot in slots:
        slot_item = {
            "slot_id": int(slot[0]),
            "slot_number": int(slot[1] or 0),
            "slot_type": _to_str(slot[2]),
            "current_status": _to_str(slot[3]),
            "bookings": [],
        }
        slots_map[slot_item["slot_id"]] = slot_item
        ordered_slots.append(slot_item)

    for row in bookings:
        status = _to_str(row[9])
        charging_started_at = row[10]
        slot_item = slots_map.get(int(row[1]))
        if not slot_item:
            continue

        is_active = status == "confirmed" and row[7] <= now < row[8]
        can_cancel = status == "confirmed" and row[8] > now and charging_started_at is None

        slot_item["bookings"].append(
            {
                "booking_id": int(row[0]),
                "slot_id": int(row[1]),
                "slot_number": int(row[2] or 0),
                "slot_type": _to_str(row[3]),
                "customer_id": int(row[4]),
                "customer_name": _to_str(row[5]),
                "customer_email": _to_str(row[6]),
                "start_time": _format_dt(row[7]),
                "end_time": _format_dt(row[8]),
                "status": status,
                "is_active": is_active,
                "can_cancel": can_cancel,
                "charging_started_at": _format_dt(charging_started_at),
            }
        )

    return jsonify(
        {
            "station_id": int(station[0]),
            "station_name": _to_str(station[1]),
            "view": view,
            "slots": ordered_slots,
        }
    ), 200


@owner_bookings_bp.route("/bookings", methods=["GET"])
@token_required
@role_required("owner")
def get_owner_bookings(current_user):
    view = (request.args.get("view") or "upcoming").strip().lower()
    if view not in {"upcoming", "past", "all"}:
        return jsonify({"error": "view must be one of: upcoming, past, all"}), 400

    cursor = None
    now = datetime.now()
    lifecycle_records = []

    try:
        cursor = mysql.connection.cursor()
        lifecycle_records = _run_booking_lifecycle_updates(cursor)
        mysql.connection.commit()

        query = """
            SELECT
                b.booking_id,
                b.user_id,
                u.name,
                u.email,
                cs.station_id,
                cs.station_name,
                sl.slot_id,
                sl.slot_number,
                sl.slot_type,
                b.start_time,
                b.end_time,
                b.status,
                sess.start_time
            FROM Booking b
            JOIN ChargingSlot sl ON b.slot_id = sl.slot_id
            JOIN ChargingStation cs ON sl.station_id = cs.station_id
            JOIN Users u ON b.user_id = u.user_id
            LEFT JOIN ChargingSession sess ON sess.booking_id = b.booking_id
            WHERE cs.user_id = %s
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
            "Failed to fetch bookings for owner user_id=%s",
            current_user.get("user_id"),
        )
        return jsonify({"error": "Failed to fetch owner bookings"}), 500
    finally:
        if cursor:
            cursor.close()

    _emit_lifecycle_updates(lifecycle_records)

    result = []
    for row in bookings:
        status = _to_str(row[11])
        charging_started_at = row[12]
        can_cancel = status == "confirmed" and row[10] > now and charging_started_at is None
        result.append(
            {
                "booking_id": row[0],
                "customer_id": row[1],
                "customer_name": _to_str(row[2]),
                "customer_email": _to_str(row[3]),
                "station_id": row[4],
                "station_name": _to_str(row[5]),
                "slot_id": row[6],
                "slot_number": row[7],
                "slot_type": _to_str(row[8]),
                "start_time": row[9].strftime("%Y-%m-%d %H:%M:%S"),
                "end_time": row[10].strftime("%Y-%m-%d %H:%M:%S"),
                "status": status,
                "can_cancel": can_cancel,
                "charging_started_at": _format_dt(charging_started_at),
            }
        )

    return jsonify(result), 200


@owner_bookings_bp.route("/cancel-booking/<int:booking_id>", methods=["PUT"])
@token_required
@role_required("owner")
def cancel_owner_booking(current_user, booking_id):
    cursor = None
    now = datetime.now()
    lifecycle_records = []
    station_id = None
    slot_id = None

    try:
        cursor = mysql.connection.cursor()
        lifecycle_records = _run_booking_lifecycle_updates(cursor)
        mysql.connection.commit()

        cursor.execute(
            """
            SELECT
                b.booking_id,
                b.slot_id,
                b.status,
                b.end_time,
                cs.station_id,
                sess.start_time
            FROM Booking b
            JOIN ChargingSlot sl ON b.slot_id = sl.slot_id
            JOIN ChargingStation cs ON sl.station_id = cs.station_id
            LEFT JOIN ChargingSession sess ON sess.booking_id = b.booking_id
            WHERE b.booking_id = %s
              AND cs.user_id = %s
            """,
            (booking_id, current_user["user_id"]),
        )
        booking = cursor.fetchone()

        if not booking:
            return jsonify({"error": "Booking not found"}), 404
        if _to_str(booking[2]) != "confirmed":
            return jsonify({"error": "Only confirmed bookings can be cancelled"}), 409
        if booking[3] <= now:
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
            "Failed to cancel booking_id=%s by owner user_id=%s",
            booking_id,
            current_user.get("user_id"),
        )
        return jsonify({"error": "Failed to cancel booking"}), 500
    finally:
        if cursor:
            cursor.close()

    _emit_lifecycle_updates(lifecycle_records)
    emit_booking_update(
        "booking_cancelled",
        station_id=station_id,
        slot_id=slot_id,
        booking_id=booking_id,
        status="cancelled",
    )

    return jsonify({"message": "Booking cancelled successfully"}), 200
