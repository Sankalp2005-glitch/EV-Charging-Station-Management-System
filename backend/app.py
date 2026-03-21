import os

from flask import Flask, g, jsonify
from flask_cors import CORS
from MySQLdb import OperationalError
from werkzeug.exceptions import HTTPException

from extensions import mysql, socketio
from utils.jwt_handler import generate_token

app = Flask(__name__)
CORS(app)

app.config["MYSQL_HOST"] = os.getenv("MYSQL_HOST", "localhost")
app.config["MYSQL_USER"] = os.getenv("MYSQL_USER", "root")
app.config["MYSQL_PASSWORD"] = os.getenv("MYSQL_PASSWORD", "Sankalp268@")
app.config["MYSQL_DB"] = os.getenv("MYSQL_DB", "ev_charging_system")
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "super_secret_key_change_this")

mysql.init_app(app)
socketio.init_app(app, cors_allowed_origins="*")


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
    debug_enabled = os.getenv("FLASK_DEBUG", "1") == "1"
    socketio.run(
        app,
        host=os.getenv("FLASK_RUN_HOST", "127.0.0.1"),
        port=int(os.getenv("FLASK_RUN_PORT", "5000")),
        debug=debug_enabled,
    )
