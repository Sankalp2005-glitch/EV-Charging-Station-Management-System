from flask import current_app
from itsdangerous import BadSignature, URLSafeSerializer

from services.booking_config import QR_TOKEN_SALT, VALID_PAYMENT_METHODS


def parse_bool(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "y", "paid", "success"}:
            return True
        if normalized in {"0", "false", "no", "n", "failed", "failure"}:
            return False
    return None


def parse_payment_method(value):
    if value is None:
        return "upi"
    method = str(value).strip().lower()
    return method if method in VALID_PAYMENT_METHODS else None


def normalize_qr_token_input(value):
    if not isinstance(value, str):
        return None

    cleaned = value.strip()
    if not cleaned:
        return None

    marker = "token="
    if marker in cleaned:
        return cleaned.split(marker, 1)[1].strip()
    return cleaned


def _qr_serializer():
    return URLSafeSerializer(current_app.config["SECRET_KEY"], salt=QR_TOKEN_SALT)


def encode_qr_token(booking_id, user_id, slot_id):
    payload = {
        "booking_id": int(booking_id),
        "user_id": int(user_id),
        "slot_id": int(slot_id),
    }
    return _qr_serializer().dumps(payload)


def decode_qr_token(token):
    try:
        decoded = _qr_serializer().loads(token)
    except BadSignature:
        return None

    if not isinstance(decoded, dict):
        return None
    if not {"booking_id", "user_id", "slot_id"} <= set(decoded.keys()):
        return None
    return decoded
