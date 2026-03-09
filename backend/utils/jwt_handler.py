import datetime
import os
import threading
import uuid
from functools import wraps

import jwt
from flask import current_app, g, jsonify, request
from jwt import ExpiredSignatureError, InvalidTokenError


ROLE_LEVEL = {
    "customer": 1,
    "owner": 2,
    "admin": 3
}

TOKEN_TTL_MINUTES = int(os.getenv("TOKEN_TTL_MINUTES", "15"))
ACTIVE_SESSIONS = {}
ACTIVE_SESSIONS_LOCK = threading.Lock()


def _utc_now():
    return datetime.datetime.utcnow()


def _prune_expired_sessions(now):
    cutoff = now - datetime.timedelta(minutes=TOKEN_TTL_MINUTES)
    expired_keys = [key for key, last_seen in ACTIVE_SESSIONS.items() if last_seen < cutoff]
    for key in expired_keys:
        ACTIVE_SESSIONS.pop(key, None)


def register_session_activity(user_id, session_id):
    key = f"{user_id}:{session_id}"
    now = _utc_now()
    with ACTIVE_SESSIONS_LOCK:
        _prune_expired_sessions(now)
        ACTIVE_SESSIONS[key] = now


def get_active_session_count():
    now = _utc_now()
    with ACTIVE_SESSIONS_LOCK:
        _prune_expired_sessions(now)
        return len(ACTIVE_SESSIONS)


def generate_token(user_id, role, ttl_minutes=None, session_id=None):
    ttl = ttl_minutes or TOKEN_TTL_MINUTES
    now = _utc_now()
    sid = session_id or str(uuid.uuid4())
    token = jwt.encode(
        {
            "user_id": user_id,
            "role": role,
            "sid": sid,
            "iat": now,
            "exp": now + datetime.timedelta(minutes=ttl)
        },
        current_app.config["SECRET_KEY"],
        algorithm="HS256"
    )
    return token


def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        parts = auth_header.split()

        if len(parts) != 2 or parts[0].lower() != "bearer":
            return jsonify({"error": "Token missing or malformed"}), 401

        token = parts[1]

        try:
            data = jwt.decode(
                token,
                current_app.config["SECRET_KEY"],
                algorithms=["HS256"]
            )
        except ExpiredSignatureError:
            return jsonify({"error": "Token expired"}), 401
        except InvalidTokenError:
            return jsonify({"error": "Invalid token"}), 401
        except Exception:
            current_app.logger.exception("Unexpected JWT decode error")
            return jsonify({"error": "Authentication failed"}), 401

        if not isinstance(data, dict) or "user_id" not in data or "role" not in data:
            return jsonify({"error": "Invalid token payload"}), 401

        session_id = data.get("sid")
        if not session_id:
            session_id = f"user-{data['user_id']}"

        register_session_activity(data["user_id"], session_id)
        g.authenticated_user = {
            "user_id": data["user_id"],
            "role": data["role"],
            "session_id": session_id,
        }
        return f(data, *args, **kwargs)

    return decorated


def role_required(required_role):
    def decorator(f):
        @wraps(f)
        def wrapper(current_user, *args, **kwargs):
            user_role = current_user.get("role")
            if not user_role:
                return jsonify({"error": "Invalid token payload"}), 401

            if ROLE_LEVEL.get(user_role, 0) < ROLE_LEVEL.get(required_role, 0):
                return jsonify({"error": "Unauthorized access"}), 403

            return f(current_user, *args, **kwargs)

        return wrapper

    return decorator
