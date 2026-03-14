from datetime import datetime

from flask import Blueprint, current_app, jsonify, request

from extensions import mysql
from services.booking_config import (
    BOOKING_STATUS_CANCELLED,
    BOOKING_STATUS_CHARGING_STARTED,
    BOOKING_STATUS_WAITING_TO_START,
    LEGACY_BOOKING_STATUS_CONFIRMED,
)
from services.booking_lifecycle import (
    emit_lifecycle_updates as _emit_lifecycle_updates,
    refresh_single_slot_status as _refresh_single_slot_status,
    run_booking_lifecycle_updates as _run_booking_lifecycle_updates,
)
from services.booking_schema import ensure_phase5_tables as _ensure_phase5_tables
from services.charging_profiles import build_live_charging_snapshot
from services.revenue_analytics import fetch_revenue_analytics as _fetch_revenue_analytics
from services.value_utils import format_dt as _format_dt, to_str as _to_str
from utils.jwt_handler import get_active_session_count, role_required, token_required
from routes.owner_common import build_contact_number
from utils.realtime_events import emit_booking_update
from utils.station_approval import (
    APPROVAL_STATUS_APPROVED,
    APPROVAL_STATUS_PENDING,
    APPROVAL_STATUSES,
    backfill_missing_station_approvals,
    ensure_station_approval_table,
)
from utils.user_status import (
    USER_STATUS_ACTIVE,
    USER_STATUSES,
    backfill_missing_user_status,
    ensure_user_status_table,
)

admin_bp = Blueprint("admin", __name__, url_prefix="/api/admin")


@admin_bp.route("/test-admin", methods=["GET"])
@token_required
@role_required("admin")
def test_admin(_current_user):
    return jsonify({"message": "Admin access granted"}), 200


@admin_bp.route("/stats", methods=["GET"])
@token_required
@role_required("admin")
def get_admin_stats(_current_user):
    cursor = None
    lifecycle_records = []
    try:
        cursor = mysql.connection.cursor()
        _ensure_phase5_tables(cursor)
        ensure_station_approval_table(cursor)
        backfill_missing_station_approvals(cursor)
        lifecycle_records = _run_booking_lifecycle_updates(cursor)
        mysql.connection.commit()

        cursor.execute("SELECT COUNT(*) FROM Users")
        total_users = int((cursor.fetchone() or [0])[0] or 0)

        cursor.execute("SELECT COUNT(*) FROM ChargingStation")
        total_stations = int((cursor.fetchone() or [0])[0] or 0)

        cursor.execute("SELECT COUNT(*) FROM Booking")
        total_bookings = int((cursor.fetchone() or [0])[0] or 0)

        revenue_analytics = _fetch_revenue_analytics(cursor)
        revenue = float(revenue_analytics["summary"]["total_revenue"] or 0.0)
        revenue_supported = True
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception("Failed to fetch admin stats")
        return jsonify({"error": "Failed to fetch admin stats"}), 500
    finally:
        if cursor:
            cursor.close()

    _emit_lifecycle_updates(lifecycle_records)

    return jsonify(
        {
            "total_users": total_users,
            "total_stations": total_stations,
            "total_bookings": total_bookings,
            "total_revenue": round(revenue, 2),
            "revenue_estimate_supported": revenue_supported,
            "active_sessions": get_active_session_count(),
        }
    ), 200


@admin_bp.route("/revenue-analytics", methods=["GET"])
@token_required
@role_required("admin")
def get_admin_revenue_analytics(_current_user):
    cursor = None
    try:
        cursor = mysql.connection.cursor()
        _ensure_phase5_tables(cursor)
        analytics = _fetch_revenue_analytics(cursor)
    except Exception:
        current_app.logger.exception("Failed to fetch admin revenue analytics")
        return jsonify({"error": "Failed to fetch admin revenue analytics"}), 500
    finally:
        if cursor:
            cursor.close()

    return jsonify(analytics), 200


@admin_bp.route("/stations", methods=["GET"])
@token_required
@role_required("admin")
def get_admin_stations(_current_user):
    status = (request.args.get("status") or APPROVAL_STATUS_PENDING).strip().lower()
    if status not in {*APPROVAL_STATUSES, "all"}:
        return jsonify({"error": "status must be one of: pending, approved, rejected, all"}), 400

    cursor = None
    try:
        cursor = mysql.connection.cursor()
        _ensure_phase5_tables(cursor)
        ensure_station_approval_table(cursor)
        backfill_missing_station_approvals(cursor)
        mysql.connection.commit()

        query = """
            SELECT
                cs.station_id,
                cs.station_name,
                cs.location,
                cs.contact_number,
                cs.total_slots,
                owner.user_id,
                owner.name,
                owner.email,
                sa.status,
                sa.reviewed_at,
                sa.reviewed_by,
                reviewer.name,
                sa.remarks,
                SUM(CASE WHEN sl.slot_type = 'fast' THEN 1 ELSE 0 END) AS fast_slots,
                SUM(CASE WHEN sl.slot_type = 'normal' THEN 1 ELSE 0 END) AS normal_slots
            FROM ChargingStation cs
            JOIN Users owner ON cs.user_id = owner.user_id
            JOIN StationApproval sa ON sa.station_id = cs.station_id
            LEFT JOIN Users reviewer ON sa.reviewed_by = reviewer.user_id
            LEFT JOIN ChargingSlot sl ON sl.station_id = cs.station_id
            WHERE (%s = 'all' OR sa.status = %s)
            GROUP BY
                cs.station_id,
                cs.station_name,
                cs.location,
                cs.contact_number,
                cs.total_slots,
                owner.user_id,
                owner.name,
                owner.email,
                sa.status,
                sa.reviewed_at,
                sa.reviewed_by,
                reviewer.name,
                sa.remarks
            ORDER BY
                CASE WHEN sa.status = 'pending' THEN 0 ELSE 1 END,
                cs.station_id DESC
        """
        cursor.execute(query, (status, status))
        stations = cursor.fetchall()
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception("Failed to fetch admin station approvals")
        return jsonify({"error": "Failed to fetch stations"}), 500
    finally:
        if cursor:
            cursor.close()

    result = []
    for row in stations:
        result.append(
            {
                "station_id": int(row[0]),
                "station_name": _to_str(row[1]),
                "location": _to_str(row[2]),
                "contact_number": _to_str(row[3]),
                "total_slots": int(row[4] or 0),
                "owner_id": int(row[5]),
                "owner_name": _to_str(row[6]),
                "owner_email": _to_str(row[7]),
                "approval_status": _to_str(row[8]),
                "reviewed_at": _format_dt(row[9]),
                "reviewed_by": int(row[10]) if row[10] is not None else None,
                "reviewed_by_name": _to_str(row[11]),
                "remarks": _to_str(row[12]),
                "fast_slots": int(row[13] or 0),
                "normal_slots": int(row[14] or 0),
            }
        )

    return jsonify(result), 200


@admin_bp.route("/stations/<int:station_id>/approval", methods=["PUT"])
@token_required
@role_required("admin")
def update_station_approval(current_user, station_id):
    payload = request.get_json(silent=True) or {}
    status = (payload.get("status") or "").strip().lower()
    remarks = (payload.get("remarks") or "").strip()

    if status not in APPROVAL_STATUSES:
        return jsonify({"error": "status must be one of: pending, approved, rejected"}), 400
    if len(remarks) > 255:
        return jsonify({"error": "remarks must be at most 255 characters"}), 400

    cursor = None
    try:
        cursor = mysql.connection.cursor()
        _ensure_phase5_tables(cursor)
        ensure_station_approval_table(cursor)
        backfill_missing_station_approvals(cursor)
        mysql.connection.commit()

        cursor.execute(
            """
            SELECT cs.station_id, cs.station_name
            FROM ChargingStation cs
            WHERE cs.station_id = %s
            LIMIT 1
            """,
            (station_id,),
        )
        station = cursor.fetchone()
        if not station:
            return jsonify({"error": "Station not found"}), 404

        if status == APPROVAL_STATUS_PENDING:
            cursor.execute(
                """
                UPDATE StationApproval
                SET status = %s, reviewed_by = NULL, reviewed_at = NULL, remarks = %s
                WHERE station_id = %s
                """,
                (status, remarks or None, station_id),
            )
        else:
            cursor.execute(
                """
                UPDATE StationApproval
                SET status = %s, reviewed_by = %s, reviewed_at = NOW(), remarks = %s
                WHERE station_id = %s
                """,
                (status, current_user["user_id"], remarks or None, station_id),
            )

        mysql.connection.commit()
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception(
            "Failed to update station approval station_id=%s admin_user_id=%s",
            station_id,
            current_user.get("user_id"),
        )
        return jsonify({"error": "Failed to update station approval"}), 500
    finally:
        if cursor:
            cursor.close()

    return jsonify(
        {
            "message": f"Station {status} successfully",
            "station_id": station_id,
            "approval_status": status,
        }
    ), 200


def _parse_date(value):
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


@admin_bp.route("/users", methods=["GET"])
@token_required
@role_required("admin")
def get_admin_users(_current_user):
    search = (request.args.get("search") or "").strip().lower()
    role_filter = (request.args.get("role") or "").strip().lower()
    status_filter = (request.args.get("status") or "").strip().lower()

    if role_filter == "all":
        role_filter = ""
    if status_filter == "all":
        status_filter = ""

    cursor = None
    try:
        cursor = mysql.connection.cursor()
        ensure_user_status_table(cursor)
        backfill_missing_user_status(cursor)
        mysql.connection.commit()

        query = """
            SELECT
                u.user_id,
                u.name,
                u.email,
                u.phone,
                u.role,
                u.registration_date,
                COALESCE(uas.status, %s) AS status,
                uas.updated_at,
                uas.reason
            FROM Users u
            LEFT JOIN UserAccountStatus uas ON uas.user_id = u.user_id
            WHERE 1 = 1
        """
        params = [USER_STATUS_ACTIVE]

        if search:
            query += " AND (LOWER(u.name) LIKE %s OR LOWER(u.email) LIKE %s OR u.phone LIKE %s)"
            like_term = f"%{search}%"
            params.extend([like_term, like_term, like_term])

        if role_filter in {"admin", "owner", "customer"}:
            query += " AND u.role = %s"
            params.append(role_filter)

        if status_filter in USER_STATUSES:
            query += " AND COALESCE(uas.status, %s) = %s"
            params.extend([USER_STATUS_ACTIVE, status_filter])

        query += " ORDER BY u.registration_date DESC"

        cursor.execute(query, tuple(params))
        users = cursor.fetchall()
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception("Failed to fetch admin users")
        return jsonify({"error": "Failed to fetch users"}), 500
    finally:
        if cursor:
            cursor.close()

    result = []
    for row in users:
        result.append(
            {
                "user_id": int(row[0]),
                "name": _to_str(row[1]),
                "email": _to_str(row[2]),
                "phone": _to_str(row[3]),
                "role": _to_str(row[4]),
                "registration_date": _format_dt(row[5]),
                "status": _to_str(row[6]) or USER_STATUS_ACTIVE,
                "status_updated_at": _format_dt(row[7]),
                "status_reason": _to_str(row[8]),
            }
        )

    return jsonify(result), 200


@admin_bp.route("/users/<int:user_id>/status", methods=["PUT"])
@token_required
@role_required("admin")
def update_admin_user_status(current_user, user_id):
    payload = request.get_json(silent=True) or {}
    status = (payload.get("status") or "").strip().lower()
    reason = (payload.get("reason") or "").strip()

    if status not in USER_STATUSES:
        return jsonify({"error": "status must be one of: active, suspended, disabled"}), 400
    if user_id == current_user.get("user_id") and status != USER_STATUS_ACTIVE:
        return jsonify({"error": "You cannot change your own account status"}), 409
    if len(reason) > 255:
        return jsonify({"error": "reason must be at most 255 characters"}), 400

    cursor = None
    try:
        cursor = mysql.connection.cursor()
        ensure_user_status_table(cursor)
        cursor.execute("SELECT user_id FROM Users WHERE user_id = %s LIMIT 1", (user_id,))
        if not cursor.fetchone():
            return jsonify({"error": "User not found"}), 404

        cursor.execute(
            """
            INSERT INTO UserAccountStatus (user_id, status, updated_by, updated_at, reason)
            VALUES (%s, %s, %s, NOW(), %s)
            ON DUPLICATE KEY UPDATE
                status = VALUES(status),
                updated_by = VALUES(updated_by),
                updated_at = VALUES(updated_at),
                reason = VALUES(reason)
            """,
            (user_id, status, current_user.get("user_id"), reason or None),
        )
        mysql.connection.commit()
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception("Failed to update user status user_id=%s", user_id)
        return jsonify({"error": "Failed to update user status"}), 500
    finally:
        if cursor:
            cursor.close()

    return jsonify({"message": f"User status updated to {status}", "user_id": user_id, "status": status}), 200


@admin_bp.route("/users/<int:user_id>", methods=["DELETE"])
@token_required
@role_required("admin")
def delete_admin_user(current_user, user_id):
    if user_id == current_user.get("user_id"):
        return jsonify({"error": "You cannot delete your own account"}), 409

    cursor = None
    try:
        cursor = mysql.connection.cursor()
        cursor.execute("SELECT user_id FROM Users WHERE user_id = %s LIMIT 1", (user_id,))
        if not cursor.fetchone():
            return jsonify({"error": "User not found"}), 404

        cursor.execute("DELETE FROM Users WHERE user_id = %s", (user_id,))
        mysql.connection.commit()
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception("Failed to delete user_id=%s", user_id)
        return jsonify({"error": "Failed to delete user"}), 500
    finally:
        if cursor:
            cursor.close()

    return jsonify({"message": "User deleted successfully"}), 200


@admin_bp.route("/stations/<int:station_id>", methods=["PUT"])
@token_required
@role_required("admin")
def update_admin_station(current_user, station_id):
    payload = request.get_json(silent=True) or {}
    station_name = (payload.get("station_name") or "").strip()
    location = (payload.get("location") or "").strip()
    contact_number_raw = payload.get("contact_number")
    contact_country_code = payload.get("contact_country_code")

    if not station_name or not location:
        return jsonify({"error": "station_name and location are required"}), 400
    contact_number, contact_error = build_contact_number(contact_number_raw, contact_country_code)
    if contact_error:
        return jsonify({"error": contact_error}), 400

    cursor = None
    try:
        cursor = mysql.connection.cursor()
        cursor.execute(
            """
            UPDATE ChargingStation
            SET station_name = %s, location = %s, contact_number = %s
            WHERE station_id = %s
            """,
            (station_name, location, contact_number or None, station_id),
        )
        if cursor.rowcount == 0:
            return jsonify({"error": "Station not found"}), 404
        mysql.connection.commit()
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception("Failed to update station station_id=%s admin_user_id=%s", station_id, current_user.get("user_id"))
        return jsonify({"error": "Failed to update station"}), 500
    finally:
        if cursor:
            cursor.close()

    return jsonify({"message": "Station updated successfully"}), 200


@admin_bp.route("/stations/<int:station_id>/chargers", methods=["GET"])
@token_required
@role_required("admin")
def get_admin_station_chargers(_current_user, station_id):
    cursor = None
    try:
        cursor = mysql.connection.cursor()
        cursor.execute(
            """
            SELECT
                sl.slot_id,
                sl.slot_number,
                sl.slot_type,
                sl.charger_name,
                sl.vehicle_category,
                sl.power_kw,
                sl.connector_type,
                sl.status,
                sl.price_per_kwh,
                sl.price_per_minute
            FROM ChargingSlot sl
            WHERE sl.station_id = %s
            ORDER BY sl.slot_number ASC
            """,
            (station_id,),
        )
        chargers = cursor.fetchall()
    except Exception:
        current_app.logger.exception("Failed to fetch chargers for station_id=%s", station_id)
        return jsonify({"error": "Failed to fetch chargers"}), 500
    finally:
        if cursor:
            cursor.close()

    result = []
    for row in chargers:
        result.append(
            {
                "slot_id": int(row[0]),
                "slot_number": int(row[1]),
                "slot_type": _to_str(row[2]),
                "charger_name": _to_str(row[3]),
                "vehicle_category": _to_str(row[4]),
                "power_kw": float(row[5]) if row[5] is not None else None,
                "connector_type": _to_str(row[6]),
                "status": _to_str(row[7]),
                "price_per_kwh": float(row[8]) if row[8] is not None else None,
                "price_per_minute": float(row[9]) if row[9] is not None else None,
            }
        )

    return jsonify(result), 200


@admin_bp.route("/bookings", methods=["GET"])
@token_required
@role_required("admin")
def get_admin_bookings(_current_user):
    status_filter = (request.args.get("status") or "").strip().lower()
    station_filter = (request.args.get("station_id") or "").strip()
    location_filter = (request.args.get("location") or "").strip().lower()
    raw_date_from = request.args.get("date_from") or ""
    raw_date_to = request.args.get("date_to") or ""
    raw_start_time = request.args.get("start_time") or ""
    raw_end_time = request.args.get("end_time") or ""
    sort = (request.args.get("sort") or "date_desc").strip().lower()

    date_from = _parse_date(raw_start_time) or _parse_date(raw_date_from)
    date_to = _parse_date(raw_end_time) or _parse_date(raw_date_to)
    if date_to and len((raw_end_time or raw_date_to).strip()) <= 10:
        date_to = date_to.replace(hour=23, minute=59, second=59)

    if status_filter == "all":
        status_filter = ""

    station_id = int(station_filter) if station_filter.isdigit() else None

    cursor = None
    lifecycle_records = []
    try:
        cursor = mysql.connection.cursor()
        _ensure_phase5_tables(cursor)
        lifecycle_records = _run_booking_lifecycle_updates(cursor)
        mysql.connection.commit()

        query = """
            SELECT
                b.booking_id,
                b.status,
                b.start_time,
                b.end_time,
                b.vehicle_category,
                b.estimated_duration_minutes,
                b.current_battery_percent,
                b.target_battery_percent,
                b.energy_required_kwh,
                u.user_id,
                u.name,
                u.email,
                u.phone,
                cs.station_id,
                cs.station_name,
                cs.location,
                sl.slot_id,
                sl.slot_number,
                sl.slot_type,
                sl.charger_name,
                sl.power_kw,
                p.amount,
                p.payment_status,
                sess.total_cost,
                sess.start_time AS charging_started_at,
                sess.end_time AS charging_completed_at
            FROM Booking b
            JOIN Users u ON b.user_id = u.user_id
            JOIN ChargingSlot sl ON b.slot_id = sl.slot_id
            JOIN ChargingStation cs ON sl.station_id = cs.station_id
            LEFT JOIN Payment p ON p.booking_id = b.booking_id
            LEFT JOIN ChargingSession sess ON sess.booking_id = b.booking_id
            WHERE 1 = 1
        """
        params = []

        if status_filter:
            query += " AND b.status = %s"
            params.append(status_filter)

        if station_id:
            query += " AND cs.station_id = %s"
            params.append(station_id)

        if location_filter:
            query += " AND LOWER(cs.location) LIKE %s"
            params.append(f"%{location_filter}%")

        if date_from:
            query += " AND b.start_time >= %s"
            params.append(date_from.strftime("%Y-%m-%d %H:%M:%S"))
        if date_to:
            query += " AND b.end_time <= %s"
            params.append(date_to.strftime("%Y-%m-%d %H:%M:%S"))

        order_map = {
            "date_asc": "b.start_time ASC",
            "date_desc": "b.start_time DESC",
            "station_asc": "cs.station_name ASC, b.start_time DESC",
            "station_desc": "cs.station_name DESC, b.start_time DESC",
        }
        query += f" ORDER BY {order_map.get(sort, order_map['date_desc'])}"

        cursor.execute(query, tuple(params))
        bookings = cursor.fetchall()
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception("Failed to fetch admin bookings")
        return jsonify({"error": "Failed to fetch bookings"}), 500
    finally:
        if cursor:
            cursor.close()

    _emit_lifecycle_updates(lifecycle_records)

    result = []
    now = datetime.now()
    for row in bookings:
        status = _to_str(row[1])
        start_time = row[2]
        end_time = row[3]
        duration_minutes = int(row[5] or max(int((end_time - start_time).total_seconds() // 60), 0))
        charging_started_at = row[24]
        charging_completed_at = row[25]
        live_snapshot = build_live_charging_snapshot(
            booking_status=status,
            charging_started_at=charging_started_at,
            charging_completed_at=charging_completed_at,
            estimated_duration_minutes=duration_minutes,
            current_battery_percent=row[6],
            target_battery_percent=row[7],
            energy_required_kwh=row[8],
            now=now,
        )
        payment_amount = row[21]
        total_cost = row[23]
        price_value = total_cost if total_cost is not None else payment_amount

        can_cancel = (
            status in {BOOKING_STATUS_WAITING_TO_START, LEGACY_BOOKING_STATUS_CONFIRMED}
            and end_time > now
            and charging_started_at is None
        )

        result.append(
            {
                "booking_id": int(row[0]),
                "status": status,
                "start_time": _format_dt(start_time),
                "end_time": _format_dt(end_time),
                "vehicle_category": _to_str(row[4]),
                "estimated_duration_minutes": duration_minutes,
                "current_battery_percent": float(row[6]) if row[6] is not None else None,
                "target_battery_percent": float(row[7]) if row[7] is not None else None,
                "user_id": int(row[9]),
                "user_name": _to_str(row[10]),
                "user_email": _to_str(row[11]),
                "user_phone": _to_str(row[12]),
                "station_id": int(row[13]),
                "station_name": _to_str(row[14]),
                "station_location": _to_str(row[15]),
                "slot_id": int(row[16]),
                "slot_number": int(row[17]),
                "slot_type": _to_str(row[18]),
                "charger_name": _to_str(row[19]),
                "power_kw": float(row[20]) if row[20] is not None else None,
                "payment_amount": float(payment_amount) if payment_amount is not None else None,
                "payment_status": _to_str(row[22]),
                "total_cost": float(total_cost) if total_cost is not None else None,
                "price": float(price_value) if price_value is not None else None,
                "charging_started_at": _format_dt(charging_started_at),
                "charging_completed_at": _format_dt(charging_completed_at),
                "charging_progress_percent": live_snapshot["progress_percent"],
                "estimated_current_battery_percent": live_snapshot["estimated_current_battery_percent"],
                "estimated_completion_time": _format_dt(live_snapshot["estimated_completion_time"]),
                "remaining_minutes": live_snapshot["remaining_minutes"],
                "can_cancel": can_cancel,
            }
        )

    return jsonify(result), 200


@admin_bp.route("/bookings/<int:booking_id>/cancel", methods=["PUT"])
@token_required
@role_required("admin")
def cancel_admin_booking(_current_user, booking_id):
    cursor = None
    lifecycle_records = []
    now = datetime.now()
    slot_id = None
    station_id = None

    try:
        cursor = mysql.connection.cursor()
        _ensure_phase5_tables(cursor)
        lifecycle_records = _run_booking_lifecycle_updates(cursor)
        mysql.connection.commit()

        cursor.execute(
            """
            SELECT b.slot_id, b.end_time, b.status, sl.station_id, sess.start_time
            FROM Booking b
            JOIN ChargingSlot sl ON sl.slot_id = b.slot_id
            LEFT JOIN ChargingSession sess ON sess.booking_id = b.booking_id
            WHERE b.booking_id = %s
            """,
            (booking_id,),
        )
        booking = cursor.fetchone()

        if not booking:
            return jsonify({"error": "Booking not found"}), 404

        status = _to_str(booking[2])
        if status not in {BOOKING_STATUS_WAITING_TO_START, LEGACY_BOOKING_STATUS_CONFIRMED}:
            return jsonify({"error": "Only waiting bookings can be cancelled"}), 409
        if booking[1] <= now:
            return jsonify({"error": "Booking already ended"}), 409
        if booking[4] is not None or status == BOOKING_STATUS_CHARGING_STARTED:
            return jsonify({"error": "Charging already started for this booking"}), 409

        cursor.execute(
            """
            UPDATE Booking
            SET status = %s
            WHERE booking_id = %s
            """,
            (BOOKING_STATUS_CANCELLED, booking_id),
        )
        slot_id = int(booking[0])
        station_id = int(booking[3] or 0)
        _refresh_single_slot_status(cursor, slot_id)
        mysql.connection.commit()
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception("Failed to cancel booking_id=%s by admin", booking_id)
        return jsonify({"error": "Failed to cancel booking"}), 500
    finally:
        if cursor:
            cursor.close()

    _emit_lifecycle_updates(lifecycle_records)
    emit_booking_update(
        "booking_cancelled",
        station_id=station_id,
        slot_id=slot_id,
        booking_id=booking_id,
        status=BOOKING_STATUS_CANCELLED,
    )

    return jsonify({"message": "Booking cancelled successfully"}), 200


@admin_bp.route("/revenue", methods=["GET"])
@token_required
@role_required("admin")
def get_admin_revenue(_current_user):
    cursor = None
    try:
        cursor = mysql.connection.cursor()
        _ensure_phase5_tables(cursor)
        analytics = _fetch_revenue_analytics(cursor)
    except Exception:
        current_app.logger.exception("Failed to fetch admin revenue")
        return jsonify({"error": "Failed to fetch revenue"}), 500
    finally:
        if cursor:
            cursor.close()

    return jsonify(analytics), 200
