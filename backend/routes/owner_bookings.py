from datetime import datetime

from flask import Blueprint, current_app, jsonify, request

from extensions import mysql
from services.booking_config import BOOKING_STATUS_WAITING_TO_START
from services.booking_mutations import is_booking_ready_for_qr_verification
from services.charging_profiles import build_live_charging_snapshot, format_duration_human
from services.booking_lifecycle import (
    emit_lifecycle_updates as _emit_lifecycle_updates,
    refresh_single_slot_status as _refresh_single_slot_status,
    run_booking_lifecycle_updates as _run_booking_lifecycle_updates,
)
from services.booking_schema import ensure_phase5_tables as _ensure_phase5_tables
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
        _ensure_phase5_tables(cursor)
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
                    WHEN sl.status = 'out_of_service' THEN 'out_of_service'
                    WHEN EXISTS (
                        SELECT 1
                        FROM Booking b2
                        JOIN ChargingSession sess2 ON sess2.booking_id = b2.booking_id
                        WHERE b2.slot_id = sl.slot_id
                          AND b2.status IN ('charging_started', 'confirmed')
                          AND sess2.start_time IS NOT NULL
                          AND b2.start_time <= NOW()
                          AND b2.end_time > NOW()
                    ) THEN 'charging'
                    WHEN EXISTS (
                        SELECT 1
                        FROM Booking b2
                        LEFT JOIN ChargingSession sess2 ON sess2.booking_id = b2.booking_id
                        WHERE b2.slot_id = sl.slot_id
                          AND b2.status IN ('waiting_to_start', 'confirmed')
                          AND sess2.start_time IS NULL
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
                p.payment_status,
                p.payment_method,
                b.start_time,
                b.end_time,
                b.status,
                sess.start_time
            FROM Booking b
            JOIN ChargingSlot sl ON b.slot_id = sl.slot_id
            JOIN Users u ON b.user_id = u.user_id
            LEFT JOIN Payment p ON p.booking_id = b.booking_id
            LEFT JOIN ChargingSession sess ON sess.booking_id = b.booking_id
            WHERE sl.station_id = %s
        """
        params = [station_id]

        if view == "upcoming":
            query += " AND b.status IN ('waiting_to_start', 'charging_started', 'confirmed') AND b.end_time >= NOW()"
        elif view == "past":
            query += " AND (b.status IN ('charging_completed', 'cancelled', 'completed') OR b.end_time < NOW())"

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
        status = _to_str(row[11])
        payment_status = (_to_str(row[7]) or "pending").lower()
        payment_method = (_to_str(row[8]) or "").lower() or None
        charging_started_at = row[12]
        slot_item = slots_map.get(int(row[1]))
        if not slot_item:
            continue

        is_active = status in {"waiting_to_start", "charging_started", "confirmed"} and row[9] <= now < row[10]
        can_cancel = status == BOOKING_STATUS_WAITING_TO_START and row[10] > now and charging_started_at is None
        can_verify_qr = is_booking_ready_for_qr_verification(
            status,
            row[9],
            row[10],
            payment_method,
            payment_status,
            charging_started_at=charging_started_at,
            now=now,
        )

        slot_item["bookings"].append(
            {
                "booking_id": int(row[0]),
                "slot_id": int(row[1]),
                "slot_number": int(row[2] or 0),
                "slot_type": _to_str(row[3]),
                "customer_id": int(row[4]),
                "customer_name": _to_str(row[5]),
                "customer_email": _to_str(row[6]),
                "is_owner_booking": int(row[4]) == int(current_user["user_id"]),
                "payment_status": payment_status,
                "start_time": _format_dt(row[9]),
                "end_time": _format_dt(row[10]),
                "status": status,
                "is_active": is_active,
                "can_cancel": can_cancel,
                "can_verify_qr": can_verify_qr,
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
        _ensure_phase5_tables(cursor)
        lifecycle_records = _run_booking_lifecycle_updates(cursor)
        mysql.connection.commit()

        query = """
            SELECT
                b.booking_id,
                b.user_id,
                u.name,
                u.email,
                p.payment_status,
                p.payment_method,
                cs.station_id,
                cs.station_name,
                cs.user_id AS station_owner_id,
                sl.slot_id,
                sl.slot_number,
                sl.slot_type,
                sl.charger_name,
                sl.vehicle_category,
                b.start_time,
                b.end_time,
                b.status,
                sess.start_time,
                sess.end_time,
                b.estimated_duration_minutes,
                b.battery_capacity_kwh,
                b.current_battery_percent,
                b.target_battery_percent,
                b.energy_required_kwh,
                sl.power_kw
            FROM Booking b
            JOIN ChargingSlot sl ON b.slot_id = sl.slot_id
            JOIN ChargingStation cs ON sl.station_id = cs.station_id
            JOIN Users u ON b.user_id = u.user_id
            LEFT JOIN Payment p ON p.booking_id = b.booking_id
            LEFT JOIN ChargingSession sess ON sess.booking_id = b.booking_id
            WHERE (cs.user_id = %s OR b.user_id = %s)
        """
        params = [current_user["user_id"], current_user["user_id"]]

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
        status = _to_str(row[16])
        payment_status = (_to_str(row[4]) or "pending").lower()
        payment_method = (_to_str(row[5]) or "").lower() or None
        is_managed_station = int(row[8] or 0) == int(current_user["user_id"])
        charging_started_at = row[17]
        charging_completed_at = row[18]
        duration_minutes = int(row[19] or max(int((row[15] - row[14]).total_seconds() // 60), 0))
        battery_capacity_kwh = float(row[20]) if row[20] is not None else None
        current_battery_percent = float(row[21]) if row[21] is not None else None
        target_battery_percent = float(row[22]) if row[22] is not None else None
        energy_required_kwh = float(row[23]) if row[23] is not None else None
        charger_power_kw = float(row[24]) if row[24] is not None else None
        can_cancel = status == BOOKING_STATUS_WAITING_TO_START and row[15] > now and charging_started_at is None
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
                "customer_id": row[1],
                "customer_name": _to_str(row[2]),
                "customer_email": _to_str(row[3]),
                "is_owner_booking": int(row[1]) == int(current_user["user_id"]),
                "is_managed_station": is_managed_station,
                "payment_status": payment_status,
                "station_id": row[6],
                "station_name": _to_str(row[7]),
                "slot_id": row[9],
                "slot_number": row[10],
                "slot_type": _to_str(row[11]),
                "charger_name": _to_str(row[12]),
                "vehicle_category": _to_str(row[13]),
                "start_time": row[14].strftime("%Y-%m-%d %H:%M:%S"),
                "end_time": row[15].strftime("%Y-%m-%d %H:%M:%S"),
                "duration_minutes": duration_minutes,
                "duration_display": format_duration_human(duration_minutes),
                "status": status,
                "can_cancel": can_cancel,
                "can_verify_qr": is_managed_station and is_booking_ready_for_qr_verification(
                    status,
                    row[14],
                    row[15],
                    payment_method,
                    payment_status,
                    charging_started_at=charging_started_at,
                    now=now,
                ),
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
        _ensure_phase5_tables(cursor)
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
        if _to_str(booking[2]) != BOOKING_STATUS_WAITING_TO_START:
            return jsonify({"error": "Only waiting-to-start bookings can be cancelled"}), 409
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
