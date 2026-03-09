from datetime import datetime

from flask import current_app, jsonify, request

from extensions import mysql
from routes.booking_bp import booking_bp
from services.booking_config import (
    DEFAULT_POWER_KW_BY_SLOT_TYPE,
    DEFAULT_PRICE_PER_KWH_BY_SLOT_TYPE,
)
from services.booking_lifecycle import (
    emit_lifecycle_updates as _emit_lifecycle_updates,
    run_booking_lifecycle_updates as _run_booking_lifecycle_updates,
)
from services.booking_schema import ensure_phase5_tables as _ensure_phase5_tables
from services.slot_repository import fetch_station_slots_with_pricing as _fetch_station_slots_with_pricing
from services.value_utils import (
    close_cursor as _close_cursor,
    format_dt as _format_dt,
    to_str as _to_str,
)
from utils.jwt_handler import token_required
from utils.station_approval import (
    APPROVAL_STATUS_APPROVED,
    backfill_missing_station_approvals,
    ensure_station_approval_table,
)


@booking_bp.route("/stations", methods=["GET"])
@token_required
def get_stations(_current_user):
    location_filter = (request.args.get("location") or "").strip().lower()
    slot_type_filter = (request.args.get("slot_type") or "").strip().lower()
    if slot_type_filter and slot_type_filter not in {"fast", "normal"}:
        return jsonify({"error": "slot_type must be 'fast' or 'normal'"}), 400

    cursor = None
    lifecycle_records = []
    try:
        cursor = mysql.connection.cursor()
        _ensure_phase5_tables(cursor)
        ensure_station_approval_table(cursor)
        backfill_missing_station_approvals(cursor)
        lifecycle_records = _run_booking_lifecycle_updates(cursor)
        mysql.connection.commit()

        query = """
            SELECT
                cs.station_id,
                cs.station_name,
                cs.location,
                cs.total_slots,
                COUNT(sl.slot_id) AS matching_slots,
                SUM(CASE WHEN sl.status = 'available' THEN 1 ELSE 0 END) AS available_slots,
                SUM(CASE WHEN sl.status = 'occupied' THEN 1 ELSE 0 END) AS occupied_slots
            FROM ChargingStation cs
            JOIN StationApproval sa ON sa.station_id = cs.station_id
            LEFT JOIN ChargingSlot sl ON cs.station_id = sl.station_id
            WHERE sa.status = %s
        """
        params = [APPROVAL_STATUS_APPROVED]

        if location_filter:
            query += " AND LOWER(cs.location) LIKE %s"
            params.append(f"%{location_filter}%")
        if slot_type_filter:
            query += " AND sl.slot_type = %s"
            params.append(slot_type_filter)

        query += """
            GROUP BY cs.station_id, cs.station_name, cs.location, cs.total_slots
            ORDER BY cs.station_name ASC
        """
        cursor.execute(query, tuple(params))
        stations = cursor.fetchall()
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception("Failed to fetch charging stations")
        return jsonify({"error": "Failed to fetch stations"}), 500
    finally:
        _close_cursor(cursor)

    _emit_lifecycle_updates(lifecycle_records)

    result = []
    for station in stations:
        matching_slots = int(station[4] or 0)
        available_slots = int(station[5] or 0)
        occupied_slots = int(station[6] or 0)

        if matching_slots == 0:
            availability_status = "no-compatible-slots"
        elif available_slots > 0:
            availability_status = "available"
        else:
            availability_status = "busy"

        result.append(
            {
                "station_id": station[0],
                "station_name": _to_str(station[1]),
                "location": _to_str(station[2]),
                "total_slots": int(station[3] or 0),
                "matching_slots": matching_slots,
                "available_slots": available_slots,
                "occupied_slots": occupied_slots,
                "availability_status": availability_status,
            }
        )

    return jsonify(result), 200


@booking_bp.route("/stations/<int:station_id>/slots", methods=["GET"])
@token_required
def get_slots(current_user, station_id):
    cursor = None
    now = datetime.now()
    lifecycle_records = []

    try:
        cursor = mysql.connection.cursor()
        _ensure_phase5_tables(cursor)
        ensure_station_approval_table(cursor)
        backfill_missing_station_approvals(cursor)
        lifecycle_records = _run_booking_lifecycle_updates(cursor)
        mysql.connection.commit()

        cursor.execute(
            """
            SELECT cs.station_id, cs.station_name, cs.user_id, sa.status
            FROM ChargingStation cs
            JOIN StationApproval sa ON sa.station_id = cs.station_id
            WHERE cs.station_id = %s
            """,
            (station_id,),
        )
        station = cursor.fetchone()
        if not station:
            return jsonify({"error": "Station not found"}), 404

        station_owner_id = int(station[2] or 0)
        approval_status = _to_str(station[3])
        is_admin = current_user.get("role") == "admin"
        is_owner_of_station = (
            current_user.get("role") == "owner"
            and int(current_user.get("user_id") or 0) == station_owner_id
        )
        if approval_status != APPROVAL_STATUS_APPROVED and not (is_admin or is_owner_of_station):
            return jsonify({"error": "Station is pending admin approval"}), 403

        slots = _fetch_station_slots_with_pricing(cursor, station_id)

        result = []
        for slot in slots:
            slot_id = slot["slot_id"]
            cursor.execute(
                """
                SELECT booking_id, start_time, end_time
                FROM Booking
                WHERE slot_id = %s
                  AND status = 'confirmed'
                  AND end_time > NOW()
                ORDER BY start_time ASC
                LIMIT 5
                """,
                (slot_id,),
            )
            bookings = cursor.fetchall()

            booking_list = []
            active_booking = None
            for booking in bookings:
                booking_item = {
                    "booking_id": booking[0],
                    "start_time": _format_dt(booking[1]),
                    "end_time": _format_dt(booking[2]),
                }
                booking_list.append(booking_item)

                if booking[1] <= now < booking[2]:
                    active_booking = booking_item

            parsed_power_kw = slot["power_kw"]
            parsed_price_per_kwh = slot["price_per_kwh"]
            parsed_price_per_minute = slot["price_per_minute"]
            slot_type = slot["slot_type"]

            if parsed_price_per_kwh is None and parsed_price_per_minute is None:
                parsed_price_per_kwh = DEFAULT_PRICE_PER_KWH_BY_SLOT_TYPE.get(slot_type, 12.0)

            result.append(
                {
                    "slot_id": slot_id,
                    "slot_number": slot["slot_number"],
                    "slot_type": slot_type,
                    "current_status": "occupied" if active_booking else "available",
                    "status": slot["status"],
                    "power_kw": round(
                        parsed_power_kw or DEFAULT_POWER_KW_BY_SLOT_TYPE.get(slot_type, 7.0),
                        2,
                    ),
                    "price_per_kwh": (
                        round(parsed_price_per_kwh, 2)
                        if parsed_price_per_kwh
                        else None
                    ),
                    "price_per_minute": (
                        round(parsed_price_per_minute, 2)
                        if parsed_price_per_minute
                        else None
                    ),
                    "is_available_now": active_booking is None,
                    "active_booking": active_booking,
                    "bookings": booking_list,
                }
            )
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception("Failed to fetch slots for station_id=%s", station_id)
        return jsonify({"error": "Failed to fetch slots"}), 500
    finally:
        _close_cursor(cursor)

    _emit_lifecycle_updates(lifecycle_records)
    return jsonify(result), 200
