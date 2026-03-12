from datetime import datetime

from services.booking_config import BOOKING_STATUS_CANCELLED
from services.value_utils import to_str


def _month_window(month_count):
    today = datetime.now()
    year = today.year
    month = today.month
    months = []
    for offset in range(month_count - 1, -1, -1):
        rolling_month = month - offset
        rolling_year = year
        while rolling_month <= 0:
            rolling_month += 12
            rolling_year -= 1
        months.append((rolling_year, rolling_month))
    return months


def _month_key(year, month):
    return f"{year:04d}-{month:02d}"


def _month_label(year, month):
    return datetime(year, month, 1).strftime("%b %Y")


def _build_scope_clause(owner_user_id):
    if owner_user_id is None:
        return "", ()
    return " WHERE cs.user_id = %s ", (owner_user_id,)


def _revenue_case_sql():
    return f"""
        CASE
            WHEN p.payment_status = 'paid' AND b.status <> '{BOOKING_STATUS_CANCELLED}'
            THEN COALESCE(sess.total_cost, p.amount, 0)
            ELSE 0
        END
    """


def fetch_revenue_analytics(cursor, owner_user_id=None, month_count=6):
    revenue_case = _revenue_case_sql()
    scope_clause, scope_params = _build_scope_clause(owner_user_id)

    summary_query = f"""
        SELECT
            COUNT(DISTINCT cs.station_id) AS station_count,
            COALESCE(SUM({revenue_case}), 0) AS total_revenue,
            COUNT(DISTINCT CASE
                WHEN p.payment_status = 'paid' AND b.status <> '{BOOKING_STATUS_CANCELLED}'
                THEN b.booking_id
                ELSE NULL
            END) AS paid_bookings,
            COALESCE(AVG(CASE
                WHEN p.payment_status = 'paid' AND b.status <> '{BOOKING_STATUS_CANCELLED}'
                THEN COALESCE(sess.total_cost, p.amount, 0)
                ELSE NULL
            END), 0) AS average_booking_revenue
        FROM ChargingStation cs
        LEFT JOIN ChargingSlot sl ON sl.station_id = cs.station_id
        LEFT JOIN Booking b ON b.slot_id = sl.slot_id
        LEFT JOIN Payment p ON p.booking_id = b.booking_id
        LEFT JOIN ChargingSession sess ON sess.booking_id = b.booking_id
        {scope_clause}
    """
    cursor.execute(summary_query, scope_params)
    summary_row = cursor.fetchone() or (0, 0, 0, 0)

    station_query = f"""
        SELECT
            cs.station_id,
            cs.station_name,
            cs.location,
            COUNT(DISTINCT sl.slot_id) AS charger_count,
            COALESCE(SUM({revenue_case}), 0) AS total_revenue,
            COUNT(DISTINCT CASE
                WHEN p.payment_status = 'paid' AND b.status <> '{BOOKING_STATUS_CANCELLED}'
                THEN b.booking_id
                ELSE NULL
            END) AS paid_bookings
        FROM ChargingStation cs
        LEFT JOIN ChargingSlot sl ON sl.station_id = cs.station_id
        LEFT JOIN Booking b ON b.slot_id = sl.slot_id
        LEFT JOIN Payment p ON p.booking_id = b.booking_id
        LEFT JOIN ChargingSession sess ON sess.booking_id = b.booking_id
        {scope_clause}
        GROUP BY cs.station_id, cs.station_name, cs.location
        ORDER BY total_revenue DESC, cs.station_name ASC
    """
    cursor.execute(station_query, scope_params)
    station_rows = cursor.fetchall() or []
    station_revenue = [
        {
            "station_id": int(row[0]),
            "station_name": to_str(row[1]),
            "location": to_str(row[2]),
            "charger_count": int(row[3] or 0),
            "total_revenue": round(float(row[4] or 0), 2),
            "paid_bookings": int(row[5] or 0),
        }
        for row in station_rows
    ]

    months = _month_window(month_count)
    first_month_year, first_month = months[0]
    first_month_start = f"{first_month_year:04d}-{first_month:02d}-01 00:00:00"

    monthly_query = f"""
        SELECT
            DATE_FORMAT(COALESCE(p.payment_date, b.start_time), '%%Y-%%m') AS month_key,
            COALESCE(SUM({revenue_case}), 0) AS total_revenue,
            COUNT(DISTINCT CASE
                WHEN p.payment_status = 'paid' AND b.status <> '{BOOKING_STATUS_CANCELLED}'
                THEN b.booking_id
                ELSE NULL
            END) AS paid_bookings
        FROM ChargingStation cs
        JOIN ChargingSlot sl ON sl.station_id = cs.station_id
        JOIN Booking b ON b.slot_id = sl.slot_id
        LEFT JOIN Payment p ON p.booking_id = b.booking_id
        LEFT JOIN ChargingSession sess ON sess.booking_id = b.booking_id
        WHERE COALESCE(p.payment_date, b.start_time) >= %s
    """
    monthly_params = [first_month_start]
    if owner_user_id is not None:
        monthly_query += " AND cs.user_id = %s"
        monthly_params.append(owner_user_id)
    monthly_query += """
        GROUP BY month_key
        ORDER BY month_key ASC
    """
    cursor.execute(monthly_query, tuple(monthly_params))
    monthly_rows = cursor.fetchall() or []
    monthly_map = {
        to_str(row[0]): {
            "total_revenue": round(float(row[1] or 0), 2),
            "paid_bookings": int(row[2] or 0),
        }
        for row in monthly_rows
        if row[0]
    }

    monthly_trend = []
    for year, month in months:
        key = _month_key(year, month)
        row = monthly_map.get(key, {})
        monthly_trend.append(
            {
                "month_key": key,
                "label": _month_label(year, month),
                "total_revenue": round(float(row.get("total_revenue") or 0), 2),
                "paid_bookings": int(row.get("paid_bookings") or 0),
            }
        )

    top_station = station_revenue[0] if station_revenue else None
    summary = {
        "station_count": int(summary_row[0] or 0),
        "total_revenue": round(float(summary_row[1] or 0), 2),
        "paid_bookings": int(summary_row[2] or 0),
        "average_booking_revenue": round(float(summary_row[3] or 0), 2),
        "top_station": top_station,
    }
    return {
        "summary": summary,
        "station_revenue": station_revenue,
        "monthly_trend": monthly_trend,
    }
