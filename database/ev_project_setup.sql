CREATE DATABASE ev_charging_system;
USE ev_charging_system;

CREATE TABLE Users (
    user_id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    phone VARCHAR(13) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role ENUM('customer', 'owner', 'admin') NOT NULL,
    registration_date DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Vehicle (
    vehicle_id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    vehicle_number VARCHAR(15) NOT NULL UNIQUE,
    vehicle_type ENUM('two-wheeler', 'four-wheeler') NOT NULL,
    battery_capacity DECIMAL(5,2),
    FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE
);

CREATE TABLE ChargingStation (
    station_id INT PRIMARY KEY AUTO_INCREMENT,
    station_name VARCHAR(50) NOT NULL,
    location VARCHAR(100) NOT NULL,
    contact_number VARCHAR(13),
    total_slots INT NOT NULL,
    user_id INT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE
);

CREATE TABLE StationApproval (
    station_id INT PRIMARY KEY,
    status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    reviewed_by INT NULL,
    reviewed_at DATETIME NULL,
    remarks VARCHAR(255) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (station_id) REFERENCES ChargingStation(station_id) ON DELETE CASCADE,
    FOREIGN KEY (reviewed_by) REFERENCES Users(user_id) ON DELETE SET NULL
);

CREATE TABLE ChargingSlot (
    slot_id INT PRIMARY KEY AUTO_INCREMENT,
    station_id INT NOT NULL,
    slot_number INT NOT NULL,
    slot_type ENUM('fast', 'normal') NOT NULL,
    charger_name VARCHAR(100) NOT NULL,
    vehicle_category ENUM('bike_scooter', 'car') NOT NULL DEFAULT 'car',
    power_kw DECIMAL(6,2) NOT NULL,
    connector_type VARCHAR(50) NOT NULL,
    price_per_kwh DECIMAL(8,2),
    price_per_minute DECIMAL(8,2),
    status ENUM('available', 'occupied', 'charging', 'out_of_service') DEFAULT 'available',
    FOREIGN KEY (station_id) REFERENCES ChargingStation(station_id) ON DELETE CASCADE,
    UNIQUE (station_id, slot_number)
);

CREATE TABLE Booking (
    booking_id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    slot_id INT NOT NULL,
    start_time DATETIME NOT NULL,
    end_time DATETIME NOT NULL,
    status ENUM(
        'waiting_to_start',
        'charging_started',
        'charging_completed',
        'cancelled',
        'confirmed',
        'completed'
    ) DEFAULT 'waiting_to_start',
    vehicle_category ENUM('bike_scooter', 'car') NOT NULL DEFAULT 'car',
    battery_capacity_kwh DECIMAL(6,2),
    current_battery_percent DECIMAL(5,2),
    target_battery_percent DECIMAL(5,2),
    energy_required_kwh DECIMAL(8,3),
    estimated_duration_minutes INT,
    qr_verified_at DATETIME NULL,
    qr_verified_by INT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (slot_id) REFERENCES ChargingSlot(slot_id) ON DELETE CASCADE,
    CHECK (end_time > start_time)
);

CREATE TABLE ChargingSession (
    session_id INT PRIMARY KEY AUTO_INCREMENT,
    booking_id INT NOT NULL UNIQUE,
    start_time DATETIME,
    end_time DATETIME,
    units_consumed DECIMAL(6,2),
    total_cost DECIMAL(8,2),
    FOREIGN KEY (booking_id) REFERENCES Booking(booking_id) ON DELETE CASCADE
);

CREATE TABLE Payment (
    payment_id INT PRIMARY KEY AUTO_INCREMENT,
    booking_id INT NOT NULL UNIQUE,
    amount DECIMAL(8,2) NOT NULL,
    payment_method ENUM('upi', 'card', 'cash') NOT NULL,
    payment_status ENUM('pending', 'paid', 'failed') DEFAULT 'pending',
    payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES Booking(booking_id) ON DELETE CASCADE
);

CREATE INDEX idx_booking_user ON Booking(user_id);
CREATE INDEX idx_booking_slot ON Booking(slot_id);
CREATE INDEX idx_slot_station ON ChargingSlot(station_id);
CREATE INDEX idx_slot_status ON ChargingSlot(status);
CREATE INDEX idx_station_approval_status ON StationApproval(status);
CREATE INDEX idx_payment_booking ON Payment(booking_id);

INSERT INTO Users (name, email, phone, password, role)
VALUES (
    'System Admin',
    'admin@test.com',
    '8000000003',
    'scrypt:32768:8:1$neqvkxibemqu8n55$65bee86377f893feb5bcfff0228bd50b3ff973d0637b4c7a5a81b74e5d305b4bc31e3b1172d45929851ac2910165fa1ffb62cfd06d139d3375223a434a5b33b0',
    'admin'
);
