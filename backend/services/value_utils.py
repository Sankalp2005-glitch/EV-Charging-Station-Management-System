from datetime import datetime
from math import asin, cos, radians, sin, sqrt

from services.booking_config import DATETIME_FMT


DEFAULT_NEARBY_RADIUS_KM = 10.0
MAX_NEARBY_RADIUS_KM = 1000.0


def to_str(value):
    return value.decode("utf-8") if isinstance(value, bytes) else value


def format_dt(value):
    return value.strftime(DATETIME_FMT) if isinstance(value, datetime) else value


def close_cursor(cursor):
    if cursor:
        cursor.close()


def parse_start_time(start_time_raw):
    if not isinstance(start_time_raw, str) or not start_time_raw.strip():
        return None
    try:
        return datetime.strptime(start_time_raw, DATETIME_FMT)
    except ValueError:
        return None


def parse_positive_float(value):
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed <= 0:
        return None
    return parsed


def parse_percent(value):
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed < 0 or parsed > 100:
        return None
    return parsed


def ensure_station_geo_columns(cursor):
    cursor.execute(
        """
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'ChargingStation'
          AND COLUMN_NAME IN ('latitude', 'longitude')
        """
    )
    existing_columns = {str(row[0]).lower() for row in cursor.fetchall()}

    if "latitude" not in existing_columns:
        cursor.execute("ALTER TABLE ChargingStation ADD COLUMN latitude DECIMAL(10,7) NULL")
    if "longitude" not in existing_columns:
        cursor.execute("ALTER TABLE ChargingStation ADD COLUMN longitude DECIMAL(10,7) NULL")


def parse_geo_filters(args):
    raw_latitude = args.get("latitude")
    raw_longitude = args.get("longitude")
    raw_radius = args.get("radius")

    has_latitude = raw_latitude not in {None, ""}
    has_longitude = raw_longitude not in {None, ""}
    has_radius = raw_radius not in {None, ""}

    if has_latitude != has_longitude:
        return None, "latitude and longitude must be provided together"
    if has_radius and not (has_latitude and has_longitude):
        return None, "radius requires latitude and longitude"
    if not (has_latitude and has_longitude):
        return None, None

    try:
        latitude = float(raw_latitude)
        longitude = float(raw_longitude)
    except (TypeError, ValueError):
        return None, "latitude and longitude must be valid numbers"

    if latitude < -90 or latitude > 90:
        return None, "latitude must be between -90 and 90"
    if longitude < -180 or longitude > 180:
        return None, "longitude must be between -180 and 180"

    radius_km = DEFAULT_NEARBY_RADIUS_KM
    if has_radius:
        try:
            radius_km = float(raw_radius)
        except (TypeError, ValueError):
            return None, "radius must be a valid number"

    if radius_km <= 0 or radius_km > MAX_NEARBY_RADIUS_KM:
        return None, f"radius must be greater than 0 and at most {int(MAX_NEARBY_RADIUS_KM)}"

    return {"latitude": latitude, "longitude": longitude, "radius_km": radius_km}, None


def haversine_distance_km(latitude_a, longitude_a, latitude_b, longitude_b):
    if None in {latitude_a, longitude_a, latitude_b, longitude_b}:
        return None

    lat1 = radians(float(latitude_a))
    lon1 = radians(float(longitude_a))
    lat2 = radians(float(latitude_b))
    lon2 = radians(float(longitude_b))

    delta_lat = lat2 - lat1
    delta_lon = lon2 - lon1

    haversine = sin(delta_lat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(delta_lon / 2) ** 2
    return 6371.0 * 2 * asin(sqrt(haversine))


def normalize_coordinate_pair(latitude, longitude):
    try:
        parsed_latitude = float(latitude)
        parsed_longitude = float(longitude)
    except (TypeError, ValueError):
        return None, None
    return parsed_latitude, parsed_longitude
