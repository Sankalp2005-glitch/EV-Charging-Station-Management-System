from flask import current_app, jsonify, request
from MySQLdb import OperationalError

from extensions import mysql
from routes.owner_bp import owner_bp
from routes.owner_common import PHONE_PATTERN, clean_text, is_close
from services.booking_config import (
    DEFAULT_POWER_KW_BY_SLOT_TYPE,
    DEFAULT_PRICE_PER_KWH_BY_SLOT_TYPE,
)
from services.db_errors import is_unknown_column_error as _is_unknown_column_error
from services.value_utils import parse_positive_float as _parse_positive_float
from services.value_utils import to_str as _to_str
from utils.jwt_handler import role_required, token_required


@owner_bp.route("/stations/<int:station_id>", methods=["PUT"])
@token_required
@role_required("owner")
def update_owner_station(current_user, station_id):
    payload = request.get_json(silent=True) or {}

    station_name = clean_text(payload.get("station_name"))
    location = clean_text(payload.get("location"))
    contact_number = clean_text(payload.get("contact_number"))
    raw_slots = payload.get("slots")

    if not station_name or not location:
        return jsonify({"error": "station_name and location are required"}), 400
    if contact_number and not PHONE_PATTERN.match(contact_number):
        return jsonify({"error": "contact_number must be 10 to 13 digits"}), 400
    if not isinstance(raw_slots, list) or not raw_slots:
        return jsonify({"error": "slots must be a non-empty list"}), 400

    normalized_slots = []
    seen_slot_ids = set()
    for item in raw_slots:
        if not isinstance(item, dict):
            return jsonify({"error": "Each slot entry must be an object"}), 400

        try:
            slot_id = int(item.get("slot_id"))
            if slot_id <= 0:
                raise ValueError
        except (TypeError, ValueError):
            return jsonify({"error": "Each slot_id must be a positive integer"}), 400

        if slot_id in seen_slot_ids:
            return jsonify({"error": "Duplicate slot_id in payload"}), 400
        seen_slot_ids.add(slot_id)

        slot_type = clean_text(item.get("slot_type")).lower()
        if slot_type not in {"fast", "normal"}:
            return jsonify({"error": "Each slot type must be 'fast' or 'normal'"}), 400

        raw_power_kw = item.get("power_kw")
        power_kw = _parse_positive_float(raw_power_kw)
        if raw_power_kw not in {None, ""} and power_kw is None:
            return jsonify({"error": f"power_kw must be positive for slot_id={slot_id}"}), 400
        if power_kw is None:
            power_kw = DEFAULT_POWER_KW_BY_SLOT_TYPE.get(slot_type, 7.0)

        raw_price_per_kwh = item.get("price_per_kwh")
        raw_price_per_minute = item.get("price_per_minute")
        price_per_kwh = _parse_positive_float(raw_price_per_kwh)
        price_per_minute = _parse_positive_float(raw_price_per_minute)

        if raw_price_per_kwh not in {None, ""} and price_per_kwh is None:
            return jsonify({"error": f"price_per_kwh must be positive for slot_id={slot_id}"}), 400
        if raw_price_per_minute not in {None, ""} and price_per_minute is None:
            return jsonify({"error": f"price_per_minute must be positive for slot_id={slot_id}"}), 400
        if price_per_kwh is not None and price_per_minute is not None:
            return jsonify({"error": f"Set either price_per_kwh or price_per_minute for slot_id={slot_id}"}), 400
        if price_per_kwh is None and price_per_minute is None:
            price_per_kwh = DEFAULT_PRICE_PER_KWH_BY_SLOT_TYPE.get(slot_type, 12.0)

        normalized_slots.append(
            {
                "slot_id": slot_id,
                "slot_type": slot_type,
                "power_kw": power_kw,
                "price_per_kwh": price_per_kwh,
                "price_per_minute": price_per_minute,
            }
        )

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

        cursor.execute(
            """
            SELECT slot_id
            FROM ChargingSlot
            WHERE station_id = %s
            ORDER BY slot_number ASC
            """,
            (station_id,),
        )
        db_slots = cursor.fetchall()
        db_slot_ids = {int(row[0]) for row in db_slots}

        if not db_slot_ids:
            return jsonify({"error": "No slots found for this station"}), 404
        if seen_slot_ids != db_slot_ids:
            return jsonify({"error": "Provide all station slots with valid slot_id values"}), 400

        cursor.execute(
            """
            UPDATE ChargingStation
            SET station_name = %s, location = %s, contact_number = %s
            WHERE station_id = %s
            """,
            (station_name, location, contact_number or None, station_id),
        )

        try:
            cursor.executemany(
                """
                UPDATE ChargingSlot
                SET
                    slot_type = %s,
                    power_kw = %s,
                    price_per_kwh = %s,
                    price_per_minute = %s
                WHERE slot_id = %s
                """,
                [
                    (
                        slot["slot_type"],
                        slot["power_kw"],
                        slot["price_per_kwh"],
                        slot["price_per_minute"],
                        slot["slot_id"],
                    )
                    for slot in normalized_slots
                ],
            )
            pricing_columns_supported = True
        except OperationalError as error:
            if not _is_unknown_column_error(error):
                raise
            cursor.executemany(
                """
                UPDATE ChargingSlot
                SET slot_type = %s
                WHERE slot_id = %s
                """,
                [(slot["slot_type"], slot["slot_id"]) for slot in normalized_slots],
            )
            pricing_columns_supported = False

        mysql.connection.commit()
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception(
            "Failed to update station_id=%s for owner_user_id=%s",
            station_id,
            current_user.get("user_id"),
        )
        return jsonify({"error": "Failed to update station"}), 500
    finally:
        if cursor:
            cursor.close()

    return jsonify(
        {
            "message": "Station updated successfully",
            "station_id": station_id,
            "slots_updated": len(normalized_slots),
            "pricing_columns_supported": pricing_columns_supported,
        }
    ), 200


@owner_bp.route("/stations/<int:station_id>/slot-types", methods=["PUT"])
@token_required
@role_required("owner")
def update_owner_station_slot_types(current_user, station_id):
    payload = request.get_json(silent=True) or {}
    raw_slot_types = payload.get("slot_types")

    if not isinstance(raw_slot_types, list) or not raw_slot_types:
        return jsonify({"error": "slot_types must be a non-empty list"}), 400

    normalized_slot_types = []
    for value in raw_slot_types:
        normalized = clean_text(value).lower()
        if normalized not in {"fast", "normal"}:
            return jsonify({"error": "Each slot type must be 'fast' or 'normal'"}), 400
        normalized_slot_types.append(normalized)

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
                SELECT slot_id, slot_number, slot_type
                FROM ChargingSlot
                WHERE station_id = %s
                ORDER BY slot_number ASC
                """,
                (station_id,),
            )
            slots = cursor.fetchall()
            has_pricing_columns = False

        if not slots:
            return jsonify({"error": "No slots found for this station"}), 404
        if len(normalized_slot_types) != len(slots):
            return jsonify({"error": "slot_types length must match station slot count"}), 400

        updates_applied = 0

        if has_pricing_columns:
            update_rows = []
            for index, row in enumerate(slots):
                slot_id = row[0]
                old_slot_type = clean_text(_to_str(row[2])).lower()
                new_slot_type = normalized_slot_types[index]
                if old_slot_type == new_slot_type:
                    continue

                old_default_power = DEFAULT_POWER_KW_BY_SLOT_TYPE.get(old_slot_type, 7.0)
                new_default_power = DEFAULT_POWER_KW_BY_SLOT_TYPE.get(new_slot_type, 7.0)
                old_default_price = DEFAULT_PRICE_PER_KWH_BY_SLOT_TYPE.get(old_slot_type, 12.0)
                new_default_price = DEFAULT_PRICE_PER_KWH_BY_SLOT_TYPE.get(new_slot_type, 12.0)

                current_power_kw = _parse_positive_float(row[3])
                current_price_per_kwh = _parse_positive_float(row[4])
                current_price_per_minute = _parse_positive_float(row[5])

                updated_power_kw = current_power_kw
                updated_price_per_kwh = current_price_per_kwh
                updated_price_per_minute = current_price_per_minute

                # Keep custom values, but move defaults when type changes.
                if current_power_kw is None or is_close(current_power_kw, old_default_power):
                    updated_power_kw = new_default_power

                if current_price_per_minute is None:
                    if current_price_per_kwh is None or is_close(
                        current_price_per_kwh, old_default_price
                    ):
                        updated_price_per_kwh = new_default_price

                update_rows.append(
                    (
                        new_slot_type,
                        updated_power_kw,
                        updated_price_per_kwh,
                        updated_price_per_minute,
                        slot_id,
                    )
                )

            if update_rows:
                cursor.executemany(
                    """
                    UPDATE ChargingSlot
                    SET
                        slot_type = %s,
                        power_kw = %s,
                        price_per_kwh = %s,
                        price_per_minute = %s
                    WHERE slot_id = %s
                    """,
                    update_rows,
                )
                updates_applied = len(update_rows)
        else:
            update_rows = []
            for index, row in enumerate(slots):
                slot_id = row[0]
                old_slot_type = clean_text(_to_str(row[2])).lower()
                new_slot_type = normalized_slot_types[index]
                if old_slot_type == new_slot_type:
                    continue
                update_rows.append((new_slot_type, slot_id))

            if update_rows:
                cursor.executemany(
                    """
                    UPDATE ChargingSlot
                    SET slot_type = %s
                    WHERE slot_id = %s
                    """,
                    update_rows,
                )
                updates_applied = len(update_rows)

        mysql.connection.commit()
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception(
            "Failed to update slot types for station_id=%s owner_user_id=%s",
            station_id,
            current_user.get("user_id"),
        )
        return jsonify({"error": "Failed to update slot types"}), 500
    finally:
        if cursor:
            cursor.close()

    return jsonify(
        {
            "message": "Slot types updated successfully",
            "station_id": station_id,
            "slots_received": len(normalized_slot_types),
            "slots_updated": updates_applied,
            "slot_type_counts": {
                "fast": normalized_slot_types.count("fast"),
                "normal": normalized_slot_types.count("normal"),
            },
        }
    ), 200
