try:
    import eventlet

    eventlet.monkey_patch()
except Exception:  # pragma: no cover - eventlet patching is environment-specific.
    eventlet = None

from flask import Flask, g, jsonify, request
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


def _resolve_allowed_origin(origin):
    if not origin:
        return None
    if allowed_origins == "*":
        return "*"
    return origin if origin in allowed_origins else None


def _apply_cors_headers(response):
    allowed_origin = _resolve_allowed_origin(request.headers.get("Origin"))
    if not allowed_origin:
        return response

    response.headers["Access-Control-Allow-Origin"] = allowed_origin
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    response.headers["Access-Control-Expose-Headers"] = "X-Session-Token"
    response.headers["Vary"] = "Origin"
    return response


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


@app.after_request
def refresh_session_token(response):
    authenticated_user = getattr(g, "authenticated_user", None)

    if authenticated_user and response.status_code < 400:
        refreshed_token = generate_token(
            authenticated_user["user_id"],
            authenticated_user["role"],
            session_id=authenticated_user.get("session_id"),
        )
        if isinstance(refreshed_token, bytes):
            refreshed_token = refreshed_token.decode("utf-8")

        response.headers["X-Session-Token"] = refreshed_token
    return _apply_cors_headers(response)


if __name__ == "__main__":
    debug_enabled = get_debug_enabled()
    socketio.run(
        app,
        host=get_bind_host(),
        port=get_bind_port(),
        debug=debug_enabled,
        allow_unsafe_werkzeug=True,
    )
