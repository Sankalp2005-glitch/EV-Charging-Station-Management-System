from datetime import datetime, timedelta

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


def _day_window(day_count):
    today = datetime.now().date()
    return [today - timedelta(days=offset) for offset in range(day_count - 1, -1, -1)]


def _day_label(day_value):
    return day_value.strftime("%d %b")


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

    charger_query = f"""
        SELECT
            sl.slot_id,
            sl.slot_number,
            sl.slot_type,
            sl.charger_name,
            sl.power_kw,
            cs.station_id,
            cs.station_name,
            COALESCE(SUM({revenue_case}), 0) AS total_revenue,
            COUNT(DISTINCT CASE
                WHEN p.payment_status = 'paid' AND b.status <> '{BOOKING_STATUS_CANCELLED}'
                THEN b.booking_id
                ELSE NULL
            END) AS paid_bookings
        FROM ChargingStation cs
        JOIN ChargingSlot sl ON sl.station_id = cs.station_id
        LEFT JOIN Booking b ON b.slot_id = sl.slot_id
        LEFT JOIN Payment p ON p.booking_id = b.booking_id
        LEFT JOIN ChargingSession sess ON sess.booking_id = b.booking_id
        {scope_clause}
        GROUP BY
            sl.slot_id,
            sl.slot_number,
            sl.slot_type,
            sl.charger_name,
            sl.power_kw,
            cs.station_id,
            cs.station_name
        ORDER BY total_revenue DESC, sl.slot_id ASC
    """
    cursor.execute(charger_query, scope_params)
    charger_rows = cursor.fetchall() or []
    charger_revenue = [
        {
            "slot_id": int(row[0]),
            "slot_number": int(row[1]),
            "slot_type": to_str(row[2]),
            "charger_name": to_str(row[3]),
            "power_kw": float(row[4]) if row[4] is not None else None,
            "station_id": int(row[5]),
            "station_name": to_str(row[6]),
            "total_revenue": round(float(row[7] or 0), 2),
            "paid_bookings": int(row[8] or 0),
        }
        for row in charger_rows
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

    day_window = _day_window(14)
    first_day_start = f"{day_window[0]:%Y-%m-%d} 00:00:00"
    daily_query = f"""
        SELECT
            DATE(COALESCE(p.payment_date, b.start_time)) AS day_key,
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
    daily_params = [first_day_start]
    if owner_user_id is not None:
        daily_query += " AND cs.user_id = %s"
        daily_params.append(owner_user_id)
    daily_query += " GROUP BY day_key ORDER BY day_key ASC"
    cursor.execute(daily_query, tuple(daily_params))
    daily_rows = cursor.fetchall() or []
    daily_map = {
        to_str(row[0]): {
            "total_revenue": round(float(row[1] or 0), 2),
            "paid_bookings": int(row[2] or 0),
        }
        for row in daily_rows
        if row[0]
    }
    daily_trend = []
    for day_value in day_window:
        key = f"{day_value:%Y-%m-%d}"
        row = daily_map.get(key, {})
        daily_trend.append(
            {
                "day_key": key,
                "label": _day_label(day_value),
                "total_revenue": round(float(row.get("total_revenue") or 0), 2),
                "paid_bookings": int(row.get("paid_bookings") or 0),
            }
        )

    session_query = f"""
        SELECT b.status, COUNT(*) AS session_count
        FROM ChargingStation cs
        JOIN ChargingSlot sl ON sl.station_id = cs.station_id
        JOIN Booking b ON b.slot_id = sl.slot_id
        {scope_clause}
        GROUP BY b.status
        ORDER BY session_count DESC
    """
    cursor.execute(session_query, scope_params)
    session_rows = cursor.fetchall() or []
    session_distribution = [
        {"status": to_str(row[0]), "count": int(row[1] or 0)} for row in session_rows
    ]
    return {
        "summary": summary,
        "station_revenue": station_revenue,
        "charger_revenue": charger_revenue,
        "monthly_trend": monthly_trend,
        "daily_trend": daily_trend,
        "session_distribution": session_distribution,
    }
