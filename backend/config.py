import os
from urllib.parse import unquote, urlparse


LOCAL_FRONTEND_ORIGINS = [
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1:4173",
    "http://localhost:4173",
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://127.0.0.1:8080",
    "http://localhost:8080",
    "http://127.0.0.1:8123",
    "http://localhost:8123",
]


def _clean_env(value):
    return value.strip() if isinstance(value, str) else ""


def _split_csv(value):
    return [item.strip() for item in (value or "").split(",") if item.strip()]


def _parse_mysql_url():
    raw_url = (
        _clean_env(os.getenv("MYSQL_URL"))
        or _clean_env(os.getenv("DATABASE_URL"))
        or _clean_env(os.getenv("RAILWAY_MYSQL_URL"))
    )
    if not raw_url:
        return {}

    parsed = urlparse(raw_url)
    if parsed.scheme not in {"mysql", "mysql2"}:
        return {}

    database_name = parsed.path.lstrip("/")
    return {
        "MYSQL_HOST": parsed.hostname or "",
        "MYSQL_PORT": parsed.port or 3306,
        "MYSQL_USER": unquote(parsed.username or ""),
        "MYSQL_PASSWORD": unquote(parsed.password or ""),
        "MYSQL_DB": database_name,
    }


def load_mysql_config():
    url_config = _parse_mysql_url()
    mysql_config = {
        "MYSQL_HOST": (
            _clean_env(os.getenv("MYSQL_HOST"))
            or _clean_env(os.getenv("MYSQLHOST"))
            or url_config.get("MYSQL_HOST")
            or "localhost"
        ),
        "MYSQL_PORT": int(
            _clean_env(os.getenv("MYSQL_PORT"))
            or _clean_env(os.getenv("MYSQLPORT"))
            or url_config.get("MYSQL_PORT")
            or 3306
        ),
        "MYSQL_USER": (
            _clean_env(os.getenv("MYSQL_USER"))
            or _clean_env(os.getenv("MYSQLUSER"))
            or url_config.get("MYSQL_USER")
            or "root"
        ),
        "MYSQL_PASSWORD": (
            _clean_env(os.getenv("MYSQL_PASSWORD"))
            or _clean_env(os.getenv("MYSQLPASSWORD"))
            or url_config.get("MYSQL_PASSWORD")
            or "Sankalp268@"
        ),
        "MYSQL_DB": (
            _clean_env(os.getenv("MYSQL_DB"))
            or _clean_env(os.getenv("MYSQLDATABASE"))
            or url_config.get("MYSQL_DB")
            or "ev_charging_system"
        ),
        "MYSQL_CONNECT_TIMEOUT": int(_clean_env(os.getenv("MYSQL_CONNECT_TIMEOUT")) or 10),
    }

    ssl_mode = _clean_env(os.getenv("MYSQL_SSL_MODE")).upper()
    if ssl_mode:
        mysql_config["MYSQL_CUSTOM_OPTIONS"] = {"ssl_mode": ssl_mode}

    return mysql_config


def get_secret_key():
    return _clean_env(os.getenv("SECRET_KEY")) or "change-me-before-production"


def get_debug_enabled():
    return _clean_env(os.getenv("FLASK_DEBUG")) == "1"


def get_bind_host():
    return _clean_env(os.getenv("FLASK_RUN_HOST")) or "127.0.0.1"


def get_bind_port():
    return int(_clean_env(os.getenv("FLASK_RUN_PORT")) or 5000)


def get_cors_allowed_origins():
    raw_origins = _split_csv(_clean_env(os.getenv("CORS_ALLOWED_ORIGINS")))
    single_origin = _clean_env(os.getenv("FRONTEND_ORIGIN"))

    origins = raw_origins or ([single_origin] if single_origin else [])
    if any(origin == "*" for origin in origins):
        return "*"
    if origins:
        return origins
    return LOCAL_FRONTEND_ORIGINS
