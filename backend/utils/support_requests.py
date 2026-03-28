import secrets
from datetime import datetime


SUPPORT_CATEGORIES = {
    "booking",
    "charging",
    "payment",
    "station",
    "account",
    "other",
}

SUPPORT_PRIORITIES = {
    "low",
    "normal",
    "high",
    "urgent",
}

SUPPORT_STATUSES = {
    "open",
    "in_progress",
    "resolved",
    "closed",
}

SUPPORT_EMAIL_STATUSES = {
    "pending",
    "sent",
    "skipped",
    "failed",
}


def ensure_support_request_table(cursor):
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS SupportRequest (
            request_id INT AUTO_INCREMENT PRIMARY KEY,
            ticket_number VARCHAR(32) NOT NULL UNIQUE,
            user_id INT NOT NULL,
            user_role ENUM('customer', 'owner') NOT NULL,
            requester_name VARCHAR(120) NOT NULL,
            requester_email VARCHAR(255) NOT NULL,
            requester_phone VARCHAR(20) NULL,
            category ENUM('booking', 'charging', 'payment', 'station', 'account', 'other') NOT NULL DEFAULT 'other',
            priority ENUM('low', 'normal', 'high', 'urgent') NOT NULL DEFAULT 'normal',
            subject VARCHAR(160) NOT NULL,
            message TEXT NOT NULL,
            booking_id INT NULL,
            station_id INT NULL,
            status ENUM('open', 'in_progress', 'resolved', 'closed') NOT NULL DEFAULT 'open',
            admin_email_status ENUM('pending', 'sent', 'skipped', 'failed') NOT NULL DEFAULT 'pending',
            admin_email_error VARCHAR(255) NULL,
            last_emailed_at DATETIME NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_support_user_created (user_id, created_at),
            INDEX idx_support_status_created (status, created_at),
            CONSTRAINT fk_support_request_user FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE,
            CONSTRAINT fk_support_request_booking FOREIGN KEY (booking_id) REFERENCES Booking(booking_id) ON DELETE SET NULL,
            CONSTRAINT fk_support_request_station FOREIGN KEY (station_id) REFERENCES ChargingStation(station_id) ON DELETE SET NULL
        )
        """
    )


def generate_support_ticket_number(now=None):
    reference_time = now or datetime.utcnow()
    return f"SUP-{reference_time.strftime('%Y%m%d')}-{secrets.token_hex(3).upper()}"
