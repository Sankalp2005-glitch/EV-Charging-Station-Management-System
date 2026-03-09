from datetime import datetime

from extensions import socketio


def emit_booking_update(event_type, station_id=None, slot_id=None, booking_id=None, status=None, extra=None):
    payload = {
        "event_type": event_type,
        "station_id": station_id,
        "slot_id": slot_id,
        "booking_id": booking_id,
        "status": status,
        "timestamp": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
    }
    if isinstance(extra, dict):
        payload.update(extra)

    try:
        socketio.emit("booking_update", payload)
    except Exception:
        # Realtime notifications should not break core APIs.
        return
