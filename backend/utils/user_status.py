USER_STATUS_ACTIVE = "active"
USER_STATUS_SUSPENDED = "suspended"
USER_STATUS_DISABLED = "disabled"

USER_STATUSES = {
    USER_STATUS_ACTIVE,
    USER_STATUS_SUSPENDED,
    USER_STATUS_DISABLED,
}


def ensure_user_status_table(cursor):
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS UserAccountStatus (
            user_id INT PRIMARY KEY,
            status ENUM('active', 'suspended', 'disabled') NOT NULL DEFAULT 'active',
            updated_by INT NULL,
            updated_at DATETIME NULL,
            reason VARCHAR(255) NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE,
            FOREIGN KEY (updated_by) REFERENCES Users(user_id) ON DELETE SET NULL
        )
        """
    )


def backfill_missing_user_status(cursor, default_status=USER_STATUS_ACTIVE):
    cursor.execute(
        """
        INSERT INTO UserAccountStatus (user_id, status)
        SELECT u.user_id, %s
        FROM Users u
        LEFT JOIN UserAccountStatus uas ON uas.user_id = u.user_id
        WHERE uas.user_id IS NULL
        """,
        (default_status,),
    )

