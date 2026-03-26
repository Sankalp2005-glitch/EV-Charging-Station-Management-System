try:
    import eventlet

    eventlet.monkey_patch()
except Exception:  # pragma: no cover - eventlet patching is environment-specific.
    eventlet = None

from flask import Flask, g, jsonify
from flask_cors import CORS
from MySQLdb import OperationalError
from werkzeug.exceptions import HTTPException

from config import (
    get_bind_host,
    get_bind_port,
    get_cors_allowed_origins,
    get_debug_enabled,
    get_secret_key,
    load_mysql_config,
)
from extensions import mysql, socketio
from utils.jwt_handler import generate_token

app = Flask(__name__)
app.config.update(load_mysql_config())
app.config["SECRET_KEY"] = get_secret_key()

allowed_origins = get_cors_allowed_origins()
CORS(app, origins=allowed_origins)

mysql.init_app(app)
socketio.init_app(app, cors_allowed_origins=allowed_origins)


def _safe_mysql_teardown(exception):
    try:
        mysql.teardown(exception)
    except OperationalError as error:
        # Ignore dropped-connection close errors during app/request teardown.
        if error.args and error.args[0] == 2006:
            app.logger.warning("Ignored MySQL close error during teardown: %s", error)
            return
        raise


app.teardown_appcontext_funcs = [
    _safe_mysql_teardown if getattr(func, "__name__", "") == "teardown" and getattr(func, "__self__", None) is mysql else func
    for func in app.teardown_appcontext_funcs
]

from routes.auth import auth_bp
from routes.booking import booking_bp
from routes.admin import admin_bp
from routes.owner import owner_bp   
from routes.owner_bookings import owner_bookings_bp
from routes.stations import stations_bp

app.register_blueprint(auth_bp)
app.register_blueprint(booking_bp)
app.register_blueprint(admin_bp)
app.register_blueprint(owner_bp)
app.register_blueprint(owner_bookings_bp)
app.register_blueprint(stations_bp)


@app.errorhandler(Exception)
def handle_unexpected_error(error):
    if isinstance(error, HTTPException):
        return error

    app.logger.exception("Unhandled exception during request")
    return jsonify({"error": "Internal server error"}), 500


@app.get("/healthz")
def health_check():
    return jsonify({"status": "ok"}), 200


@app.get("/debug/db")
def debug_db():
    """Temporary diagnostic endpoint – remove after debugging."""
    results = {"mysql_config": {}, "connection": False, "tables": [], "users_schema": [], "error": None}
    try:
        results["mysql_config"] = {
            "host": app.config.get("MYSQL_HOST", ""),
            "port": app.config.get("MYSQL_PORT", ""),
            "user": app.config.get("MYSQL_USER", ""),
            "db": app.config.get("MYSQL_DB", ""),
            "has_password": bool(app.config.get("MYSQL_PASSWORD")),
            "ssl_mode": (app.config.get("MYSQL_CUSTOM_OPTIONS") or {}).get("ssl_mode", "not set"),
        }
        cursor = mysql.connection.cursor()
        results["connection"] = True

        cursor.execute("SHOW TABLES")
        results["tables"] = [row[0] if isinstance(row[0], str) else row[0].decode() for row in cursor.fetchall()]

        cursor.execute("DESCRIBE Users")
        results["users_schema"] = [
            {
                "field": r[0].decode() if isinstance(r[0], bytes) else r[0],
                "type": r[1].decode() if isinstance(r[1], bytes) else r[1],
                "null": r[2].decode() if isinstance(r[2], bytes) else r[2],
                "key": r[3].decode() if isinstance(r[3], bytes) else r[3],
            }
            for r in cursor.fetchall()
        ]

        # Test a simple insert/rollback to find the exact error
        from werkzeug.security import generate_password_hash
        try:
            cursor.execute(
                "INSERT INTO Users (name, email, phone, password, role) VALUES (%s, %s, %s, %s, %s)",
                ("__debug_test__", "__debug__@test.invalid", "0000000000", generate_password_hash("test1234"), "customer"),
            )
            mysql.connection.rollback()
            results["insert_test"] = "OK (rolled back)"
        except Exception as insert_err:
            mysql.connection.rollback()
            results["insert_test"] = f"FAILED: {type(insert_err).__name__}: {insert_err}"

        cursor.close()
    except Exception as exc:
        results["error"] = f"{type(exc).__name__}: {exc}"
    return jsonify(results), 200


@app.after_request
def refresh_session_token(response):
    authenticated_user = getattr(g, "authenticated_user", None)

    if not authenticated_user or response.status_code >= 400:
        return response

    refreshed_token = generate_token(
        authenticated_user["user_id"],
        authenticated_user["role"],
        session_id=authenticated_user.get("session_id"),
    )
    if isinstance(refreshed_token, bytes):
        refreshed_token = refreshed_token.decode("utf-8")

    response.headers["X-Session-Token"] = refreshed_token
    return response


if __name__ == "__main__":
    debug_enabled = get_debug_enabled()
    socketio.run(
        app,
        host=get_bind_host(),
        port=get_bind_port(),
        debug=debug_enabled,
        allow_unsafe_werkzeug=True,
    )
