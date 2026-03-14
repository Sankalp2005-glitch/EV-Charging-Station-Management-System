from flask import current_app, jsonify, request

from extensions import mysql
from routes.owner_bp import owner_bp
from routes.owner_common import build_contact_number, clean_text, resolve_slot_types
from services.booking_config import DEFAULT_PRICE_PER_KWH_BY_SLOT_TYPE
from services.booking_schema import ensure_phase5_tables as _ensure_phase5_tables
from services.charging_profiles import (
    default_connector_type,
    default_power_kw,
    normalize_charger_type,
    normalize_connector_type,
    normalize_vehicle_category,
)
from services.value_utils import parse_positive_float as _parse_positive_float
from utils.jwt_handler import role_required, token_required
from utils.station_approval import (
    APPROVAL_STATUS_PENDING,
    backfill_missing_station_approvals,
    ensure_station_approval_table,
)


@owner_bp.route("/create-station", methods=["POST"])
@token_required
@role_required("owner")
def create_station(current_user):
    data = request.get_json(silent=True) or {}

    station_name = clean_text(data.get("station_name"))
    location = clean_text(data.get("location"))
    contact_number_raw = data.get("contact_number")
    contact_country_code = data.get("contact_country_code")
    total_slots = data.get("total_slots")
    slot_type = clean_text(data.get("slot_type")).lower()
    slot_types = data.get("slot_types")
    raw_chargers = data.get("chargers")
    power_kw = _parse_positive_float(data.get("power_kw"))
    price_per_kwh = _parse_positive_float(data.get("price_per_kwh"))
    price_per_minute = _parse_positive_float(data.get("price_per_minute"))

    if not station_name or not location or not total_slots:
        return jsonify({"error": "Missing required fields"}), 400
    contact_number, contact_error = build_contact_number(contact_number_raw, contact_country_code)
    if contact_error:
        return jsonify({"error": contact_error}), 400

    try:
        total_slots = int(total_slots)
    except (TypeError, ValueError):
        return jsonify({"error": "total_slots must be an integer"}), 400

    if total_slots <= 0:
        return jsonify({"error": "total_slots must be greater than 0"}), 400
    if data.get("power_kw") not in {None, ""} and power_kw is None:
        return jsonify({"error": "power_kw must be a positive number"}), 400
    if data.get("price_per_kwh") not in {None, ""} and price_per_kwh is None:
        return jsonify({"error": "price_per_kwh must be a positive number"}), 400
    if data.get("price_per_minute") not in {None, ""} and price_per_minute is None:
        return jsonify({"error": "price_per_minute must be a positive number"}), 400
    if price_per_kwh is not None and price_per_minute is not None:
        return jsonify({"error": "Provide either price_per_kwh or price_per_minute, not both"}), 400

    chargers = []
    if raw_chargers is not None:
        if not isinstance(raw_chargers, list) or len(raw_chargers) != total_slots:
            return jsonify({"error": "chargers must be a list matching total_slots"}), 400

        for index, charger in enumerate(raw_chargers, start=1):
            if not isinstance(charger, dict):
                return jsonify({"error": "Each charger entry must be an object"}), 400

            charger_name = clean_text(charger.get("charger_name"))
            charger_type = normalize_charger_type(charger.get("charger_type") or charger.get("slot_type"))
            vehicle_category = normalize_vehicle_category(charger.get("vehicle_category"))
            connector_type = normalize_connector_type(charger.get("connector_type"))
            charger_power_kw = _parse_positive_float(charger.get("power_kw"))
            charger_price_per_kwh = _parse_positive_float(charger.get("price_per_kwh"))
            charger_price_per_minute = _parse_positive_float(charger.get("price_per_minute"))

            if not charger_name:
                return jsonify({"error": f"charger_name is required for charger {index}"}), 400
            if not charger_type:
                return jsonify({"error": f"charger_type must be 'fast' or 'normal' for charger {index}"}), 400
            if not vehicle_category:
                return jsonify({"error": f"vehicle_category must be bike_scooter or car for charger {index}"}), 400
            if not connector_type:
                return jsonify({"error": f"connector_type is required for charger {index}"}), 400
            if charger_power_kw is None:
                return jsonify({"error": f"power_kw must be a positive number for charger {index}"}), 400
            if charger_price_per_kwh is not None and charger_price_per_minute is not None:
                return jsonify({"error": f"Provide either price_per_kwh or price_per_minute for charger {index}"}), 400
            if charger_price_per_kwh is None and charger_price_per_minute is None:
                charger_price_per_kwh = price_per_kwh
                charger_price_per_minute = price_per_minute
            if charger_price_per_kwh is None and charger_price_per_minute is None:
                charger_price_per_kwh = DEFAULT_PRICE_PER_KWH_BY_SLOT_TYPE.get(charger_type, 12.0)

            chargers.append(
                {
                    "slot_number": index,
                    "charger_name": charger_name,
                    "slot_type": charger_type,
                    "vehicle_category": vehicle_category,
                    "power_kw": charger_power_kw,
                    "connector_type": connector_type,
                    "price_per_kwh": charger_price_per_kwh,
                    "price_per_minute": charger_price_per_minute,
                }
            )
    else:
        resolved_slot_types, slot_type_error = resolve_slot_types(slot_types, slot_type, total_slots)
        if slot_type_error:
            return jsonify({"error": slot_type_error}), 400
        for index, resolved_slot_type in enumerate(resolved_slot_types, start=1):
            vehicle_category = normalize_vehicle_category(data.get("vehicle_category")) or "car"
            resolved_power_kw = power_kw or default_power_kw(vehicle_category, resolved_slot_type)
            resolved_price_per_kwh = price_per_kwh
            resolved_price_per_minute = price_per_minute
            if resolved_price_per_kwh is None and resolved_price_per_minute is None:
                resolved_price_per_kwh = DEFAULT_PRICE_PER_KWH_BY_SLOT_TYPE.get(resolved_slot_type, 12.0)
            chargers.append(
                {
                    "slot_number": index,
                    "charger_name": f"Charger {index}",
                    "slot_type": resolved_slot_type,
                    "vehicle_category": vehicle_category,
                    "power_kw": resolved_power_kw,
                    "connector_type": default_connector_type(vehicle_category, resolved_slot_type),
                    "price_per_kwh": resolved_price_per_kwh,
                    "price_per_minute": resolved_price_per_minute,
                }
            )
    cursor = None
    try:
        cursor = mysql.connection.cursor()
        _ensure_phase5_tables(cursor)
        ensure_station_approval_table(cursor)
        backfill_missing_station_approvals(cursor)
        cursor.execute(
            """
            INSERT INTO ChargingStation (station_name, location, contact_number, total_slots, user_id)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (station_name, location, contact_number or None, total_slots, current_user["user_id"]),
        )
        station_id = cursor.lastrowid

        cursor.executemany(
            """
            INSERT INTO ChargingSlot (
                station_id,
                slot_number,
                slot_type,
                power_kw,
                price_per_kwh,
                price_per_minute,
                charger_name,
                vehicle_category,
                connector_type
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            [
                (
                    station_id,
                    charger["slot_number"],
                    charger["slot_type"],
                    charger["power_kw"],
                    charger["price_per_kwh"],
                    charger["price_per_minute"],
                    charger["charger_name"],
                    charger["vehicle_category"],
                    charger["connector_type"],
                )
                for charger in chargers
            ],
        )
        cursor.execute(
            """
            INSERT INTO StationApproval (station_id, status)
            VALUES (%s, %s)
            ON DUPLICATE KEY UPDATE
                status = VALUES(status),
                reviewed_by = NULL,
                reviewed_at = NULL,
                remarks = NULL
            """,
            (station_id, APPROVAL_STATUS_PENDING),
        )
        mysql.connection.commit()
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception(
            "Failed to create station for user_id=%s",
            current_user.get("user_id"),
        )
        return jsonify({"error": "Failed to create station"}), 500
    finally:
        if cursor:
            cursor.close()

    return jsonify(
        {
            "message": "Station created and submitted for admin approval",
            "station_id": station_id,
            "total_slots_created": total_slots,
            "approval_status": APPROVAL_STATUS_PENDING,
            "slot_type_counts": {
                "fast": sum(1 for charger in chargers if charger["slot_type"] == "fast"),
                "normal": sum(1 for charger in chargers if charger["slot_type"] == "normal"),
            },
            "chargers_created": chargers,
        }
    ), 201
