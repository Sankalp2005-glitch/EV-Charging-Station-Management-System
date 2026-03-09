from flask import current_app, jsonify, request
from MySQLdb import OperationalError

from extensions import mysql
from routes.owner_bp import owner_bp
from routes.owner_common import PHONE_PATTERN, clean_text, resolve_slot_types
from services.booking_config import (
    DEFAULT_POWER_KW_BY_SLOT_TYPE,
    DEFAULT_PRICE_PER_KWH_BY_SLOT_TYPE,
)
from services.db_errors import is_unknown_column_error as _is_unknown_column_error
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
    contact_number = clean_text(data.get("contact_number"))
    total_slots = data.get("total_slots")
    slot_type = clean_text(data.get("slot_type")).lower()
    slot_types = data.get("slot_types")
    power_kw = _parse_positive_float(data.get("power_kw"))
    price_per_kwh = _parse_positive_float(data.get("price_per_kwh"))
    price_per_minute = _parse_positive_float(data.get("price_per_minute"))

    if not station_name or not location or not total_slots:
        return jsonify({"error": "Missing required fields"}), 400
    if contact_number and not PHONE_PATTERN.match(contact_number):
        return jsonify({"error": "contact_number must be 10 to 13 digits"}), 400

    try:
        total_slots = int(total_slots)
    except (TypeError, ValueError):
        return jsonify({"error": "total_slots must be an integer"}), 400

    if total_slots <= 0:
        return jsonify({"error": "total_slots must be greater than 0"}), 400
    resolved_slot_types, slot_type_error = resolve_slot_types(slot_types, slot_type, total_slots)
    if slot_type_error:
        return jsonify({"error": slot_type_error}), 400
    if data.get("power_kw") not in {None, ""} and power_kw is None:
        return jsonify({"error": "power_kw must be a positive number"}), 400
    if data.get("price_per_kwh") not in {None, ""} and price_per_kwh is None:
        return jsonify({"error": "price_per_kwh must be a positive number"}), 400
    if data.get("price_per_minute") not in {None, ""} and price_per_minute is None:
        return jsonify({"error": "price_per_minute must be a positive number"}), 400
    if price_per_kwh is not None and price_per_minute is not None:
        return jsonify({"error": "Provide either price_per_kwh or price_per_minute, not both"}), 400

    cursor = None
    try:
        cursor = mysql.connection.cursor()
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

        slot_rows = []
        for i, resolved_slot_type in enumerate(resolved_slot_types, start=1):
            resolved_power_kw = power_kw or DEFAULT_POWER_KW_BY_SLOT_TYPE.get(resolved_slot_type, 7.0)
            resolved_price_per_kwh = price_per_kwh
            resolved_price_per_minute = price_per_minute
            if resolved_price_per_kwh is None and resolved_price_per_minute is None:
                resolved_price_per_kwh = DEFAULT_PRICE_PER_KWH_BY_SLOT_TYPE.get(resolved_slot_type, 12.0)

            slot_rows.append(
                (
                    station_id,
                    i,
                    resolved_slot_type,
                    resolved_power_kw,
                    resolved_price_per_kwh,
                    resolved_price_per_minute,
                )
            )
        try:
            cursor.executemany(
                """
                INSERT INTO ChargingSlot
                    (station_id, slot_number, slot_type, power_kw, price_per_kwh, price_per_minute)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                slot_rows,
            )
        except OperationalError as error:
            if not _is_unknown_column_error(error):
                raise

            # Backward compatibility for pre-Phase-2 schema.
            legacy_rows = [
                (station_id, i, resolved_slot_type)
                for i, resolved_slot_type in enumerate(resolved_slot_types, start=1)
            ]
            cursor.executemany(
                """
                INSERT INTO ChargingSlot (station_id, slot_number, slot_type)
                VALUES (%s, %s, %s)
                """,
                legacy_rows,
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
                "fast": resolved_slot_types.count("fast"),
                "normal": resolved_slot_types.count("normal"),
            },
            "power_kw": round(power_kw, 2) if power_kw is not None else None,
            "price_per_kwh": round(price_per_kwh, 2) if price_per_kwh is not None else None,
            "price_per_minute": round(price_per_minute, 2) if price_per_minute is not None else None,
        }
    ), 201
