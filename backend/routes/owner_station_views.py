from flask import current_app, jsonify

from extensions import mysql
from routes.owner_bp import owner_bp
from routes.owner_common import clean_text
from services.booking_config import (
    BOOKING_STATUS_CHARGING_COMPLETED,
    BOOKING_STATUS_CHARGING_STARTED,
    LEGACY_BOOKING_STATUS_COMPLETED,
    LEGACY_BOOKING_STATUS_CONFIRMED,
)
from services.booking_lifecycle import (
    emit_lifecycle_updates as _emit_lifecycle_updates,
    run_booking_lifecycle_updates as _run_booking_lifecycle_updates,
)
from services.booking_schema import ensure_phase5_tables as _ensure_phase5_tables
from services.revenue_analytics import fetch_revenue_analytics as _fetch_revenue_analytics
from services.value_utils import (
    ensure_station_geo_columns,
    normalize_coordinate_pair,
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
        _ensure_phase5_tables(cursor)
        ensure_station_geo_columns(cursor)
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
                cs.latitude,
                cs.longitude,
                sa.status AS approval_status,
                SUM(CASE WHEN sl.status = 'available' THEN 1 ELSE 0 END) AS available_slots,
                SUM(CASE WHEN sl.status = 'occupied' THEN 1 ELSE 0 END) AS occupied_slots,
                SUM(CASE WHEN sl.status = 'charging' THEN 1 ELSE 0 END) AS charging_slots,
                SUM(CASE WHEN sl.status = 'out_of_service' THEN 1 ELSE 0 END) AS out_of_service_slots
            FROM ChargingStation cs
            LEFT JOIN StationApproval sa ON sa.station_id = cs.station_id
            LEFT JOIN ChargingSlot sl ON sl.station_id = cs.station_id
            WHERE cs.user_id = %s
            GROUP BY cs.station_id, cs.station_name, cs.location, cs.contact_number, cs.total_slots, cs.latitude, cs.longitude, sa.status
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
        latitude, longitude = normalize_coordinate_pair(station[5], station[6])
        result.append(
            {
                "station_id": station[0],
                "station_name": station[1],
                "location": station[2],
                "contact_number": station[3],
                "total_slots": int(station[4] or 0),
                "latitude": latitude,
                "longitude": longitude,
                "approval_status": _to_str(station[7]) or APPROVAL_STATUS_PENDING,
                "available_slots": int(station[8] or 0),
                "occupied_slots": int(station[9] or 0),
                "charging_slots": int(station[10] or 0),
                "out_of_service_slots": int(station[11] or 0),
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
        _ensure_phase5_tables(cursor)
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
                        WHEN b.status = %s
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
            (BOOKING_STATUS_CHARGING_STARTED, current_user["user_id"]),
        )
        booking_stats = cursor.fetchone() or (0, 0)
        total_bookings = int(booking_stats[0] or 0)
        active_bookings = int(booking_stats[1] or 0)

        revenue_analytics = _fetch_revenue_analytics(cursor, owner_user_id=current_user["user_id"])
        estimated_revenue = float(revenue_analytics["summary"]["total_revenue"] or 0.0)
        revenue_estimate_supported = True

        cursor.execute(
            """
            SELECT
                SUM(
                    COALESCE(sl.power_kw, 0) * (
                        GREATEST(
                            TIMESTAMPDIFF(
                                MINUTE,
                                sess.start_time,
                                CASE
                                    WHEN b.status IN (%s, %s) THEN COALESCE(sess.end_time, b.end_time)
                                    ELSE NOW()
                                END
                            ),
                            0
                        ) / 60
                    )
                ) AS energy_kwh
            FROM Booking b
            JOIN ChargingSlot sl ON b.slot_id = sl.slot_id
            JOIN ChargingStation cs ON sl.station_id = cs.station_id
            JOIN ChargingSession sess ON sess.booking_id = b.booking_id
            WHERE cs.user_id = %s
              AND sess.start_time IS NOT NULL
              AND DATE(sess.start_time) = CURDATE()
              AND b.status IN (%s, %s, %s, %s)
            """,
            (
                BOOKING_STATUS_CHARGING_COMPLETED,
                LEGACY_BOOKING_STATUS_COMPLETED,
                current_user["user_id"],
                BOOKING_STATUS_CHARGING_STARTED,
                BOOKING_STATUS_CHARGING_COMPLETED,
                LEGACY_BOOKING_STATUS_CONFIRMED,
                LEGACY_BOOKING_STATUS_COMPLETED,
            ),
        )
        energy_delivered_kwh = float((cursor.fetchone() or [0])[0] or 0.0)

        cursor.execute(
            """
            SELECT
                sl.slot_id,
                sl.slot_number,
                sl.slot_type,
                sl.charger_name,
                sl.vehicle_category,
                cs.station_id,
                cs.station_name,
                COUNT(b.booking_id) AS usage_count
            FROM ChargingSlot sl
            JOIN ChargingStation cs ON sl.station_id = cs.station_id
            LEFT JOIN Booking b ON b.slot_id = sl.slot_id
            WHERE cs.user_id = %s
            GROUP BY sl.slot_id, sl.slot_number, sl.slot_type, sl.charger_name, sl.vehicle_category, cs.station_id, cs.station_name
            ORDER BY usage_count DESC, cs.station_name ASC, sl.slot_number ASC
            LIMIT 1
            """,
            (current_user["user_id"],),
        )
        most_used_row = cursor.fetchone()
        most_used_slot = None
        if most_used_row and int(most_used_row[7] or 0) > 0:
            most_used_slot = {
                "slot_id": int(most_used_row[0]),
                "slot_number": int(most_used_row[1] or 0),
                "slot_type": _to_str(most_used_row[2]),
                "charger_name": _to_str(most_used_row[3]),
                "vehicle_category": _to_str(most_used_row[4]),
                "station_id": int(most_used_row[5]),
                "station_name": _to_str(most_used_row[6]),
                "usage_count": int(most_used_row[7] or 0),
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
            "energy_delivered_kwh": round(energy_delivered_kwh, 3),
        }
    ), 200


@owner_bp.route("/revenue-analytics", methods=["GET"])
@token_required
@role_required("owner")
def get_owner_revenue_analytics(current_user):
    cursor = None
    try:
        cursor = mysql.connection.cursor()
        _ensure_phase5_tables(cursor)
        analytics = _fetch_revenue_analytics(cursor, owner_user_id=current_user["user_id"])
    except Exception:
        current_app.logger.exception(
            "Failed to fetch revenue analytics for owner user_id=%s",
            current_user.get("user_id"),
        )
        return jsonify({"error": "Failed to fetch owner revenue analytics"}), 500
    finally:
        if cursor:
            cursor.close()

    return jsonify(analytics), 200


@owner_bp.route("/stations/<int:station_id>/slots", methods=["GET"])
@token_required
@role_required("owner")
def get_owner_station_slots(current_user, station_id):
    cursor = None

    try:
        cursor = mysql.connection.cursor()
        _ensure_phase5_tables(cursor)
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

        cursor.execute(
            """
            SELECT
                slot_id,
                slot_number,
                slot_type,
                status,
                power_kw,
                price_per_kwh,
                price_per_minute,
                charger_name,
                vehicle_category,
                connector_type
            FROM ChargingSlot
            WHERE station_id = %s
            ORDER BY slot_number ASC
            """,
            (station_id,),
        )
        slots = cursor.fetchall()
        has_pricing_columns = True
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
            "charger_type": slot_type,
            "status": _to_str(row[3]),
            "charger_name": _to_str(row[7]),
            "vehicle_category": _to_str(row[8]),
            "connector_type": _to_str(row[9]),
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
