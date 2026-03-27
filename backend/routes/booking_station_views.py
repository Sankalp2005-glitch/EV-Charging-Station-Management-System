from datetime import datetime

from flask import current_app, jsonify, request

from extensions import mysql
from routes.booking_bp import booking_bp
from services.booking_config import (
    BOOKING_STATUS_CHARGING_STARTED,
    BOOKING_STATUS_WAITING_TO_START,
    DEFAULT_POWER_KW_BY_SLOT_TYPE,
    DEFAULT_PRICE_PER_KWH_BY_SLOT_TYPE,
    LEGACY_BOOKING_STATUS_CONFIRMED,
)
from services.charging_profiles import build_live_charging_snapshot, normalize_vehicle_category
from services.booking_lifecycle import (
    emit_lifecycle_updates as _emit_lifecycle_updates,
    run_booking_lifecycle_updates as _run_booking_lifecycle_updates,
)
from services.booking_schema import ensure_phase5_tables as _ensure_phase5_tables
from services.slot_repository import fetch_station_slots_with_pricing as _fetch_station_slots_with_pricing
from services.value_utils import (
    close_cursor as _close_cursor,
    ensure_station_geo_columns,
    format_dt as _format_dt,
    haversine_distance_km,
    normalize_coordinate_pair,
    parse_geo_filters,
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
    vehicle_category_filter = normalize_vehicle_category(request.args.get("vehicle_category"))
    geo_filters, geo_error = parse_geo_filters(request.args)
    if geo_error:
        return jsonify({"error": geo_error}), 400
    if slot_type_filter and slot_type_filter not in {"fast", "normal"}:
        return jsonify({"error": "slot_type must be 'fast' or 'normal'"}), 400
    if request.args.get("vehicle_category") and not vehicle_category_filter:
        return jsonify({"error": "vehicle_category must be one of: bike_scooter, car"}), 400

    cursor = None
    lifecycle_records = []
    try:
        cursor = mysql.connection.cursor()
        _ensure_phase5_tables(cursor)
        ensure_station_geo_columns(cursor)
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
                cs.latitude,
                cs.longitude,
                COUNT(sl.slot_id) AS matching_slots,
                SUM(
                    CASE
                        WHEN sl.status = 'out_of_service' THEN 0
                        WHEN COALESCE(slot_activity.has_charging, 0) = 1 OR sl.status = 'charging' THEN 0
                        WHEN COALESCE(slot_activity.has_reserved, 0) = 1 OR sl.status = 'occupied' THEN 0
                        WHEN sl.slot_id IS NOT NULL THEN 1
                        ELSE 0
                    END
                ) AS available_slots,
                SUM(
                    CASE
                        WHEN sl.status = 'out_of_service' THEN 0
                        WHEN COALESCE(slot_activity.has_charging, 0) = 1 OR sl.status = 'charging' THEN 0
                        WHEN COALESCE(slot_activity.has_reserved, 0) = 1 OR sl.status = 'occupied' THEN 1
                        ELSE 0
                    END
                ) AS occupied_slots,
                SUM(
                    CASE
                        WHEN sl.status = 'out_of_service' THEN 0
                        WHEN COALESCE(slot_activity.has_charging, 0) = 1 OR sl.status = 'charging' THEN 1
                        ELSE 0
                    END
                ) AS charging_slots,
                SUM(CASE WHEN sl.status = 'out_of_service' THEN 1 ELSE 0 END) AS out_of_service_slots,
                MIN(sl.price_per_kwh) AS min_price_kwh,
                MIN(sl.price_per_minute) AS min_price_minute,
                GROUP_CONCAT(DISTINCT sl.vehicle_category ORDER BY sl.vehicle_category SEPARATOR ',') AS vehicle_categories
            FROM ChargingStation cs
            JOIN StationApproval sa ON sa.station_id = cs.station_id
            LEFT JOIN ChargingSlot sl ON cs.station_id = sl.station_id
            LEFT JOIN (
                SELECT
                    b.slot_id,
                    MAX(
                        CASE
                            WHEN b.status = 'charging_started'
                                 AND sess.start_time IS NOT NULL
                                 AND (sess.end_time IS NULL OR sess.end_time > NOW())
                            THEN 1
                            ELSE 0
                        END
                    ) AS has_charging,
                    MAX(
                        CASE
                            WHEN b.status IN ('waiting_to_start', 'confirmed') AND b.end_time > NOW() THEN 1
                            WHEN b.status = 'charging_started' AND b.end_time > NOW() AND sess.start_time IS NULL THEN 1
                            ELSE 0
                        END
                    ) AS has_reserved
                FROM Booking b
                LEFT JOIN ChargingSession sess ON sess.booking_id = b.booking_id
                WHERE b.status IN ('waiting_to_start', 'confirmed', 'charging_started')
                  AND b.end_time > NOW()
                GROUP BY b.slot_id
            ) AS slot_activity ON slot_activity.slot_id = sl.slot_id
            WHERE sa.status = %s
        """
        params = [APPROVAL_STATUS_APPROVED]

        if location_filter:
            query += " AND LOWER(cs.location) LIKE %s"
            params.append(f"%{location_filter}%")
        if slot_type_filter:
            query += " AND sl.slot_type = %s"
            params.append(slot_type_filter)
        if vehicle_category_filter:
            query += " AND sl.vehicle_category = %s"
            params.append(vehicle_category_filter)

        query += """
            GROUP BY cs.station_id, cs.station_name, cs.location, cs.total_slots, cs.latitude, cs.longitude
            ORDER BY cs.station_name ASC
        """
        try:
            cursor.execute(query, tuple(params))
        except Exception as inner_exc:
            err_msg = str(inner_exc).lower()
            if "unknown column" in err_msg and ("price_per_kwh" in err_msg or "price_per_minute" in err_msg):
                current_app.logger.warning("Price columns not found, retrying stations query without pricing aggregation")
                fallback_query = """
                    SELECT
                        cs.station_id,
                        cs.station_name,
                        cs.location,
                        cs.total_slots,
                        cs.latitude,
                        cs.longitude,
                        COUNT(sl.slot_id) AS matching_slots,
                        SUM(
                            CASE
                                WHEN sl.status = 'out_of_service' THEN 0
                                WHEN COALESCE(slot_activity.has_charging, 0) = 1 OR sl.status = 'charging' THEN 0
                                WHEN COALESCE(slot_activity.has_reserved, 0) = 1 OR sl.status = 'occupied' THEN 0
                                WHEN sl.slot_id IS NOT NULL THEN 1
                                ELSE 0
                            END
                        ) AS available_slots,
                        SUM(
                            CASE
                                WHEN sl.status = 'out_of_service' THEN 0
                                WHEN COALESCE(slot_activity.has_charging, 0) = 1 OR sl.status = 'charging' THEN 0
                                WHEN COALESCE(slot_activity.has_reserved, 0) = 1 OR sl.status = 'occupied' THEN 1
                                ELSE 0
                            END
                        ) AS occupied_slots,
                        SUM(
                            CASE
                                WHEN sl.status = 'out_of_service' THEN 0
                                WHEN COALESCE(slot_activity.has_charging, 0) = 1 OR sl.status = 'charging' THEN 1
                                ELSE 0
                            END
                        ) AS charging_slots,
                        SUM(CASE WHEN sl.status = 'out_of_service' THEN 1 ELSE 0 END) AS out_of_service_slots,
                        GROUP_CONCAT(DISTINCT sl.vehicle_category ORDER BY sl.vehicle_category SEPARATOR ',') AS vehicle_categories
                    FROM ChargingStation cs
                    JOIN StationApproval sa ON sa.station_id = cs.station_id
                    LEFT JOIN ChargingSlot sl ON cs.station_id = sl.station_id
                    LEFT JOIN (
                        SELECT
                            b.slot_id,
                            MAX(
                                CASE
                                    WHEN b.status = 'charging_started'
                                         AND sess.start_time IS NOT NULL
                                         AND (sess.end_time IS NULL OR sess.end_time > NOW())
                                    THEN 1
                                    ELSE 0
                                END
                            ) AS has_charging,
                            MAX(
                                CASE
                                    WHEN b.status IN ('waiting_to_start', 'confirmed') AND b.end_time > NOW() THEN 1
                                    WHEN b.status = 'charging_started' AND b.end_time > NOW() AND sess.start_time IS NULL THEN 1
                                    ELSE 0
                                END
                            ) AS has_reserved
                        FROM Booking b
                        LEFT JOIN ChargingSession sess ON sess.booking_id = b.booking_id
                        WHERE b.status IN ('waiting_to_start', 'confirmed', 'charging_started')
                          AND b.end_time > NOW()
                        GROUP BY b.slot_id
                    ) AS slot_activity ON slot_activity.slot_id = sl.slot_id
                    WHERE sa.status = %s
                """
                if location_filter:
                    fallback_query += " AND LOWER(cs.location) LIKE %s"
                if slot_type_filter:
                    fallback_query += " AND sl.slot_type = %s"
                if vehicle_category_filter:
                    fallback_query += " AND sl.vehicle_category = %s"
                fallback_query += """
                    GROUP BY cs.station_id, cs.station_name, cs.location, cs.total_slots, cs.latitude, cs.longitude
                    ORDER BY cs.station_name ASC
                """
                cursor.execute(fallback_query, tuple(params))
            else:
                raise
        stations = cursor.fetchall()
    except Exception as exc:
        mysql.connection.rollback()
        current_app.logger.exception("Failed to fetch charging stations")
        return jsonify({"error": f"Failed to fetch stations: {str(exc)}"}), 500
    finally:
        _close_cursor(cursor)

    _emit_lifecycle_updates(lifecycle_records)

    result = []
    for station in stations:
        latitude, longitude = normalize_coordinate_pair(station[4], station[5])
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

        matching_slots = int(station[6] or 0)
        available_slots = int(station[7] or 0)
        occupied_slots = int(station[8] or 0)
        charging_slots = int(station[9] or 0) if len(station) > 9 else 0
        out_of_service_slots = int(station[10] or 0) if len(station) > 10 else 0
        has_pricing_aggregates = len(station) > 12
        min_price_kwh = station[11] if has_pricing_aggregates else None
        min_price_minute = station[12] if has_pricing_aggregates else None
        supported_categories = (_to_str(station[13] if has_pricing_aggregates else station[11]) or "").split(",")

        if matching_slots == 0:
            availability_status = "no-compatible-slots"
        elif available_slots > 0:
            availability_status = "available"
        elif charging_slots > 0 or occupied_slots > 0:
            availability_status = "busy"
        elif out_of_service_slots > 0:
            availability_status = "out_of_service"
        else:
            availability_status = "busy"

        price_info = None
        if min_price_kwh is not None and min_price_kwh > 0:
            price_info = f"INR {min_price_kwh:.2f}/kWh"
        elif min_price_minute is not None and min_price_minute > 0:
            price_info = f"INR {min_price_minute:.2f}/min"

        result.append(
            {
                "station_id": station[0],
                "station_name": _to_str(station[1]),
                "location": _to_str(station[2]),
                "total_slots": int(station[3] or 0),
                "latitude": latitude,
                "longitude": longitude,
                "distance_km": round(distance_km, 2) if distance_km is not None else None,
                "matching_slots": matching_slots,
                "available_slots": available_slots,
                "occupied_slots": occupied_slots,
                "charging_slots": charging_slots,
                "out_of_service_slots": out_of_service_slots,
                "availability_status": availability_status,
                "price_info": price_info,
                "vehicle_categories": [category for category in supported_categories if category],
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
        ensure_station_geo_columns(cursor)
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
                SELECT
                    b.booking_id,
                    b.start_time,
                    b.end_time,
                    b.status,
                    b.estimated_duration_minutes,
                    b.current_battery_percent,
                    b.target_battery_percent,
                    b.energy_required_kwh,
                    sess.start_time,
                    sess.end_time
                FROM Booking b
                LEFT JOIN ChargingSession sess ON sess.booking_id = b.booking_id
                WHERE b.slot_id = %s
                  AND b.status IN ('waiting_to_start', 'charging_started', 'confirmed')
                  AND b.end_time > NOW()
                ORDER BY b.start_time ASC
                LIMIT 5
                """,
                (slot_id,),
            )
            bookings = cursor.fetchall()

            booking_list = []
            active_booking = None
            active_session = None
            for booking in bookings:
                booking_status = _to_str(booking[3])
                duration_minutes = int(
                    booking[4] or max(int((booking[2] - booking[1]).total_seconds() // 60), 0)
                )
                booking_item = {
                    "booking_id": booking[0],
                    "start_time": _format_dt(booking[1]),
                    "end_time": _format_dt(booking[2]),
                    "status": booking_status,
                }
                booking_list.append(booking_item)

                is_current_window = booking[1] <= now < booking[2]
                has_session_started = booking[8] is not None
                if is_current_window and has_session_started:
                    live_snapshot = build_live_charging_snapshot(
                        booking_status=booking_status,
                        charging_started_at=booking[8],
                        charging_completed_at=booking[9],
                        estimated_duration_minutes=duration_minutes,
                        current_battery_percent=booking[5],
                        target_battery_percent=booking[6],
                        energy_required_kwh=booking[7],
                        now=now,
                    )
                    active_session = {
                        "booking_id": booking[0],
                        "status": "charging",
                        "charging_started_at": _format_dt(booking[8]),
                        "charging_completed_at": _format_dt(booking[9]),
                        "duration_minutes": duration_minutes,
                        "current_battery_percent": float(booking[5]) if booking[5] is not None else None,
                        "target_battery_percent": float(booking[6]) if booking[6] is not None else None,
                        "progress_percent": live_snapshot["progress_percent"],
                        "estimated_current_battery_percent": live_snapshot["estimated_current_battery_percent"],
                        "estimated_completion_time": _format_dt(live_snapshot["estimated_completion_time"]),
                        "remaining_minutes": live_snapshot["remaining_minutes"],
                    }
                elif active_booking is None:
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
                    "charger_type": slot_type,
                    "charger_name": slot.get("charger_name"),
                    "vehicle_category": slot.get("vehicle_category"),
                    "connector_type": slot.get("connector_type"),
                    "charging_speed": slot.get("charging_speed"),
                    "current_status": (
                        "out_of_service"
                        if str(slot.get("status") or "").lower() == "out_of_service"
                        else ("charging" if active_session else "occupied" if active_booking else "available")
                    ),
                    "status": slot["status"],
                    "power_kw": round(
                        parsed_power_kw or DEFAULT_POWER_KW_BY_SLOT_TYPE.get(slot_type, 7.0),
                        2,
                    ),
                    "price_per_kwh": round(parsed_price_per_kwh, 2) if parsed_price_per_kwh else None,
                    "price_per_minute": round(parsed_price_per_minute, 2) if parsed_price_per_minute else None,
                    "is_available_now": active_booking is None and active_session is None and str(slot.get("status") or "").lower() != "out_of_service",
                    "active_booking": active_booking,
                    "active_session": active_session,
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
