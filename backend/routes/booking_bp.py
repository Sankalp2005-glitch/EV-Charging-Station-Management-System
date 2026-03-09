from flask import Blueprint

booking_bp = Blueprint("booking", __name__, url_prefix="/api/bookings")
