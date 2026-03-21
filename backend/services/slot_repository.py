from MySQLdb import OperationalError

from services.charging_profiles import (
    VEHICLE_CATEGORY_CAR,
    classify_charging_speed,
    default_connector_type,
    normalize_vehicle_category,
)
from services.db_errors import is_unknown_column_error
from services.value_utils import parse_positive_float, to_str


def fetch_slot_with_pricing(cursor, slot_id):
    try:
        cursor.execute(
            """
            SELECT
                slot_id,
                station_id,
                slot_type,
                status,
                power_kw,
                price_per_kwh,
                price_per_minute,
                charger_name,
                vehicle_category,
                connector_type
            FROM ChargingSlot
            WHERE slot_id = %s
            """,
            (slot_id,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        vehicle_category = normalize_vehicle_category(row[8]) or VEHICLE_CATEGORY_CAR
        power_kw = parse_positive_float(row[4])
        return {
            "slot_id": row[0],
            "station_id": row[1],
            "slot_type": to_str(row[2]),
            "status": to_str(row[3]),
            "power_kw": power_kw,
            "price_per_kwh": parse_positive_float(row[5]),
            "price_per_minute": parse_positive_float(row[6]),
            "charger_name": to_str(row[7]) or f"Charger {row[0]}",
            "vehicle_category": vehicle_category,
            "connector_type": to_str(row[9]) or default_connector_type(vehicle_category, to_str(row[2])),
            "charging_speed": classify_charging_speed(power_kw or 0, vehicle_category),
        }
    except OperationalError as error:
        if not is_unknown_column_error(error):
            raise

        cursor.execute(
            """
            SELECT slot_id, station_id, slot_type, status, power_kw, price_per_kwh, price_per_minute
            FROM ChargingSlot
            WHERE slot_id = %s
            """,
            (slot_id,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        slot_type = to_str(row[2])
        power_kw = parse_positive_float(row[4])
        return {
            "slot_id": row[0],
            "station_id": row[1],
            "slot_type": slot_type,
            "status": to_str(row[3]),
            "power_kw": power_kw,
            "price_per_kwh": parse_positive_float(row[5]),
            "price_per_minute": parse_positive_float(row[6]),
            "charger_name": f"Charger {row[0]}",
            "vehicle_category": VEHICLE_CATEGORY_CAR,
            "connector_type": default_connector_type(VEHICLE_CATEGORY_CAR, slot_type),
            "charging_speed": classify_charging_speed(power_kw or 0, VEHICLE_CATEGORY_CAR),
        }


def fetch_station_slots_with_pricing(cursor, station_id):
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
        rows = cursor.fetchall()
        result = []
        for row in rows:
            slot_type = to_str(row[2])
            vehicle_category = normalize_vehicle_category(row[8]) or VEHICLE_CATEGORY_CAR
            power_kw = parse_positive_float(row[4])
            result.append(
                {
                    "slot_id": row[0],
                    "slot_number": row[1],
                    "slot_type": slot_type,
                    "status": to_str(row[3]),
                    "power_kw": power_kw,
                    "price_per_kwh": parse_positive_float(row[5]),
                    "price_per_minute": parse_positive_float(row[6]),
                    "charger_name": to_str(row[7]) or f"Charger {row[1]}",
                    "vehicle_category": vehicle_category,
                    "connector_type": to_str(row[9]) or default_connector_type(vehicle_category, slot_type),
                    "charging_speed": classify_charging_speed(power_kw or 0, vehicle_category),
                }
            )
        return result
    except OperationalError as error:
        if not is_unknown_column_error(error):
            raise

        cursor.execute(
            """
            SELECT slot_id, slot_number, slot_type, status, power_kw, price_per_kwh, price_per_minute
            FROM ChargingSlot
            WHERE station_id = %s
            ORDER BY slot_number ASC
            """,
            (station_id,),
        )
        rows = cursor.fetchall()
        result = []
        for row in rows:
            slot_type = to_str(row[2])
            power_kw = parse_positive_float(row[4])
            result.append(
                {
                    "slot_id": row[0],
                    "slot_number": row[1],
                    "slot_type": slot_type,
                    "status": to_str(row[3]),
                    "power_kw": power_kw,
                    "price_per_kwh": parse_positive_float(row[5]),
                    "price_per_minute": parse_positive_float(row[6]),
                    "charger_name": f"Charger {row[1]}",
                    "vehicle_category": VEHICLE_CATEGORY_CAR,
                    "connector_type": default_connector_type(VEHICLE_CATEGORY_CAR, slot_type),
                    "charging_speed": classify_charging_speed(power_kw or 0, VEHICLE_CATEGORY_CAR),
                }
            )
        return result
