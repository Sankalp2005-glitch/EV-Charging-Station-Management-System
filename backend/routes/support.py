from datetime import datetime

from MySQLdb import IntegrityError
from flask import Blueprint, current_app, jsonify, request

from extensions import mysql
from utils.email_utils import send_support_request_email
from utils.jwt_handler import token_required
from utils.support_requests import (
    SUPPORT_CATEGORIES,
    SUPPORT_PRIORITIES,
    ensure_support_request_table,
    generate_support_ticket_number,
)

support_bp = Blueprint("support", __name__, url_prefix="/api/support")


def _clean_text(value):
    return value.strip() if isinstance(value, str) else ""


def _decode_if_bytes(value):
    return value.decode("utf-8") if isinstance(value, bytes) else value


def _parse_optional_positive_int(value):
    if value in (None, ""):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _format_dt(value):
    return value.strftime("%Y-%m-%d %H:%M:%S") if value else None


def _truncate_error_text(value, limit=255):
    text = _clean_text(str(value or ""))
    return text[:limit] if text else ""


def _serialize_support_request(row):
    return {
        "ticket_number": _decode_if_bytes(row[0]),
        "category": _decode_if_bytes(row[1]),
        "priority": _decode_if_bytes(row[2]),
        "subject": _decode_if_bytes(row[3]),
        "status": _decode_if_bytes(row[4]),
        "admin_email_status": _decode_if_bytes(row[5]),
        "booking_id": row[6],
        "station_id": row[7],
        "created_at": _format_dt(row[8]),
        "updated_at": _format_dt(row[9]),
    }


def _fetch_support_request_by_id(cursor, request_id):
    cursor.execute(
        """
        SELECT
            ticket_number,
            category,
            priority,
            subject,
            status,
            admin_email_status,
            booking_id,
            station_id,
            created_at,
            updated_at
        FROM SupportRequest
        WHERE request_id = %s
        LIMIT 1
        """,
        (request_id,),
    )
    row = cursor.fetchone()
    return _serialize_support_request(row) if row else None


def _fetch_requester_profile(cursor, user_id):
    cursor.execute(
        """
        SELECT name, email, phone
        FROM Users
        WHERE user_id = %s
        LIMIT 1
        """,
        (user_id,),
    )
    row = cursor.fetchone()
    if not row:
        return None
    return {
        "name": _decode_if_bytes(row[0]) or "",
        "email": _decode_if_bytes(row[1]) or "",
        "phone": _decode_if_bytes(row[2]) or "",
    }


def _is_booking_reference_allowed(cursor, current_user, booking_id):
    if current_user.get("role") == "customer":
        cursor.execute(
            """
            SELECT booking_id
            FROM Booking
            WHERE booking_id = %s AND user_id = %s
            LIMIT 1
            """,
            (booking_id, current_user["user_id"]),
        )
        return cursor.fetchone() is not None

    cursor.execute(
        """
        SELECT b.booking_id
        FROM Booking b
        JOIN ChargingSlot sl ON sl.slot_id = b.slot_id
        JOIN ChargingStation cs ON cs.station_id = sl.station_id
        WHERE b.booking_id = %s
          AND (cs.user_id = %s OR b.user_id = %s)
        LIMIT 1
        """,
        (booking_id, current_user["user_id"], current_user["user_id"]),
    )
    return cursor.fetchone() is not None


def _is_station_reference_allowed(cursor, current_user, station_id):
    if current_user.get("role") == "owner":
        cursor.execute(
            """
            SELECT station_id
            FROM ChargingStation
            WHERE station_id = %s AND user_id = %s
            LIMIT 1
            """,
            (station_id, current_user["user_id"]),
        )
        return cursor.fetchone() is not None

    cursor.execute(
        """
        SELECT station_id
        FROM ChargingStation
        WHERE station_id = %s
        LIMIT 1
        """,
        (station_id,),
    )
    return cursor.fetchone() is not None


@support_bp.get("/requests")
@token_required
def list_support_requests(current_user):
    if current_user.get("role") not in {"customer", "owner"}:
        return jsonify({"error": "Support requests are available only for customers and owners"}), 403

    cursor = mysql.connection.cursor()
    try:
        ensure_support_request_table(cursor)
        cursor.execute(
            """
            SELECT
                ticket_number,
                category,
                priority,
                subject,
                status,
                admin_email_status,
                booking_id,
                station_id,
                created_at,
                updated_at
            FROM SupportRequest
            WHERE user_id = %s
            ORDER BY created_at DESC
            LIMIT 10
            """,
            (current_user["user_id"],),
        )
        rows = cursor.fetchall() or []
        return jsonify([_serialize_support_request(row) for row in rows]), 200
    except Exception:
        current_app.logger.exception("Failed to list support requests for user_id=%s", current_user["user_id"])
        return jsonify({"error": "Failed to load support requests"}), 500
    finally:
        cursor.close()


@support_bp.post("/requests")
@token_required
def create_support_request(current_user):
    if current_user.get("role") not in {"customer", "owner"}:
        return jsonify({"error": "Support requests are available only for customers and owners"}), 403

    payload = request.get_json(silent=True) or {}
    category = _clean_text(payload.get("category")).lower() or "other"
    priority = _clean_text(payload.get("priority")).lower() or "normal"
    subject = _clean_text(payload.get("subject"))
    message = _clean_text(payload.get("message"))
    booking_id = _parse_optional_positive_int(payload.get("booking_id"))
    station_id = _parse_optional_positive_int(payload.get("station_id"))

    if category not in SUPPORT_CATEGORIES:
        return jsonify({"error": "Please choose a valid issue category"}), 400
    if priority not in SUPPORT_PRIORITIES:
        return jsonify({"error": "Please choose a valid issue priority"}), 400
    if len(subject) < 6 or len(subject) > 160:
        return jsonify({"error": "Subject must be between 6 and 160 characters"}), 400
    if len(message) < 20 or len(message) > 4000:
        return jsonify({"error": "Describe the issue in 20 to 4000 characters"}), 400

    cursor = mysql.connection.cursor()
    try:
        ensure_support_request_table(cursor)
        requester = _fetch_requester_profile(cursor, current_user["user_id"])
        if not requester or not requester["email"]:
            return jsonify({"error": "Your profile must have an email address before contacting support"}), 400
        if booking_id is not None and not _is_booking_reference_allowed(cursor, current_user, booking_id):
            return jsonify({"error": "The selected booking could not be found for your account"}), 400
        if station_id is not None and not _is_station_reference_allowed(cursor, current_user, station_id):
            return jsonify({"error": "The selected station could not be found for your account"}), 400

        ticket_number = generate_support_ticket_number(datetime.utcnow())
        cursor.execute(
            """
            INSERT INTO SupportRequest (
                ticket_number,
                user_id,
                user_role,
                requester_name,
                requester_email,
                requester_phone,
                category,
                priority,
                subject,
                message,
                booking_id,
                station_id,
                status,
                admin_email_status
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'open', 'pending')
            """,
            (
                ticket_number,
                current_user["user_id"],
                current_user["role"],
                requester["name"],
                requester["email"],
                requester["phone"] or None,
                category,
                priority,
                subject,
                message,
                booking_id,
                station_id,
            ),
        )
        request_id = cursor.lastrowid

        email_sent = False
        email_error = ""
        try:
            email_sent, email_error = send_support_request_email(
                {
                    "ticket_number": ticket_number,
                    "user_role": current_user["role"],
                    "priority": priority,
                    "category": category,
                    "status": "open",
                    "subject": subject,
                    "requester_name": requester["name"],
                    "requester_email": requester["email"],
                    "requester_phone": requester["phone"],
                    "booking_id": booking_id,
                    "station_id": station_id,
                    "message": message,
                }
            )
        except Exception as error:
            current_app.logger.exception("Support email delivery failed for ticket=%s", ticket_number)
            email_sent = False
            email_error = _truncate_error_text(error)

        email_error_text = _truncate_error_text(email_error)
        if email_sent:
            admin_email_status = "sent"
        elif "configured" in email_error_text.lower():
            admin_email_status = "skipped"
        else:
            admin_email_status = "failed" if email_error_text else "skipped"
        cursor.execute(
            """
            UPDATE SupportRequest
            SET admin_email_status = %s,
                admin_email_error = %s,
                last_emailed_at = %s
            WHERE ticket_number = %s
            """,
            (
                admin_email_status,
                email_error_text or None,
                datetime.now() if admin_email_status == "sent" else None,
                ticket_number,
            ),
        )

        created_request = _fetch_support_request_by_id(cursor, request_id)
        response_message = "Support request submitted and logged."
        if admin_email_status == "sent":
            response_message = "Support request submitted and emailed to the system admin."
        elif admin_email_status == "skipped":
            response_message = "Support request submitted and logged. Email delivery is not configured yet."
        elif admin_email_status == "failed":
            response_message = "Support request submitted and logged, but admin email delivery failed."
        mysql.connection.commit()
        return (
            jsonify(
                {
                    "message": response_message,
                    "request": created_request,
                }
            ),
            201,
        )
    except IntegrityError:
        mysql.connection.rollback()
        current_app.logger.exception("Duplicate support ticket generation for user_id=%s", current_user["user_id"])
        return jsonify({"error": "Please submit the request again"}), 409
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception("Failed to create support request for user_id=%s", current_user["user_id"])
        return jsonify({"error": "Failed to submit support request"}), 500
    finally:
        cursor.close()
