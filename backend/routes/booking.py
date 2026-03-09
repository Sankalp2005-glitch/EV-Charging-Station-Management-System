from routes.booking_bp import booking_bp

# Register booking routes by importing modules for blueprint side effects.
from routes import booking_create  # noqa: F401
from routes import booking_customer_views  # noqa: F401
from routes import booking_qr_views  # noqa: F401
from routes import booking_station_views  # noqa: F401

__all__ = ["booking_bp"]
