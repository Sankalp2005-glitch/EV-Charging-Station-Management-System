from MySQLdb import OperationalError

from services.booking_config import GRACE_PERIOD_MINUTES
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
            WHERE b.status = 'confirmed'
              AND b.start_time <= DATE_SUB(NOW(), INTERVAL %s MINUTE)
              AND cs.start_time IS NULL
            """,
            (GRACE_PERIOD_MINUTES,),
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
        SET b.status = 'cancelled'
        WHERE b.status = 'confirmed'
          AND b.start_time <= DATE_SUB(NOW(), INTERVAL %s MINUTE)
          AND cs.start_time IS NULL
        """,
        (GRACE_PERIOD_MINUTES,),
    )

    return [
        {
            "booking_id": int(row[0]),
            "slot_id": int(row[1]),
            "station_id": int(row[2]),
            "status": "cancelled",
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
        WHERE b.status = 'confirmed'
          AND b.end_time <= NOW()
        """
    )
    rows = cursor.fetchall()
    if not rows:
        return []

    cursor.execute(
        """
        UPDATE Booking
        SET status = 'completed'
        WHERE status = 'confirmed' AND end_time <= NOW()
        """
    )
    return [
        {
            "booking_id": int(row[0]),
            "slot_id": int(row[1]),
            "station_id": int(row[2]),
            "status": "completed",
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
        SET sl.status = 'occupied'
        WHERE b.status = 'confirmed'
          AND b.start_time <= NOW()
          AND b.end_time > NOW()
        """
    )


def refresh_single_slot_status(cursor, slot_id):
    cursor.execute(
        """
        SELECT 1
        FROM Booking
        WHERE slot_id = %s
          AND status = 'confirmed'
          AND start_time <= NOW()
          AND end_time > NOW()
        LIMIT 1
        """,
        (slot_id,),
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
