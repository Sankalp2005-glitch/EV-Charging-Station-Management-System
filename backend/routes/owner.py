from routes.owner_bp import owner_bp

# Register owner routes by importing modules for blueprint side effects.
from routes import owner_station_create  # noqa: F401
from routes import owner_station_update  # noqa: F401
from routes import owner_station_views  # noqa: F401

__all__ = ["owner_bp"]
