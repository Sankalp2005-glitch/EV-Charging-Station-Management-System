from flask import Blueprint, current_app, jsonify, request

from extensions import mysql
from services.booking_lifecycle import (
    emit_lifecycle_updates as _emit_lifecycle_updates,
    run_booking_lifecycle_updates as _run_booking_lifecycle_updates,
)
from services.booking_schema import ensure_phase5_tables as _ensure_phase5_tables
from services.revenue_analytics import fetch_revenue_analytics as _fetch_revenue_analytics
from services.value_utils import format_dt as _format_dt, to_str as _to_str
from utils.jwt_handler import get_active_session_count, role_required, token_required
from utils.station_approval import (
    APPROVAL_STATUS_APPROVED,
    APPROVAL_STATUS_PENDING,
    APPROVAL_STATUSES,
    backfill_missing_station_approvals,
    ensure_station_approval_table,
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
