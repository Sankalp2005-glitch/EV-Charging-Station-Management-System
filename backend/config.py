import os
from pathlib import Path
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
]


class ConfigError(RuntimeError):
    """Raised when required runtime configuration is missing."""


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ENV_FILE_CANDIDATES = (
    PROJECT_ROOT / ".env",
    Path(__file__).resolve().parent / ".env",
)


def _strip_wrapping_quotes(value):
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]
    return value


def _load_dotenv_files():
    for env_path in ENV_FILE_CANDIDATES:
        if not env_path.exists():
            continue
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[7:].strip()
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if not key or key in os.environ:
                continue
            os.environ[key] = _strip_wrapping_quotes(value.strip())


_load_dotenv_files()


def _clean_env(value):
    return value.strip() if isinstance(value, str) else ""


def _split_csv(value):
    return [item.strip() for item in (value or "").split(",") if item.strip()]


def _is_truthy(value):
    return _clean_env(value).lower() in {"1", "true", "yes", "on"}


def get_app_environment():
    raw_environment = (
        _clean_env(os.getenv("APP_ENV"))
        or _clean_env(os.getenv("ENVIRONMENT"))
        or _clean_env(os.getenv("FLASK_ENV"))
    )
    if raw_environment:
        return raw_environment.lower()
    if _is_truthy(os.getenv("RENDER")):
        return "production"
    return "development"


def is_production_environment():
    return get_app_environment() in {"production", "prod"}


def _require_production_value(label, value, guidance):
    if is_production_environment() and not value:
        raise ConfigError(f"{label} is required in production. {guidance}")
    return value


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
    use_url_config = bool(url_config)
    mysql_host = (
        (url_config.get("MYSQL_HOST") if use_url_config else "")
        or _clean_env(os.getenv("MYSQL_HOST"))
        or _clean_env(os.getenv("MYSQLHOST"))
        or ("localhost" if not is_production_environment() else "")
    )
    mysql_port = int(
        (url_config.get("MYSQL_PORT") if use_url_config else "")
        or _clean_env(os.getenv("MYSQL_PORT"))
        or _clean_env(os.getenv("MYSQLPORT"))
        or 3306
    )
    mysql_user = (
        (url_config.get("MYSQL_USER") if use_url_config else "")
        or _clean_env(os.getenv("MYSQL_USER"))
        or _clean_env(os.getenv("MYSQLUSER"))
        or ("root" if not is_production_environment() else "")
    )
    mysql_password = (
        (url_config.get("MYSQL_PASSWORD") if use_url_config else "")
        or _clean_env(os.getenv("MYSQL_PASSWORD"))
        or _clean_env(os.getenv("MYSQLPASSWORD"))
    )
    mysql_db = (
        (url_config.get("MYSQL_DB") if use_url_config else "")
        or _clean_env(os.getenv("MYSQL_DB"))
        or _clean_env(os.getenv("MYSQLDATABASE"))
        or ("ev_charging_system" if not is_production_environment() else "")
    )

    _require_production_value(
        "MySQL host",
        mysql_host,
        "Set MYSQL_URL/DATABASE_URL or MYSQL_HOST.",
    )
    _require_production_value(
        "MySQL user",
        mysql_user,
        "Set MYSQL_URL/DATABASE_URL or MYSQL_USER.",
    )
    _require_production_value(
        "MySQL password",
        mysql_password,
        "Set MYSQL_URL/DATABASE_URL or MYSQL_PASSWORD.",
    )
    _require_production_value(
        "MySQL database",
        mysql_db,
        "Set MYSQL_URL/DATABASE_URL or MYSQL_DB.",
    )

    mysql_config = {
        "MYSQL_HOST": mysql_host,
        "MYSQL_PORT": mysql_port,
        "MYSQL_USER": mysql_user,
        "MYSQL_PASSWORD": mysql_password,
        "MYSQL_DB": mysql_db,
        "MYSQL_CONNECT_TIMEOUT": int(_clean_env(os.getenv("MYSQL_CONNECT_TIMEOUT")) or 10),
    }

    ssl_mode = _clean_env(os.getenv("MYSQL_SSL_MODE")).upper()
    if ssl_mode:
        mysql_config["MYSQL_CUSTOM_OPTIONS"] = {"ssl_mode": ssl_mode}

    return mysql_config


def get_secret_key():
    secret_key = _clean_env(os.getenv("SECRET_KEY"))
    if secret_key:
        return secret_key
    if is_production_environment():
        raise ConfigError("SECRET_KEY is required in production. Set it in your Render environment variables.")
    return "dev-only-secret-key"


def get_debug_enabled():
    return _clean_env(os.getenv("FLASK_DEBUG")) == "1"


def get_bind_host():
    return _clean_env(os.getenv("FLASK_RUN_HOST")) or ("0.0.0.0" if is_production_environment() else "127.0.0.1")


def get_bind_port():
    return int(_clean_env(os.getenv("FLASK_RUN_PORT")) or 5000)


def get_cors_allowed_origins():
    raw_origins = _split_csv(_clean_env(os.getenv("CORS_ALLOWED_ORIGINS")))
    single_origin = _clean_env(os.getenv("FRONTEND_ORIGIN"))

    origins = raw_origins or ([single_origin] if single_origin else [])
    if any(origin == "*" for origin in origins):
        return "*"
    if origins and not is_production_environment():
        merged_origins = []
        for origin in [*origins, *LOCAL_FRONTEND_ORIGINS]:
            if origin and origin not in merged_origins:
                merged_origins.append(origin)
        return merged_origins
    if origins:
        return origins
    if is_production_environment():
        raise ConfigError(
            "FRONTEND_ORIGIN or CORS_ALLOWED_ORIGINS is required in production. "
            "Set it to your deployed Vercel frontend URL."
        )
    return LOCAL_FRONTEND_ORIGINS
