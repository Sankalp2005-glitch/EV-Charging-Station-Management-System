from flask import current_app, jsonify
from MySQLdb import OperationalError

from extensions import mysql
from routes.owner_bp import owner_bp
from routes.owner_common import clean_text
from services.booking_lifecycle import (
    emit_lifecycle_updates as _emit_lifecycle_updates,
    run_booking_lifecycle_updates as _run_booking_lifecycle_updates,
)
from services.db_errors import is_unknown_column_error as _is_unknown_column_error
from services.value_utils import (
    parse_positive_float as _parse_positive_float,
    to_str as _to_str,
)
from utils.jwt_handler import role_required, token_required
from utils.station_approval import (
    APPROVAL_STATUS_APPROVED,
    APPROVAL_STATUS_PENDING,
    backfill_missing_station_approvals,
    ensure_station_approval_table,
)


@owner_bp.route("/stations", methods=["GET"])
@token_required
@role_required("owner")
def get_owner_stations(current_user):
    cursor = None
    lifecycle_records = []

    try:
        cursor = mysql.connection.cursor()
        ensure_station_approval_table(cursor)
        backfill_missing_station_approvals(cursor, default_status=APPROVAL_STATUS_APPROVED)
        lifecycle_records = _run_booking_lifecycle_updates(cursor)
        mysql.connection.commit()
        cursor.execute(
            """
            SELECT
                cs.station_id,
                cs.station_name,
                cs.location,
                cs.contact_number,
                cs.total_slots,
                sa.status AS approval_status,
                SUM(CASE WHEN sl.slot_id IS NOT NULL AND active.slot_id IS NULL THEN 1 ELSE 0 END) AS available_slots,
                SUM(CASE WHEN sl.slot_id IS NOT NULL AND active.slot_id IS NOT NULL THEN 1 ELSE 0 END) AS occupied_slots
            FROM ChargingStation cs
            LEFT JOIN StationApproval sa ON sa.station_id = cs.station_id
            LEFT JOIN ChargingSlot sl ON sl.station_id = cs.station_id
            LEFT JOIN (
                SELECT DISTINCT slot_id
                FROM Booking
                WHERE status = 'confirmed'
                  AND start_time <= NOW()
                  AND end_time > NOW()
            ) active ON active.slot_id = sl.slot_id
            WHERE cs.user_id = %s
            GROUP BY cs.station_id, cs.station_name, cs.location, cs.contact_number, cs.total_slots, sa.status
            ORDER BY cs.station_name ASC
            """,
            (current_user["user_id"],),
        )
        stations = cursor.fetchall()
    except Exception:
        current_app.logger.exception(
            "Failed to fetch stations for owner user_id=%s",
            current_user.get("user_id"),
        )
        return jsonify({"error": "Failed to fetch stations"}), 500
    finally:
        if cursor:
            cursor.close()

    _emit_lifecycle_updates(lifecycle_records)

    result = []
    for station in stations:
        result.append(
            {
                "station_id": station[0],
                "station_name": station[1],
                "location": station[2],
                "contact_number": station[3],
                "total_slots": int(station[4] or 0),
                "approval_status": _to_str(station[5]) or APPROVAL_STATUS_PENDING,
                "available_slots": int(station[6] or 0),
                "occupied_slots": int(station[7] or 0),
            }
        )

    return jsonify(result), 200


@owner_bp.route("/stats", methods=["GET"])
@token_required
@role_required("owner")
def get_owner_stats(current_user):
    cursor = None
    lifecycle_records = []
    try:
        cursor = mysql.connection.cursor()
        lifecycle_records = _run_booking_lifecycle_updates(cursor)
        mysql.connection.commit()

        cursor.execute(
            """
            SELECT COUNT(*)
            FROM ChargingStation
            WHERE user_id = %s
            """,
            (current_user["user_id"],),
        )
        total_stations = int((cursor.fetchone() or [0])[0] or 0)

        cursor.execute(
            """
            SELECT COUNT(*)
            FROM ChargingSlot sl
            JOIN ChargingStation cs ON sl.station_id = cs.station_id
            WHERE cs.user_id = %s
            """,
            (current_user["user_id"],),
        )
        total_slots = int((cursor.fetchone() or [0])[0] or 0)

        cursor.execute(
            """
            SELECT
                COUNT(*) AS total_bookings,
                SUM(
                    CASE
                        WHEN b.status = 'confirmed'
                         AND b.start_time <= NOW()
                         AND b.end_time > NOW()
                        THEN 1 ELSE 0
                    END
                ) AS active_bookings
            FROM Booking b
            JOIN ChargingSlot sl ON b.slot_id = sl.slot_id
            JOIN ChargingStation cs ON sl.station_id = cs.station_id
            WHERE cs.user_id = %s
            """,
            (current_user["user_id"],),
        )
        booking_stats = cursor.fetchone() or (0, 0)
        total_bookings = int(booking_stats[0] or 0)
        active_bookings = int(booking_stats[1] or 0)

        revenue_estimate_supported = True
        estimated_revenue = 0.0
        try:
            cursor.execute(
                """
                SELECT
                    SUM(
                        CASE
                            WHEN b.status IN ('confirmed', 'completed')
                            THEN
                                CASE
                                    WHEN sl.price_per_minute IS NOT NULL AND sl.price_per_minute > 0
                                    THEN TIMESTAMPDIFF(MINUTE, b.start_time, b.end_time) * sl.price_per_minute
                                    ELSE
                                        (
                                            TIMESTAMPDIFF(MINUTE, b.start_time, b.end_time) / 60.0
                                        ) * COALESCE(
                                            sl.power_kw,
                                            CASE WHEN sl.slot_type = 'fast' THEN 50.0 ELSE 7.0 END
                                        ) * COALESCE(
                                            sl.price_per_kwh,
                                            CASE WHEN sl.slot_type = 'fast' THEN 18.0 ELSE 12.0 END
                                        )
                                END
                            ELSE 0
                        END
                    ) AS estimated_revenue
                FROM Booking b
                JOIN ChargingSlot sl ON b.slot_id = sl.slot_id
                JOIN ChargingStation cs ON sl.station_id = cs.station_id
                WHERE cs.user_id = %s
                """,
                (current_user["user_id"],),
            )
            estimated_revenue = float((cursor.fetchone() or [0])[0] or 0.0)
        except OperationalError as error:
            if not _is_unknown_column_error(error):
                raise
            revenue_estimate_supported = False
            estimated_revenue = 0.0

        cursor.execute(
            """
            SELECT
                sl.slot_id,
                sl.slot_number,
                sl.slot_type,
                cs.station_id,
                cs.station_name,
                COUNT(b.booking_id) AS usage_count
            FROM ChargingSlot sl
            JOIN ChargingStation cs ON sl.station_id = cs.station_id
            LEFT JOIN Booking b ON b.slot_id = sl.slot_id
            WHERE cs.user_id = %s
            GROUP BY sl.slot_id, sl.slot_number, sl.slot_type, cs.station_id, cs.station_name
            ORDER BY usage_count DESC, cs.station_name ASC, sl.slot_number ASC
            LIMIT 1
            """,
            (current_user["user_id"],),
        )
        most_used_row = cursor.fetchone()
        most_used_slot = None
        if most_used_row and int(most_used_row[5] or 0) > 0:
            most_used_slot = {
                "slot_id": int(most_used_row[0]),
                "slot_number": int(most_used_row[1] or 0),
                "slot_type": _to_str(most_used_row[2]),
                "station_id": int(most_used_row[3]),
                "station_name": _to_str(most_used_row[4]),
                "usage_count": int(most_used_row[5] or 0),
            }
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception(
            "Failed to fetch owner stats for user_id=%s",
            current_user.get("user_id"),
        )
        return jsonify({"error": "Failed to fetch owner stats"}), 500
    finally:
        if cursor:
            cursor.close()

    _emit_lifecycle_updates(lifecycle_records)

    return jsonify(
        {
            "total_stations": total_stations,
            "total_slots": total_slots,
            "total_bookings": total_bookings,
            "active_bookings": active_bookings,
            "total_revenue": round(estimated_revenue, 2),
            "revenue_estimate_supported": revenue_estimate_supported,
            "most_used_slot": most_used_slot,
        }
    ), 200


@owner_bp.route("/stations/<int:station_id>/slots", methods=["GET"])
@token_required
@role_required("owner")
def get_owner_station_slots(current_user, station_id):
    cursor = None

    try:
        cursor = mysql.connection.cursor()
        cursor.execute(
            """
            SELECT station_id
            FROM ChargingStation
            WHERE station_id = %s AND user_id = %s
            LIMIT 1
            """,
            (station_id, current_user["user_id"]),
        )
        station = cursor.fetchone()
        if not station:
            return jsonify({"error": "Station not found"}), 404

        try:
            cursor.execute(
                """
                SELECT
                    slot_id,
                    slot_number,
                    slot_type,
                    status,
                    power_kw,
                    price_per_kwh,
                    price_per_minute
                FROM ChargingSlot
                WHERE station_id = %s
                ORDER BY slot_number ASC
                """,
                (station_id,),
            )
            slots = cursor.fetchall()
            has_pricing_columns = True
        except OperationalError as error:
            if not _is_unknown_column_error(error):
                raise
            cursor.execute(
                """
                SELECT slot_id, slot_number, slot_type, status
                FROM ChargingSlot
                WHERE station_id = %s
                ORDER BY slot_number ASC
                """,
                (station_id,),
            )
            slots = cursor.fetchall()
            has_pricing_columns = False
    except Exception:
        current_app.logger.exception(
            "Failed to fetch slots for station_id=%s owner_user_id=%s",
            station_id,
            current_user.get("user_id"),
        )
        return jsonify({"error": "Failed to fetch station slots"}), 500
    finally:
        if cursor:
            cursor.close()

    result = []
    for row in slots:
        slot_type = clean_text(_to_str(row[2])).lower()
        item = {
            "slot_id": row[0],
            "slot_number": int(row[1] or 0),
            "slot_type": slot_type,
            "status": _to_str(row[3]),
        }
        if has_pricing_columns:
            power_kw = _parse_positive_float(row[4])
            price_per_kwh = _parse_positive_float(row[5])
            price_per_minute = _parse_positive_float(row[6])
            item["power_kw"] = round(power_kw, 2) if power_kw is not None else None
            item["price_per_kwh"] = round(price_per_kwh, 2) if price_per_kwh is not None else None
            item["price_per_minute"] = (
                round(price_per_minute, 2) if price_per_minute is not None else None
            )
        else:
            item["power_kw"] = None
            item["price_per_kwh"] = None
            item["price_per_minute"] = None
        result.append(item)

    return jsonify(result), 200
