from MySQLdb import OperationalError

from services.booking_config import (
    BOOKING_STATUS_CANCELLED,
    BOOKING_STATUS_CHARGING_COMPLETED,
    BOOKING_STATUS_CHARGING_STARTED,
    BOOKING_STATUS_WAITING_TO_START,
    GRACE_PERIOD_MINUTES,
    LEGACY_BOOKING_STATUS_CONFIRMED,
)
from services.db_errors import is_missing_table_error
from utils.realtime_events import emit_booking_update


def auto_release_no_show_bookings(cursor):
    try:
        cursor.execute(
            """
            SELECT b.booking_id, b.slot_id, sl.station_id
            FROM Booking b
            JOIN ChargingSlot sl ON sl.slot_id = b.slot_id
            LEFT JOIN ChargingSession cs ON cs.booking_id = b.booking_id
            WHERE b.status IN (%s, %s)
              AND b.start_time <= DATE_SUB(NOW(), INTERVAL %s MINUTE)
              AND cs.start_time IS NULL
            """,
            (BOOKING_STATUS_WAITING_TO_START, LEGACY_BOOKING_STATUS_CONFIRMED, GRACE_PERIOD_MINUTES),
        )
        rows = cursor.fetchall()
    except OperationalError as error:
        if is_missing_table_error(error):
            return []
        raise

    if not rows:
        return []

    cursor.execute(
        """
        UPDATE Booking b
        LEFT JOIN ChargingSession cs ON cs.booking_id = b.booking_id
        SET b.status = %s
        WHERE b.status IN (%s, %s)
          AND b.start_time <= DATE_SUB(NOW(), INTERVAL %s MINUTE)
          AND cs.start_time IS NULL
        """,
        (
            BOOKING_STATUS_CANCELLED,
            BOOKING_STATUS_WAITING_TO_START,
            LEGACY_BOOKING_STATUS_CONFIRMED,
            GRACE_PERIOD_MINUTES,
        ),
    )

    return [
        {
            "booking_id": int(row[0]),
            "slot_id": int(row[1]),
            "station_id": int(row[2]),
            "status": BOOKING_STATUS_CANCELLED,
            "event_type": "booking_auto_cancelled_no_show",
        }
        for row in rows
    ]


def mark_expired_bookings(cursor):
    cursor.execute(
        """
        SELECT b.booking_id, b.slot_id, sl.station_id
        FROM Booking b
        JOIN ChargingSlot sl ON sl.slot_id = b.slot_id
        LEFT JOIN ChargingSession cs ON cs.booking_id = b.booking_id
        WHERE b.status IN (%s, %s)
          AND cs.start_time IS NOT NULL
          AND b.end_time <= NOW()
        """,
        (BOOKING_STATUS_CHARGING_STARTED, LEGACY_BOOKING_STATUS_CONFIRMED),
    )
    rows = cursor.fetchall()
    if not rows:
        return []

    cursor.execute(
        """
        UPDATE ChargingSession cs
        JOIN Booking b ON b.booking_id = cs.booking_id
        LEFT JOIN Payment p ON p.booking_id = b.booking_id
        SET
            cs.end_time = COALESCE(cs.end_time, b.end_time),
            cs.units_consumed = COALESCE(cs.units_consumed, b.energy_required_kwh),
            cs.total_cost = COALESCE(cs.total_cost, p.amount)
        WHERE b.status IN (%s, %s)
          AND cs.start_time IS NOT NULL
          AND b.end_time <= NOW()
        """,
        (BOOKING_STATUS_CHARGING_STARTED, LEGACY_BOOKING_STATUS_CONFIRMED),
    )

    cursor.execute(
        """
        UPDATE Booking
        SET status = %s
        WHERE status IN (%s, %s)
          AND booking_id IN (
              SELECT booking_id
              FROM ChargingSession
              WHERE start_time IS NOT NULL
          )
          AND end_time <= NOW()
        """,
        (
            BOOKING_STATUS_CHARGING_COMPLETED,
            BOOKING_STATUS_CHARGING_STARTED,
            LEGACY_BOOKING_STATUS_CONFIRMED,
        ),
    )
    return [
        {
            "booking_id": int(row[0]),
            "slot_id": int(row[1]),
            "station_id": int(row[2]),
            "status": BOOKING_STATUS_CHARGING_COMPLETED,
            "event_type": "booking_completed",
        }
        for row in rows
    ]


def sync_slot_statuses(cursor):
    cursor.execute("UPDATE ChargingSlot SET status = 'available'")
    cursor.execute(
        """
        UPDATE ChargingSlot sl
        JOIN Booking b ON b.slot_id = sl.slot_id
        JOIN ChargingSession cs ON cs.booking_id = b.booking_id
        SET sl.status = 'charging'
        WHERE b.status IN (%s, %s)
          AND cs.start_time IS NOT NULL
          AND b.start_time <= NOW()
          AND b.end_time > NOW()
        """,
        (
            BOOKING_STATUS_CHARGING_STARTED,
            LEGACY_BOOKING_STATUS_CONFIRMED,
        ),
    )
    cursor.execute(
        """
        UPDATE ChargingSlot sl
        JOIN Booking b ON b.slot_id = sl.slot_id
        LEFT JOIN ChargingSession cs ON cs.booking_id = b.booking_id
        SET sl.status = 'occupied'
        WHERE b.status IN (%s, %s)
          AND cs.start_time IS NULL
          AND b.start_time <= NOW()
          AND b.end_time > NOW()
        """,
        (
            BOOKING_STATUS_WAITING_TO_START,
            LEGACY_BOOKING_STATUS_CONFIRMED,
        ),
    )


def refresh_single_slot_status(cursor, slot_id):
    cursor.execute(
        """
        SELECT 1
        FROM Booking b
        JOIN ChargingSession cs ON cs.booking_id = b.booking_id
        WHERE b.slot_id = %s
          AND b.status IN (%s, %s)
          AND cs.start_time IS NOT NULL
          AND b.start_time <= NOW()
          AND b.end_time > NOW()
        LIMIT 1
        """,
        (
            slot_id,
            BOOKING_STATUS_CHARGING_STARTED,
            LEGACY_BOOKING_STATUS_CONFIRMED,
        ),
    )
    if cursor.fetchone():
        cursor.execute(
            "UPDATE ChargingSlot SET status = 'charging' WHERE slot_id = %s",
            (slot_id,),
        )
        return

    cursor.execute(
        """
        SELECT 1
        FROM Booking b
        LEFT JOIN ChargingSession cs ON cs.booking_id = b.booking_id
        WHERE b.slot_id = %s
          AND b.status IN (%s, %s)
          AND cs.start_time IS NULL
          AND b.start_time <= NOW()
          AND b.end_time > NOW()
        LIMIT 1
        """,
        (
            slot_id,
            BOOKING_STATUS_WAITING_TO_START,
            LEGACY_BOOKING_STATUS_CONFIRMED,
        ),
    )
    status = "occupied" if cursor.fetchone() else "available"
    cursor.execute(
        "UPDATE ChargingSlot SET status = %s WHERE slot_id = %s",
        (status, slot_id),
    )


def emit_lifecycle_updates(records):
    for record in records:
        emit_booking_update(
            record.get("event_type") or "booking_status_changed",
            station_id=record.get("station_id"),
            slot_id=record.get("slot_id"),
            booking_id=record.get("booking_id"),
            status=record.get("status"),
        )


def run_booking_lifecycle_updates(cursor):
    released = auto_release_no_show_bookings(cursor)
    completed = mark_expired_bookings(cursor)
    sync_slot_statuses(cursor)
    return released + completed
