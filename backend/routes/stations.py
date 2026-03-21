from flask import Blueprint, current_app, jsonify, request

from extensions import mysql
from services.booking_schema import ensure_phase5_tables as _ensure_phase5_tables
from services.value_utils import (
    close_cursor as _close_cursor,
    ensure_station_geo_columns,
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


stations_bp = Blueprint("stations", __name__, url_prefix="/api/stations")


@stations_bp.route("/locations", methods=["GET"])
@token_required
def get_station_locations(_current_user):
    geo_filters, geo_error = parse_geo_filters(request.args)
    if geo_error:
        return jsonify({"error": geo_error}), 400

    cursor = None
    try:
        cursor = mysql.connection.cursor()
        _ensure_phase5_tables(cursor)
        ensure_station_geo_columns(cursor)
        ensure_station_approval_table(cursor)
        backfill_missing_station_approvals(cursor)
        mysql.connection.commit()

        cursor.execute(
            """
            SELECT
                cs.station_id,
                cs.station_name,
                cs.location,
                cs.total_slots,
                cs.latitude,
                cs.longitude
            FROM ChargingStation cs
            JOIN StationApproval sa ON sa.station_id = cs.station_id
            WHERE sa.status = %s
            ORDER BY cs.station_name ASC
            """,
            (APPROVAL_STATUS_APPROVED,),
        )
        stations = cursor.fetchall()
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception("Failed to fetch station map locations")
        return jsonify({"error": "Failed to fetch station locations"}), 500
    finally:
        _close_cursor(cursor)

    result = []
    for row in stations:
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

        result.append(
            {
                "station_id": int(row[0]),
                "station_name": _to_str(row[1]),
                "location": _to_str(row[2]),
                "charger_count": int(row[3] or 0),
                "latitude": latitude,
                "longitude": longitude,
                "distance_km": round(distance_km, 2) if distance_km is not None else None,
            }
        )

    return jsonify(result), 200


@stations_bp.route("/<int:station_id>/coordinates", methods=["PUT"])
@token_required
def update_station_coordinates(_current_user, station_id):
    payload = request.get_json(silent=True) or {}
    latitude, longitude = normalize_coordinate_pair(payload.get("latitude"), payload.get("longitude"))

    if latitude is None or longitude is None:
        return jsonify({"error": "latitude and longitude are required"}), 400
    if latitude < -90 or latitude > 90:
        return jsonify({"error": "latitude must be between -90 and 90"}), 400
    if longitude < -180 or longitude > 180:
        return jsonify({"error": "longitude must be between -180 and 180"}), 400

    cursor = None
    try:
        cursor = mysql.connection.cursor()
        _ensure_phase5_tables(cursor)
        ensure_station_geo_columns(cursor)
        cursor.execute(
            """
            UPDATE ChargingStation
            SET latitude = %s, longitude = %s
            WHERE station_id = %s
            """,
            (latitude, longitude, station_id),
        )
        if cursor.rowcount == 0:
            return jsonify({"error": "Station not found"}), 404
        mysql.connection.commit()
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception("Failed to update coordinates for station_id=%s", station_id)
        return jsonify({"error": "Failed to update station coordinates"}), 500
    finally:
        _close_cursor(cursor)

    return jsonify(
        {
            "station_id": station_id,
            "latitude": round(latitude, 7),
            "longitude": round(longitude, 7),
        }
    ), 200
