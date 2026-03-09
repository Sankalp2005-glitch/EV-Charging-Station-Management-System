APPROVAL_STATUS_PENDING = "pending"
APPROVAL_STATUS_APPROVED = "approved"
APPROVAL_STATUS_REJECTED = "rejected"
APPROVAL_STATUSES = {
    APPROVAL_STATUS_PENDING,
    APPROVAL_STATUS_APPROVED,
    APPROVAL_STATUS_REJECTED,
}


def ensure_station_approval_table(cursor):
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS StationApproval (
            station_id INT PRIMARY KEY,
            status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
            reviewed_by INT NULL,
            reviewed_at DATETIME NULL,
            remarks VARCHAR(255) NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (station_id) REFERENCES ChargingStation(station_id) ON DELETE CASCADE,
            FOREIGN KEY (reviewed_by) REFERENCES Users(user_id) ON DELETE SET NULL
        )
        """
    )


def backfill_missing_station_approvals(cursor, default_status=APPROVAL_STATUS_APPROVED):
    cursor.execute(
        """
        INSERT INTO StationApproval (station_id, status)
        SELECT cs.station_id, %s
        FROM ChargingStation cs
        LEFT JOIN StationApproval sa ON sa.station_id = cs.station_id
        WHERE sa.station_id IS NULL
        """,
        (default_status,),
    )
