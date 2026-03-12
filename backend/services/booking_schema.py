from services.booking_config import (
    BOOKING_STATUS_CANCELLED,
    BOOKING_STATUS_CHARGING_COMPLETED,
    BOOKING_STATUS_CHARGING_STARTED,
    BOOKING_STATUS_WAITING_TO_START,
    LEGACY_BOOKING_STATUS_COMPLETED,
    LEGACY_BOOKING_STATUS_CONFIRMED,
)
from services.charging_profiles import (
    VEHICLE_CATEGORY_CAR,
    default_connector_type,
    default_power_kw,
)


def _column_exists(cursor, table_name, column_name):
    cursor.execute(f"SHOW COLUMNS FROM {table_name} LIKE %s", (column_name,))
    return cursor.fetchone() is not None


def _ensure_charging_slot_schema(cursor):
    cursor.execute("SHOW COLUMNS FROM ChargingSlot LIKE 'status'")
    status_column = cursor.fetchone()
    if status_column:
        status_type = str(status_column[1] or "").lower()
        if "charging" not in status_type:
            cursor.execute(
                """
                ALTER TABLE ChargingSlot
                MODIFY COLUMN status ENUM('available', 'occupied', 'charging') DEFAULT 'available'
                """
            )

    if not _column_exists(cursor, "ChargingSlot", "power_kw"):
        cursor.execute(
            """
            ALTER TABLE ChargingSlot
            ADD COLUMN power_kw DECIMAL(6,2) NOT NULL DEFAULT 7.00
            """
        )

    if not _column_exists(cursor, "ChargingSlot", "price_per_kwh"):
        cursor.execute(
            """
            ALTER TABLE ChargingSlot
            ADD COLUMN price_per_kwh DECIMAL(8,2) NULL
            """
        )

    if not _column_exists(cursor, "ChargingSlot", "price_per_minute"):
        cursor.execute(
            """
            ALTER TABLE ChargingSlot
            ADD COLUMN price_per_minute DECIMAL(8,2) NULL
            """
        )

    if not _column_exists(cursor, "ChargingSlot", "charger_name"):
        cursor.execute(
            """
            ALTER TABLE ChargingSlot
            ADD COLUMN charger_name VARCHAR(100) NULL
            """
        )

    if not _column_exists(cursor, "ChargingSlot", "vehicle_category"):
        cursor.execute(
            """
            ALTER TABLE ChargingSlot
            ADD COLUMN vehicle_category ENUM('bike_scooter', 'car') NOT NULL DEFAULT 'car'
            """
        )

    if not _column_exists(cursor, "ChargingSlot", "connector_type"):
        cursor.execute(
            """
            ALTER TABLE ChargingSlot
            ADD COLUMN connector_type VARCHAR(50) NULL
            """
        )

    cursor.execute(
        """
        UPDATE ChargingSlot
        SET charger_name = CONCAT('Charger ', slot_number)
        WHERE charger_name IS NULL OR TRIM(charger_name) = ''
        """
    )
    cursor.execute(
        """
        UPDATE ChargingSlot
        SET vehicle_category = %s
        WHERE vehicle_category IS NULL OR TRIM(vehicle_category) = ''
        """,
        (VEHICLE_CATEGORY_CAR,),
    )
    cursor.execute(
        """
        UPDATE ChargingSlot
        SET power_kw = CASE
            WHEN slot_type = 'fast' THEN %s
            ELSE %s
        END
        WHERE power_kw IS NULL OR power_kw <= 0
        """,
        (
            default_power_kw(VEHICLE_CATEGORY_CAR, "fast"),
            default_power_kw(VEHICLE_CATEGORY_CAR, "normal"),
        ),
    )
    cursor.execute(
        """
        UPDATE ChargingSlot
        SET connector_type = CASE
            WHEN slot_type = 'fast' THEN %s
            ELSE %s
        END
        WHERE connector_type IS NULL OR TRIM(connector_type) = ''
        """,
        (
            default_connector_type(VEHICLE_CATEGORY_CAR, "fast"),
            default_connector_type(VEHICLE_CATEGORY_CAR, "normal"),
        ),
    )


def _ensure_booking_schema(cursor):
    status_column = None
    cursor.execute("SHOW COLUMNS FROM Booking LIKE 'status'")
    status_column = cursor.fetchone()
    if status_column:
        status_type = str(status_column[1] or "").lower()
        required_statuses = [
            BOOKING_STATUS_WAITING_TO_START,
            BOOKING_STATUS_CHARGING_STARTED,
            BOOKING_STATUS_CHARGING_COMPLETED,
            BOOKING_STATUS_CANCELLED,
            LEGACY_BOOKING_STATUS_CONFIRMED,
            LEGACY_BOOKING_STATUS_COMPLETED,
        ]
        if any(status not in status_type for status in required_statuses):
            cursor.execute(
                """
                ALTER TABLE Booking
                MODIFY COLUMN status ENUM(
                    'waiting_to_start',
                    'charging_started',
                    'charging_completed',
                    'cancelled',
                    'confirmed',
                    'completed'
                ) NOT NULL DEFAULT 'waiting_to_start'
                """
            )

    booking_columns = {
        "vehicle_category": "ALTER TABLE Booking ADD COLUMN vehicle_category ENUM('bike_scooter', 'car') NOT NULL DEFAULT 'car'",
        "battery_capacity_kwh": "ALTER TABLE Booking ADD COLUMN battery_capacity_kwh DECIMAL(6,2) NULL",
        "current_battery_percent": "ALTER TABLE Booking ADD COLUMN current_battery_percent DECIMAL(5,2) NULL",
        "target_battery_percent": "ALTER TABLE Booking ADD COLUMN target_battery_percent DECIMAL(5,2) NULL",
        "energy_required_kwh": "ALTER TABLE Booking ADD COLUMN energy_required_kwh DECIMAL(8,3) NULL",
        "estimated_duration_minutes": "ALTER TABLE Booking ADD COLUMN estimated_duration_minutes INT NULL",
        "qr_verified_at": "ALTER TABLE Booking ADD COLUMN qr_verified_at DATETIME NULL",
        "qr_verified_by": "ALTER TABLE Booking ADD COLUMN qr_verified_by INT NULL",
    }
    for column_name, ddl in booking_columns.items():
        if not _column_exists(cursor, "Booking", column_name):
            cursor.execute(ddl)

    cursor.execute(
        """
        UPDATE Booking b
        JOIN ChargingSlot sl ON sl.slot_id = b.slot_id
        LEFT JOIN ChargingSession sess ON sess.booking_id = b.booking_id
        SET
            b.status = CASE
                WHEN b.status = %s AND sess.start_time IS NOT NULL AND b.end_time <= NOW() THEN %s
                WHEN b.status = %s AND sess.start_time IS NOT NULL THEN %s
                WHEN b.status = %s THEN %s
                WHEN b.status = %s THEN %s
                ELSE b.status
            END,
            b.vehicle_category = COALESCE(b.vehicle_category, sl.vehicle_category, %s),
            b.estimated_duration_minutes = COALESCE(
                b.estimated_duration_minutes,
                GREATEST(TIMESTAMPDIFF(MINUTE, b.start_time, b.end_time), 0)
            ),
            b.qr_verified_at = COALESCE(b.qr_verified_at, sess.start_time)
        """
        ,
        (
            LEGACY_BOOKING_STATUS_CONFIRMED,
            BOOKING_STATUS_CHARGING_COMPLETED,
            LEGACY_BOOKING_STATUS_CONFIRMED,
            BOOKING_STATUS_CHARGING_STARTED,
            LEGACY_BOOKING_STATUS_CONFIRMED,
            BOOKING_STATUS_WAITING_TO_START,
            LEGACY_BOOKING_STATUS_COMPLETED,
            BOOKING_STATUS_CHARGING_COMPLETED,
            VEHICLE_CATEGORY_CAR,
        ),
    )


def ensure_phase5_tables(cursor):
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS ChargingSession (
            session_id INT PRIMARY KEY AUTO_INCREMENT,
            booking_id INT NOT NULL UNIQUE,
            start_time DATETIME,
            end_time DATETIME,
            units_consumed DECIMAL(6,2),
            total_cost DECIMAL(8,2),
            FOREIGN KEY (booking_id) REFERENCES Booking(booking_id) ON DELETE CASCADE
        )
        """
    )
    _ensure_charging_slot_schema(cursor)
    _ensure_booking_schema(cursor)
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS Payment (
            payment_id INT PRIMARY KEY AUTO_INCREMENT,
            booking_id INT NOT NULL UNIQUE,
            amount DECIMAL(8,2) NOT NULL,
            payment_method ENUM('upi', 'card', 'cash') NOT NULL,
            payment_status ENUM('pending', 'paid', 'failed') DEFAULT 'pending',
            payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (booking_id) REFERENCES Booking(booking_id) ON DELETE CASCADE
        )
        """
    )
