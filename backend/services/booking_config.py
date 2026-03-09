DATETIME_FMT = "%Y-%m-%d %H:%M:%S"
MIN_BOOKING_MINUTES = 15
MAX_BOOKING_MINUTES = 480
GRACE_PERIOD_MINUTES = 10
QR_TOKEN_SALT = "booking-qr-v1"
VALID_PAYMENT_METHODS = {"upi", "card", "cash"}

DEFAULT_POWER_KW_BY_SLOT_TYPE = {
    "normal": 7.0,
    "fast": 50.0,
}

DEFAULT_PRICE_PER_KWH_BY_SLOT_TYPE = {
    "normal": 12.0,
    "fast": 18.0,
}
