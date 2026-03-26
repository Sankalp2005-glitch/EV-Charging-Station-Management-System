import argparse
import sys
from pathlib import Path

import mysql.connector


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_PATH = PROJECT_ROOT / "backend"
if str(BACKEND_PATH) not in sys.path:
    sys.path.insert(0, str(BACKEND_PATH))

from config import load_mysql_config  # noqa: E402


TABLES = [
    "Users",
    "Vehicle",
    "ChargingStation",
    "StationApproval",
    "ChargingSlot",
    "Booking",
    "ChargingSession",
    "Payment",
    "UserAccountStatus",
]


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Compare a legacy local MySQL database with the current target database "
            "and optionally migrate missing rows using natural-key matching."
        )
    )
    parser.add_argument("--source-host", default="localhost")
    parser.add_argument("--source-port", type=int, default=3306)
    parser.add_argument("--source-user", default="root")
    parser.add_argument("--source-password", required=True)
    parser.add_argument("--source-db", default="ev_charging_system")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply the migration to the target database. Without this flag, only a dry run is performed.",
    )
    parser.add_argument(
        "--skip-report",
        action="store_true",
        help="Skip the comparison report and run only the migration phase.",
    )
    return parser.parse_args()


def connect_source(args):
    return mysql.connector.connect(
        host=args.source_host,
        port=args.source_port,
        user=args.source_user,
        password=args.source_password,
        database=args.source_db,
        connection_timeout=10,
    )


def connect_target():
    cfg = load_mysql_config()
    return mysql.connector.connect(
        host=cfg["MYSQL_HOST"],
        port=cfg["MYSQL_PORT"],
        user=cfg["MYSQL_USER"],
        password=cfg["MYSQL_PASSWORD"],
        database=cfg["MYSQL_DB"],
        connection_timeout=cfg["MYSQL_CONNECT_TIMEOUT"],
        **cfg.get("MYSQL_CUSTOM_OPTIONS", {}),
    )


def fetch_one(cursor, query, params=None):
    cursor.execute(query, params or ())
    return cursor.fetchone()


def fetch_all(cursor, query, params=None):
    cursor.execute(query, params or ())
    return cursor.fetchall()


def report_counts(source_conn, target_conn):
    print("Count comparison")
    for table in TABLES:
        src_cursor = source_conn.cursor()
        tgt_cursor = target_conn.cursor()
        src_count = fetch_one(src_cursor, f"SELECT COUNT(*) FROM {table}")[0]
        tgt_count = fetch_one(tgt_cursor, f"SELECT COUNT(*) FROM {table}")[0]
        print(f"  {table}: source={src_count} target={tgt_count}")
        src_cursor.close()
        tgt_cursor.close()


def report_overlap(source_conn, target_conn):
    comparisons = [
        ("Users by email", "SELECT LOWER(email) FROM Users"),
        ("Users by phone", "SELECT phone FROM Users"),
        ("Stations by owner/name/location", "SELECT LOWER(station_name), LOWER(location), user_id FROM ChargingStation"),
        (
            "Bookings by user/slot/time",
            "SELECT user_id, slot_id, DATE_FORMAT(start_time, '%Y-%m-%d %H:%i:%s'), DATE_FORMAT(end_time, '%Y-%m-%d %H:%i:%s') FROM Booking",
        ),
    ]
    print("Overlap report")
    for label, query in comparisons:
        src_cursor = source_conn.cursor()
        tgt_cursor = target_conn.cursor()
        src_rows = {tuple(row) for row in fetch_all(src_cursor, query)}
        tgt_rows = {tuple(row) for row in fetch_all(tgt_cursor, query)}
        print(
            f"  {label}: source={len(src_rows)} target={len(tgt_rows)} "
            f"overlap={len(src_rows & tgt_rows)} source_only={len(src_rows - tgt_rows)}"
        )
        src_cursor.close()
        tgt_cursor.close()


def report_id_overlap(source_conn, target_conn):
    primary_keys = {
        "Users": "user_id",
        "Vehicle": "vehicle_id",
        "ChargingStation": "station_id",
        "StationApproval": "station_id",
        "ChargingSlot": "slot_id",
        "Booking": "booking_id",
        "ChargingSession": "session_id",
        "Payment": "payment_id",
        "UserAccountStatus": "user_id",
    }
    print("Primary key overlap")
    for table, pk in primary_keys.items():
        src_cursor = source_conn.cursor()
        tgt_cursor = target_conn.cursor()
        src_ids = {row[0] for row in fetch_all(src_cursor, f"SELECT {pk} FROM {table}")}
        tgt_ids = {row[0] for row in fetch_all(tgt_cursor, f"SELECT {pk} FROM {table}")}
        overlap = sorted(src_ids & tgt_ids)
        print(f"  {table}: overlapping_ids={len(overlap)}")
        if overlap:
            print(f"    sample={overlap[:10]}")
        src_cursor.close()
        tgt_cursor.close()


def lower_text(value):
    return str(value or "").strip().lower()


def migrate_users(src, tgt, apply):
    src_cursor = src.cursor(dictionary=True)
    tgt_cursor = tgt.cursor(dictionary=True)
    src_cursor.execute(
        """
        SELECT user_id, name, email, phone, password, role, registration_date
        FROM Users
        ORDER BY user_id
        """
    )
    tgt_cursor.execute("SELECT user_id, email, phone FROM Users")
    existing_rows = tgt_cursor.fetchall()
    users_by_email = {lower_text(row["email"]): row["user_id"] for row in existing_rows}
    users_by_phone = {str(row["phone"] or "").strip(): row["user_id"] for row in existing_rows}

    mapping = {}
    inserted = 0
    reused = 0

    for row in src_cursor.fetchall():
        email_key = lower_text(row["email"])
        phone_key = str(row["phone"] or "").strip()
        target_user_id = users_by_email.get(email_key) or users_by_phone.get(phone_key)
        if target_user_id:
            mapping[row["user_id"]] = target_user_id
            reused += 1
            continue

        if apply:
            tgt_cursor.execute(
                """
                INSERT INTO Users (name, email, phone, password, role, registration_date)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    row["name"],
                    row["email"],
                    row["phone"],
                    row["password"],
                    row["role"],
                    row["registration_date"],
                ),
            )
            target_user_id = tgt_cursor.lastrowid
            users_by_email[email_key] = target_user_id
            users_by_phone[phone_key] = target_user_id
        else:
            target_user_id = -int(row["user_id"])

        mapping[row["user_id"]] = target_user_id
        inserted += 1

    src_cursor.close()
    tgt_cursor.close()
    return mapping, {"inserted": inserted, "reused": reused}


def migrate_user_statuses(src, tgt, user_map, apply):
    src_cursor = src.cursor(dictionary=True)
    tgt_cursor = tgt.cursor(dictionary=True)
    src_cursor.execute(
        """
        SELECT user_id, status, updated_by, updated_at, reason, created_at
        FROM UserAccountStatus
        ORDER BY user_id
        """
    )
    tgt_cursor.execute("SELECT user_id FROM UserAccountStatus")
    existing = {row["user_id"] for row in tgt_cursor.fetchall()}

    inserted = 0
    skipped = 0
    for row in src_cursor.fetchall():
        mapped_user_id = user_map.get(row["user_id"])
        if not isinstance(mapped_user_id, int) or mapped_user_id in existing:
            skipped += 1
            continue

        mapped_updated_by = user_map.get(row["updated_by"]) if row["updated_by"] is not None else None
        if mapped_updated_by is not None and not isinstance(mapped_updated_by, int):
            mapped_updated_by = None

        if apply:
            tgt_cursor.execute(
                """
                INSERT INTO UserAccountStatus (user_id, status, updated_by, updated_at, reason, created_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    mapped_user_id,
                    row["status"],
                    mapped_updated_by,
                    row["updated_at"],
                    row["reason"],
                    row["created_at"],
                ),
            )
            existing.add(mapped_user_id)
        inserted += 1

    src_cursor.close()
    tgt_cursor.close()
    return {"inserted": inserted, "skipped": skipped}


def migrate_vehicles(src, tgt, user_map, apply):
    src_cursor = src.cursor(dictionary=True)
    tgt_cursor = tgt.cursor(dictionary=True)
    src_cursor.execute(
        """
        SELECT vehicle_id, user_id, vehicle_number, vehicle_type, battery_capacity
        FROM Vehicle
        ORDER BY vehicle_id
        """
    )
    tgt_cursor.execute("SELECT vehicle_id, vehicle_number FROM Vehicle")
    existing = {lower_text(row["vehicle_number"]): row["vehicle_id"] for row in tgt_cursor.fetchall()}

    mapping = {}
    inserted = 0
    reused = 0
    for row in src_cursor.fetchall():
        vehicle_key = lower_text(row["vehicle_number"])
        existing_vehicle_id = existing.get(vehicle_key)
        if existing_vehicle_id:
            mapping[row["vehicle_id"]] = existing_vehicle_id
            reused += 1
            continue

        mapped_user_id = user_map.get(row["user_id"])
        if not isinstance(mapped_user_id, int):
            raise RuntimeError(f"Missing mapped user for source vehicle_id={row['vehicle_id']}")

        if apply:
            tgt_cursor.execute(
                """
                INSERT INTO Vehicle (user_id, vehicle_number, vehicle_type, battery_capacity)
                VALUES (%s, %s, %s, %s)
                """,
                (mapped_user_id, row["vehicle_number"], row["vehicle_type"], row["battery_capacity"]),
            )
            target_vehicle_id = tgt_cursor.lastrowid
            existing[vehicle_key] = target_vehicle_id
        else:
            target_vehicle_id = -int(row["vehicle_id"])

        mapping[row["vehicle_id"]] = target_vehicle_id
        inserted += 1

    src_cursor.close()
    tgt_cursor.close()
    return mapping, {"inserted": inserted, "reused": reused}


def migrate_stations(src, tgt, user_map, apply):
    src_cursor = src.cursor(dictionary=True)
    tgt_cursor = tgt.cursor(dictionary=True)
    src_cursor.execute(
        """
        SELECT station_id, station_name, location, contact_number, total_slots, latitude, longitude, user_id
        FROM ChargingStation
        ORDER BY station_id
        """
    )
    tgt_cursor.execute("SELECT station_id, station_name, location, user_id FROM ChargingStation")
    existing = {
        (row["user_id"], lower_text(row["station_name"]), lower_text(row["location"])): row["station_id"]
        for row in tgt_cursor.fetchall()
    }

    mapping = {}
    inserted = 0
    reused = 0
    for row in src_cursor.fetchall():
        mapped_user_id = user_map.get(row["user_id"])
        if not isinstance(mapped_user_id, int):
            raise RuntimeError(f"Missing mapped user for source station_id={row['station_id']}")

        station_key = (mapped_user_id, lower_text(row["station_name"]), lower_text(row["location"]))
        target_station_id = existing.get(station_key)
        if target_station_id:
            mapping[row["station_id"]] = target_station_id
            reused += 1
            continue

        if apply:
            tgt_cursor.execute(
                """
                INSERT INTO ChargingStation (
                    station_name, location, contact_number, total_slots, latitude, longitude, user_id
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    row["station_name"],
                    row["location"],
                    row["contact_number"],
                    row["total_slots"],
                    row["latitude"],
                    row["longitude"],
                    mapped_user_id,
                ),
            )
            target_station_id = tgt_cursor.lastrowid
            existing[station_key] = target_station_id
        else:
            target_station_id = -int(row["station_id"])

        mapping[row["station_id"]] = target_station_id
        inserted += 1

    src_cursor.close()
    tgt_cursor.close()
    return mapping, {"inserted": inserted, "reused": reused}


def migrate_station_approvals(src, tgt, station_map, user_map, apply):
    src_cursor = src.cursor(dictionary=True)
    tgt_cursor = tgt.cursor(dictionary=True)
    src_cursor.execute(
        """
        SELECT station_id, status, reviewed_by, reviewed_at, remarks, created_at, updated_at
        FROM StationApproval
        ORDER BY station_id
        """
    )
    tgt_cursor.execute("SELECT station_id FROM StationApproval")
    existing = {row["station_id"] for row in tgt_cursor.fetchall()}

    inserted = 0
    skipped = 0
    for row in src_cursor.fetchall():
        mapped_station_id = station_map.get(row["station_id"])
        if not isinstance(mapped_station_id, int) or mapped_station_id in existing:
            skipped += 1
            continue

        mapped_reviewed_by = user_map.get(row["reviewed_by"]) if row["reviewed_by"] is not None else None
        if mapped_reviewed_by is not None and not isinstance(mapped_reviewed_by, int):
            mapped_reviewed_by = None

        if apply:
            tgt_cursor.execute(
                """
                INSERT INTO StationApproval (
                    station_id, status, reviewed_by, reviewed_at, remarks, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    mapped_station_id,
                    row["status"],
                    mapped_reviewed_by,
                    row["reviewed_at"],
                    row["remarks"],
                    row["created_at"],
                    row["updated_at"],
                ),
            )
            existing.add(mapped_station_id)
        inserted += 1

    src_cursor.close()
    tgt_cursor.close()
    return {"inserted": inserted, "skipped": skipped}


def migrate_slots(src, tgt, station_map, apply):
    src_cursor = src.cursor(dictionary=True)
    tgt_cursor = tgt.cursor(dictionary=True)
    src_cursor.execute(
        """
        SELECT
            slot_id,
            station_id,
            slot_number,
            slot_type,
            charger_name,
            vehicle_category,
            power_kw,
            connector_type,
            price_per_kwh,
            price_per_minute,
            status
        FROM ChargingSlot
        ORDER BY slot_id
        """
    )
    tgt_cursor.execute("SELECT slot_id, station_id, slot_number FROM ChargingSlot")
    existing = {(row["station_id"], row["slot_number"]): row["slot_id"] for row in tgt_cursor.fetchall()}

    mapping = {}
    inserted = 0
    reused = 0
    for row in src_cursor.fetchall():
        mapped_station_id = station_map.get(row["station_id"])
        if not isinstance(mapped_station_id, int):
            raise RuntimeError(f"Missing mapped station for source slot_id={row['slot_id']}")

        slot_key = (mapped_station_id, row["slot_number"])
        target_slot_id = existing.get(slot_key)
        if target_slot_id:
            mapping[row["slot_id"]] = target_slot_id
            reused += 1
            continue

        if apply:
            tgt_cursor.execute(
                """
                INSERT INTO ChargingSlot (
                    station_id,
                    slot_number,
                    slot_type,
                    charger_name,
                    vehicle_category,
                    power_kw,
                    connector_type,
                    price_per_kwh,
                    price_per_minute,
                    status
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    mapped_station_id,
                    row["slot_number"],
                    row["slot_type"],
                    row["charger_name"],
                    row["vehicle_category"],
                    row["power_kw"],
                    row["connector_type"],
                    row["price_per_kwh"],
                    row["price_per_minute"],
                    row["status"],
                ),
            )
            target_slot_id = tgt_cursor.lastrowid
            existing[slot_key] = target_slot_id
        else:
            target_slot_id = -int(row["slot_id"])

        mapping[row["slot_id"]] = target_slot_id
        inserted += 1

    src_cursor.close()
    tgt_cursor.close()
    return mapping, {"inserted": inserted, "reused": reused}


def migrate_bookings(src, tgt, user_map, slot_map, apply):
    src_cursor = src.cursor(dictionary=True)
    tgt_cursor = tgt.cursor(dictionary=True)
    src_cursor.execute(
        """
        SELECT
            booking_id,
            user_id,
            slot_id,
            start_time,
            end_time,
            status,
            vehicle_category,
            battery_capacity_kwh,
            current_battery_percent,
            target_battery_percent,
            energy_required_kwh,
            estimated_duration_minutes,
            qr_verified_at,
            qr_verified_by,
            created_at
        FROM Booking
        ORDER BY booking_id
        """
    )
    tgt_cursor.execute("SELECT booking_id, user_id, slot_id, start_time, end_time FROM Booking")
    existing = {
        (row["user_id"], row["slot_id"], row["start_time"], row["end_time"]): row["booking_id"]
        for row in tgt_cursor.fetchall()
    }

    mapping = {}
    inserted = 0
    reused = 0
    for row in src_cursor.fetchall():
        mapped_user_id = user_map.get(row["user_id"])
        mapped_slot_id = slot_map.get(row["slot_id"])
        if not isinstance(mapped_user_id, int):
            raise RuntimeError(f"Missing mapped user for source booking_id={row['booking_id']}")
        if not isinstance(mapped_slot_id, int):
            raise RuntimeError(f"Missing mapped slot for source booking_id={row['booking_id']}")

        booking_key = (mapped_user_id, mapped_slot_id, row["start_time"], row["end_time"])
        target_booking_id = existing.get(booking_key)
        if target_booking_id:
            mapping[row["booking_id"]] = target_booking_id
            reused += 1
            continue

        mapped_verified_by = user_map.get(row["qr_verified_by"]) if row["qr_verified_by"] is not None else None
        if mapped_verified_by is not None and not isinstance(mapped_verified_by, int):
            mapped_verified_by = None

        if apply:
            tgt_cursor.execute(
                """
                INSERT INTO Booking (
                    user_id,
                    slot_id,
                    start_time,
                    end_time,
                    status,
                    vehicle_category,
                    battery_capacity_kwh,
                    current_battery_percent,
                    target_battery_percent,
                    energy_required_kwh,
                    estimated_duration_minutes,
                    qr_verified_at,
                    qr_verified_by,
                    created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    mapped_user_id,
                    mapped_slot_id,
                    row["start_time"],
                    row["end_time"],
                    row["status"],
                    row["vehicle_category"],
                    row["battery_capacity_kwh"],
                    row["current_battery_percent"],
                    row["target_battery_percent"],
                    row["energy_required_kwh"],
                    row["estimated_duration_minutes"],
                    row["qr_verified_at"],
                    mapped_verified_by,
                    row["created_at"],
                ),
            )
            target_booking_id = tgt_cursor.lastrowid
            existing[booking_key] = target_booking_id
        else:
            target_booking_id = -int(row["booking_id"])

        mapping[row["booking_id"]] = target_booking_id
        inserted += 1

    src_cursor.close()
    tgt_cursor.close()
    return mapping, {"inserted": inserted, "reused": reused}


def migrate_sessions(src, tgt, booking_map, apply):
    src_cursor = src.cursor(dictionary=True)
    tgt_cursor = tgt.cursor(dictionary=True)
    src_cursor.execute(
        """
        SELECT session_id, booking_id, start_time, end_time, units_consumed, total_cost
        FROM ChargingSession
        ORDER BY session_id
        """
    )
    tgt_cursor.execute("SELECT booking_id FROM ChargingSession")
    existing = {row["booking_id"] for row in tgt_cursor.fetchall()}

    inserted = 0
    skipped = 0
    for row in src_cursor.fetchall():
        mapped_booking_id = booking_map.get(row["booking_id"])
        if not isinstance(mapped_booking_id, int) or mapped_booking_id in existing:
            skipped += 1
            continue

        if apply:
            tgt_cursor.execute(
                """
                INSERT INTO ChargingSession (booking_id, start_time, end_time, units_consumed, total_cost)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    mapped_booking_id,
                    row["start_time"],
                    row["end_time"],
                    row["units_consumed"],
                    row["total_cost"],
                ),
            )
            existing.add(mapped_booking_id)
        inserted += 1

    src_cursor.close()
    tgt_cursor.close()
    return {"inserted": inserted, "skipped": skipped}


def migrate_payments(src, tgt, booking_map, apply):
    src_cursor = src.cursor(dictionary=True)
    tgt_cursor = tgt.cursor(dictionary=True)
    src_cursor.execute(
        """
        SELECT payment_id, booking_id, amount, payment_method, payment_status, payment_date
        FROM Payment
        ORDER BY payment_id
        """
    )
    tgt_cursor.execute("SELECT booking_id FROM Payment")
    existing = {row["booking_id"] for row in tgt_cursor.fetchall()}

    inserted = 0
    skipped = 0
    for row in src_cursor.fetchall():
        mapped_booking_id = booking_map.get(row["booking_id"])
        if not isinstance(mapped_booking_id, int) or mapped_booking_id in existing:
            skipped += 1
            continue

        if apply:
            tgt_cursor.execute(
                """
                INSERT INTO Payment (booking_id, amount, payment_method, payment_status, payment_date)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    mapped_booking_id,
                    row["amount"],
                    row["payment_method"],
                    row["payment_status"],
                    row["payment_date"],
                ),
            )
            existing.add(mapped_booking_id)
        inserted += 1

    src_cursor.close()
    tgt_cursor.close()
    return {"inserted": inserted, "skipped": skipped}


def run_migration(source_conn, target_conn, apply):
    if apply:
        pass

    user_map, user_stats = migrate_users(source_conn, target_conn, apply=apply)
    _, vehicle_stats = migrate_vehicles(source_conn, target_conn, user_map=user_map, apply=apply)
    station_map, station_stats = migrate_stations(source_conn, target_conn, user_map=user_map, apply=apply)
    slot_map, slot_stats = migrate_slots(source_conn, target_conn, station_map=station_map, apply=apply)
    booking_map, booking_stats = migrate_bookings(
        source_conn,
        target_conn,
        user_map=user_map,
        slot_map=slot_map,
        apply=apply,
    )
    session_stats = migrate_sessions(source_conn, target_conn, booking_map=booking_map, apply=apply)
    payment_stats = migrate_payments(source_conn, target_conn, booking_map=booking_map, apply=apply)
    approval_stats = migrate_station_approvals(
        source_conn,
        target_conn,
        station_map=station_map,
        user_map=user_map,
        apply=apply,
    )
    user_status_stats = migrate_user_statuses(source_conn, target_conn, user_map=user_map, apply=apply)

    if apply:
        target_conn.commit()
    else:
        target_conn.rollback()

    print("Migration summary")
    print(f"  Users: {user_stats}")
    print(f"  Vehicles: {vehicle_stats}")
    print(f"  Stations: {station_stats}")
    print(f"  Slots: {slot_stats}")
    print(f"  Bookings: {booking_stats}")
    print(f"  ChargingSession: {session_stats}")
    print(f"  Payment: {payment_stats}")
    print(f"  StationApproval: {approval_stats}")
    print(f"  UserAccountStatus: {user_status_stats}")
    print(f"  Mode: {'APPLIED' if apply else 'DRY RUN'}")


def main():
    args = parse_args()
    source_conn = connect_source(args)
    target_conn = connect_target()

    try:
        if not args.skip_report:
            report_counts(source_conn, target_conn)
            report_overlap(source_conn, target_conn)
            report_id_overlap(source_conn, target_conn)
            print("")

        run_migration(source_conn, target_conn, apply=args.apply)
    finally:
        source_conn.close()
        target_conn.close()


if __name__ == "__main__":
    main()
