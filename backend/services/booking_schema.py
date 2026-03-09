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
