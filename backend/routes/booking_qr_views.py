import base64
from datetime import datetime, timedelta
from io import BytesIO

from flask import Response, current_app, jsonify, request
import qrcode

from extensions import mysql
from routes.booking_bp import booking_bp
from services.booking_config import (
    BOOKING_STATUS_CHARGING_STARTED,
    BOOKING_STATUS_WAITING_TO_START,
    GRACE_PERIOD_MINUTES,
    LEGACY_BOOKING_STATUS_CONFIRMED,
)
from services.booking_lifecycle import (
    emit_lifecycle_updates as _emit_lifecycle_updates,
    refresh_single_slot_status as _refresh_single_slot_status,
    run_booking_lifecycle_updates as _run_booking_lifecycle_updates,
)
from services.booking_mutations import (
    is_booking_qr_accessible,
    is_booking_ready_for_qr_verification,
    is_payment_ready_for_qr,
)
from services.booking_schema import ensure_phase5_tables as _ensure_phase5_tables
from services.booking_security import (
    decode_qr_token as _decode_qr_token,
    encode_qr_token as _encode_qr_token,
    normalize_qr_token_input as _normalize_qr_token_input,
)
from services.value_utils import (
    close_cursor as _close_cursor,
    format_dt as _format_dt,
    to_str as _to_str,
)
from utils.jwt_handler import role_required, token_required
from utils.realtime_events import emit_booking_update


def _build_qr_image_bytes(value):
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=8,
        border=2,
    )
    qr.add_data(value)
    qr.make(fit=True)

    image = qr.make_image(fill_color="black", back_color="white")
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _build_qr_image_data_url(value):
    encoded = base64.b64encode(_build_qr_image_bytes(value)).decode("ascii")
    return f"data:image/png;base64,{encoded}"


@booking_bp.route("/<int:booking_id>/qr", methods=["GET"])
@token_required
@role_required("customer")
def get_booking_qr(current_user, booking_id):
    cursor = None
    lifecycle_records = []

    try:
        cursor = mysql.connection.cursor()
        _ensure_phase5_tables(cursor)
        lifecycle_records = _run_booking_lifecycle_updates(cursor)
        mysql.connection.commit()

        cursor.execute(
            """
            SELECT
                b.booking_id,
                b.user_id,
                b.slot_id,
                b.start_time,
                b.end_time,
                b.status,
                sl.station_id,
                cs.user_id AS station_owner_id,
                p.payment_status,
                p.payment_method
            FROM Booking b
            JOIN ChargingSlot sl ON sl.slot_id = b.slot_id
            JOIN ChargingStation cs ON cs.station_id = sl.station_id
            LEFT JOIN Payment p ON p.booking_id = b.booking_id
            WHERE b.booking_id = %s
            LIMIT 1
            """,
            (booking_id,),
        )
        row = cursor.fetchone()
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception(
            "Failed to generate QR for booking_id=%s user_id=%s",
            booking_id,
            current_user.get("user_id"),
        )
        return jsonify({"error": "Failed to generate booking QR"}), 500
    finally:
        _close_cursor(cursor)

    _emit_lifecycle_updates(lifecycle_records)

    if not row:
        return jsonify({"error": "Booking not found"}), 404

    booking_owner_id = int(row[1])
    station_owner_id = int(row[7] or 0)
    requester_id = int(current_user.get("user_id") or 0)
    requester_role = current_user.get("role")
    can_access = (
        requester_role == "admin"
        or requester_id == booking_owner_id
        or (requester_role == "owner" and requester_id == station_owner_id)
    )
    if not can_access:
        return jsonify({"error": "Unauthorized"}), 403

    status = (_to_str(row[5]) or "").lower()
    if status not in {BOOKING_STATUS_WAITING_TO_START, BOOKING_STATUS_CHARGING_STARTED, LEGACY_BOOKING_STATUS_CONFIRMED}:
        return jsonify({"error": "Booking is not eligible for QR access"}), 409

    now = datetime.now()
    if row[4] <= now:
        return jsonify({"error": "Booking already ended"}), 409

    payment_status = (_to_str(row[8]) or "pending").lower()
    payment_method = (_to_str(row[9]) or "").lower() or None
    if not is_booking_qr_accessible(status, row[4], payment_method, payment_status, now=now):
        return jsonify({"error": "Payment is pending for this booking"}), 409

    qr_token = _encode_qr_token(row[0], row[1], row[2])
    qr_value = f"evcs://booking/{row[0]}?token={qr_token}"
    qr_image_bytes = None
    qr_image_data_url = ""
    qr_image_available = True
    try:
        qr_image_bytes = _build_qr_image_bytes(qr_value)
        qr_image_data_url = f"data:image/png;base64,{base64.b64encode(qr_image_bytes).decode('ascii')}"
    except Exception:
        qr_image_available = False
        current_app.logger.exception(
            "Failed to build QR image for booking_id=%s user_id=%s",
            booking_id,
            current_user.get("user_id"),
        )
    if (request.args.get("format") or "").strip().lower() == "image":
        if not qr_image_bytes:
            return jsonify({"error": "Booking QR image is unavailable"}), 503
        response = Response(qr_image_bytes, mimetype="image/png")
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response, 200
    response = jsonify(
        {
            "booking_id": int(row[0]),
            "slot_id": int(row[2]),
            "station_id": int(row[6]),
            "start_time": _format_dt(row[3]),
            "end_time": _format_dt(row[4]),
            "payment_status": payment_status,
            "payment_method": payment_method,
            "grace_period_minutes": GRACE_PERIOD_MINUTES,
            "qr_token": qr_token,
            "qr_value": qr_value,
            "qr_image_available": qr_image_available,
            "qr_image_data_url": qr_image_data_url,
        }
    )
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response, 200


@booking_bp.route("/scan-qr", methods=["POST"])
@token_required
def scan_booking_qr(current_user):
    payload = request.get_json(silent=True) or {}
    qr_token = _normalize_qr_token_input(payload.get("qr_token"))
    if not qr_token:
        return jsonify({"error": "qr_token is required"}), 400

    requester_role = current_user.get("role")
    if requester_role not in {"owner", "admin"}:
        return jsonify({"error": "Only a station owner or admin can verify this QR"}), 403

    decoded = _decode_qr_token(qr_token)
    if not decoded:
        return jsonify({"error": "Invalid QR token"}), 400

    booking_id = int(decoded["booking_id"])
    expected_user_id = int(decoded["user_id"])
    expected_slot_id = int(decoded["slot_id"])

    cursor = None
    lifecycle_records = []
    slot_id = None
    station_id = None
    already_started = False
    started_at = None

    try:
        cursor = mysql.connection.cursor()
        _ensure_phase5_tables(cursor)
        lifecycle_records = _run_booking_lifecycle_updates(cursor)
        mysql.connection.commit()

        cursor.execute(
            """
            SELECT
                b.booking_id,
                b.user_id,
                b.slot_id,
                b.start_time,
                b.end_time,
                b.status,
                sl.station_id,
                cs.user_id AS station_owner_id,
                p.payment_status,
                p.payment_method
            FROM Booking b
            JOIN ChargingSlot sl ON sl.slot_id = b.slot_id
            JOIN ChargingStation cs ON cs.station_id = sl.station_id
            LEFT JOIN Payment p ON p.booking_id = b.booking_id
            WHERE b.booking_id = %s
            LIMIT 1
            """,
            (booking_id,),
        )
        booking = cursor.fetchone()
        if not booking:
            return jsonify({"error": "Booking not found"}), 404

        booking_user_id = int(booking[1])
        slot_id = int(booking[2])
        station_id = int(booking[6])
        station_owner_id = int(booking[7] or 0)
        status = (_to_str(booking[5]) or "").lower()
        payment_status = (_to_str(booking[8]) or "pending").lower()
        payment_method = (_to_str(booking[9]) or "").lower() or None

        if booking_user_id != expected_user_id or slot_id != expected_slot_id:
            return jsonify({"error": "QR token does not match booking details"}), 409
        requester_id = int(current_user.get("user_id") or 0)
        if requester_role == "admin":
            pass
        elif requester_role == "owner":
            if requester_id != station_owner_id:
                return jsonify({"error": "Owner can scan only station bookings they own"}), 403

        cursor.execute(
            """
            SELECT start_time
            FROM ChargingSession
            WHERE booking_id = %s
            LIMIT 1
            """,
            (booking_id,),
        )
        existing_session = cursor.fetchone()
        if existing_session and existing_session[0] is not None:
            return jsonify({"error": "Charging already active"}), 409
        else:
            now = datetime.now()
            if booking[4] <= now:
                return jsonify({"error": "Booking already ended"}), 409
            if not is_payment_ready_for_qr(payment_method, payment_status):
                return jsonify({"error": "Payment not completed"}), 409
            if not is_booking_ready_for_qr_verification(
                status,
                booking[3],
                booking[4],
                payment_method,
                payment_status,
                now=now,
            ):
                if status == BOOKING_STATUS_CHARGING_STARTED:
                    return jsonify({"error": "Charging already active"}), 409
                return jsonify({"error": "Booking is not eligible for QR verification"}), 409

            cursor.execute(
                """
                INSERT INTO ChargingSession (booking_id, start_time)
                VALUES (%s, NOW())
                ON DUPLICATE KEY UPDATE
                    start_time = COALESCE(start_time, VALUES(start_time))
                """,
                (booking_id,),
            )
            cursor.execute(
                """
                UPDATE Booking
                SET status = %s, qr_verified_at = NOW(), qr_verified_by = %s
                WHERE booking_id = %s
                """,
                (BOOKING_STATUS_CHARGING_STARTED, requester_id, booking_id),
            )
            cursor.execute(
                """
                SELECT start_time
                FROM ChargingSession
                WHERE booking_id = %s
                LIMIT 1
                """,
                (booking_id,),
            )
            refreshed_session = cursor.fetchone()
            started_at = refreshed_session[0] if refreshed_session else datetime.now()

        _refresh_single_slot_status(cursor, slot_id)
        mysql.connection.commit()
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception(
            "Failed to scan QR for booking_id=%s user_id=%s",
            booking_id,
            current_user.get("user_id"),
        )
        return jsonify({"error": "Failed to verify QR"}), 500
    finally:
        _close_cursor(cursor)

    _emit_lifecycle_updates(lifecycle_records)
    emit_booking_update(
        "charging_started" if not already_started else "charging_already_started",
        station_id=station_id,
        slot_id=slot_id,
        booking_id=booking_id,
        status=BOOKING_STATUS_CHARGING_STARTED,
    )

    return (
        jsonify(
            {
                "message": "Charging session started" if not already_started else "Charging already active",
                "booking_id": booking_id,
                "slot_id": slot_id,
                "station_id": station_id,
                "allow_charging": True,
                "already_started": already_started,
                "status": BOOKING_STATUS_CHARGING_STARTED,
                "charging_started_at": _format_dt(started_at),
            }
        ),
        200,
    )
