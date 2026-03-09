from MySQLdb import OperationalError

from services.db_errors import is_unknown_column_error
from services.value_utils import parse_positive_float, to_str


def fetch_slot_with_pricing(cursor, slot_id):
    try:
        cursor.execute(
            """
            SELECT slot_id, station_id, slot_type, power_kw, price_per_kwh, price_per_minute
            FROM ChargingSlot
            WHERE slot_id = %s
            """,
            (slot_id,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        return {
            "slot_id": row[0],
            "station_id": row[1],
            "slot_type": to_str(row[2]),
            "power_kw": parse_positive_float(row[3]),
            "price_per_kwh": parse_positive_float(row[4]),
            "price_per_minute": parse_positive_float(row[5]),
        }
    except OperationalError as error:
        if not is_unknown_column_error(error):
            raise

        cursor.execute(
            """
            SELECT slot_id, station_id, slot_type
            FROM ChargingSlot
            WHERE slot_id = %s
            """,
            (slot_id,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        return {
            "slot_id": row[0],
            "station_id": row[1],
            "slot_type": to_str(row[2]),
            "power_kw": None,
            "price_per_kwh": None,
            "price_per_minute": None,
        }


def fetch_station_slots_with_pricing(cursor, station_id):
    try:
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
        return [
            {
                "slot_id": row[0],
                "slot_number": row[1],
                "slot_type": to_str(row[2]),
                "status": to_str(row[3]),
                "power_kw": parse_positive_float(row[4]),
                "price_per_kwh": parse_positive_float(row[5]),
                "price_per_minute": parse_positive_float(row[6]),
            }
            for row in rows
        ]
    except OperationalError as error:
        if not is_unknown_column_error(error):
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
        rows = cursor.fetchall()
        return [
            {
                "slot_id": row[0],
                "slot_number": row[1],
                "slot_type": to_str(row[2]),
                "status": to_str(row[3]),
                "power_kw": None,
                "price_per_kwh": None,
                "price_per_minute": None,
            }
            for row in rows
        ]
