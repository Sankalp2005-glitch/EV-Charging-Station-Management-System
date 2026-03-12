import re

from MySQLdb import IntegrityError
from flask import Blueprint, current_app, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

from extensions import mysql
from utils.jwt_handler import generate_token, token_required

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_PATTERN = re.compile(r"^[0-9]{10,13}$")
MIN_PASSWORD_LENGTH = 8


def _clean_text(value):
    return value.strip() if isinstance(value, str) else ""


def _decode_if_bytes(value):
    return value.decode("utf-8") if isinstance(value, bytes) else value


@auth_bp.route("/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}

    name = _clean_text(data.get("name"))
    email = _clean_text(data.get("email")).lower()
    phone = _clean_text(data.get("phone"))
    password = data.get("password") if isinstance(data.get("password"), str) else ""
    role = _clean_text(data.get("role")).lower()

    if not name or not email or not phone or not password or not role:
        return jsonify({"error": "All fields are required"}), 400
    if role not in {"customer", "owner"}:
        return jsonify({"error": "Invalid role"}), 400
    if not EMAIL_PATTERN.match(email):
        return jsonify({"error": "Invalid email format"}), 400
    if not PHONE_PATTERN.match(phone):
        return jsonify({"error": "Phone must be 10 to 13 digits"}), 400
    if len(password) < MIN_PASSWORD_LENGTH:
        return jsonify({"error": f"Password must be at least {MIN_PASSWORD_LENGTH} characters"}), 400

    cursor = None

    try:
        cursor = mysql.connection.cursor()
        cursor.execute(
            """
            INSERT INTO Users (name, email, phone, password, role)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (name, email, phone, generate_password_hash(password), role),
        )
        mysql.connection.commit()
    except IntegrityError as error:
        mysql.connection.rollback()
        error_text = str(error).lower()
        if "email" in error_text:
            return jsonify({"error": "Email already exists"}), 409
        if "phone" in error_text:
            return jsonify({"error": "Phone already exists"}), 409
        return jsonify({"error": "User already exists"}), 409
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception("Registration failed for email=%s", email)
        return jsonify({"error": "Registration failed"}), 500
    finally:
        if cursor:
            cursor.close()

    return jsonify({"message": "User registered successfully"}), 201


@auth_bp.route("/forgot-password", methods=["POST"])
def forgot_password():
    data = request.get_json(silent=True) or {}

    email = _clean_text(data.get("email")).lower()
    new_password = data.get("new_password") if isinstance(data.get("new_password"), str) else ""

    if not email or not new_password:
        return jsonify({"error": "Email and new password are required"}), 400
    if not EMAIL_PATTERN.match(email):
        return jsonify({"error": "Invalid email format"}), 400
    if len(new_password) < MIN_PASSWORD_LENGTH:
        return jsonify({"error": f"Password must be at least {MIN_PASSWORD_LENGTH} characters"}), 400

    cursor = None
    try:
        cursor = mysql.connection.cursor()
        cursor.execute(
            """
            SELECT user_id
            FROM Users
            WHERE LOWER(email) = %s
            LIMIT 1
            """,
            (email,),
        )
        user = cursor.fetchone()

        if not user:
            return jsonify({"error": "No account found with that email"}), 404

        cursor.execute(
            """
            UPDATE Users
            SET password = %s
            WHERE user_id = %s
            """,
            (generate_password_hash(new_password), user[0]),
        )
        mysql.connection.commit()
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception("Password reset failed for email=%s", email)
        return jsonify({"error": "Password reset failed"}), 500
    finally:
        if cursor:
            cursor.close()

    return jsonify({"message": "Password reset successful"}), 200


@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}

    email = _clean_text(data.get("email")).lower()
    password = data.get("password") if isinstance(data.get("password"), str) else ""

    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    cursor = None
    try:
        cursor = mysql.connection.cursor()
        cursor.execute(
            """
            SELECT user_id, password, role
            FROM Users
            WHERE LOWER(email) = %s
            LIMIT 1
            """,
            (email,),
        )
        user = cursor.fetchone()
    except Exception:
        current_app.logger.exception("Login query failed for email=%s", email)
        return jsonify({"error": "Login failed"}), 500
    finally:
        if cursor:
            cursor.close()

    if not user:
        return jsonify({"error": "Invalid credentials"}), 401

    user_id = user[0]
    hashed_password = user[1].decode("utf-8") if isinstance(user[1], bytes) else user[1]
    role = user[2].decode("utf-8") if isinstance(user[2], bytes) else user[2]

    if not check_password_hash(hashed_password, password):
        return jsonify({"error": "Invalid credentials"}), 401

    token = generate_token(user_id, role)
    if isinstance(token, bytes):
        token = token.decode("utf-8")

    return jsonify(
        {
            "message": "Login successful",
            "token": token,
            "role": role,
            "user_id": user_id,
        }
    ), 200


@auth_bp.route("/me", methods=["GET"])
@token_required
def get_me(current_user):
    cursor = None
    try:
        cursor = mysql.connection.cursor()
        cursor.execute(
            """
            SELECT user_id, name, email, phone, role
            FROM Users
            WHERE user_id = %s
            LIMIT 1
            """,
            (current_user["user_id"],),
        )
        user = cursor.fetchone()
    except Exception:
        current_app.logger.exception("Failed to fetch user profile for user_id=%s", current_user.get("user_id"))
        return jsonify({"error": "Failed to fetch profile"}), 500
    finally:
        if cursor:
            cursor.close()

    if not user:
        return jsonify({"error": "User not found"}), 404

    return jsonify(
        {
            "user_id": user[0],
            "name": _decode_if_bytes(user[1]),
            "email": _decode_if_bytes(user[2]),
            "phone": _decode_if_bytes(user[3]),
            "role": _decode_if_bytes(user[4]),
        }
    ), 200


@auth_bp.route("/me", methods=["PUT"])
@token_required
def update_me(current_user):
    data = request.get_json(silent=True) or {}

    raw_name = data.get("name")
    raw_email = data.get("email")
    raw_phone = data.get("phone")
    raw_current_password = data.get("current_password")
    raw_new_password = data.get("new_password")

    update_fields = {}

    if raw_name is not None:
        name = _clean_text(raw_name)
        if not name:
            return jsonify({"error": "name cannot be empty"}), 400
        update_fields["name"] = name

    if raw_email is not None:
        email = _clean_text(raw_email).lower()
        if not EMAIL_PATTERN.match(email):
            return jsonify({"error": "Invalid email format"}), 400
        update_fields["email"] = email

    if raw_phone is not None:
        phone = _clean_text(raw_phone)
        if not PHONE_PATTERN.match(phone):
            return jsonify({"error": "Phone must be 10 to 13 digits"}), 400
        update_fields["phone"] = phone

    wants_password_change = raw_current_password is not None or raw_new_password is not None
    current_password = raw_current_password if isinstance(raw_current_password, str) else ""
    new_password = raw_new_password if isinstance(raw_new_password, str) else ""

    if wants_password_change:
        if not current_password or not new_password:
            return jsonify({"error": "current_password and new_password are required for password change"}), 400
        if len(new_password) < MIN_PASSWORD_LENGTH:
            return jsonify({"error": f"Password must be at least {MIN_PASSWORD_LENGTH} characters"}), 400

    if not update_fields and not wants_password_change:
        return jsonify({"error": "No changes provided"}), 400

    cursor = None
    try:
        cursor = mysql.connection.cursor()
        cursor.execute(
            """
            SELECT password
            FROM Users
            WHERE user_id = %s
            LIMIT 1
            """,
            (current_user["user_id"],),
        )
        user = cursor.fetchone()
        if not user:
            return jsonify({"error": "User not found"}), 404

        existing_password = _decode_if_bytes(user[0])
        if wants_password_change and not check_password_hash(existing_password, current_password):
            return jsonify({"error": "Current password is incorrect"}), 401

        set_clauses = []
        params = []

        for key in ("name", "email", "phone"):
            if key in update_fields:
                set_clauses.append(f"{key} = %s")
                params.append(update_fields[key])

        if wants_password_change:
            set_clauses.append("password = %s")
            params.append(generate_password_hash(new_password))

        params.append(current_user["user_id"])
        cursor.execute(
            f"""
            UPDATE Users
            SET {", ".join(set_clauses)}
            WHERE user_id = %s
            """,
            tuple(params),
        )
        mysql.connection.commit()
    except IntegrityError as error:
        mysql.connection.rollback()
        error_text = str(error).lower()
        if "email" in error_text:
            return jsonify({"error": "Email already exists"}), 409
        if "phone" in error_text:
            return jsonify({"error": "Phone already exists"}), 409
        return jsonify({"error": "Update conflict"}), 409
    except Exception:
        mysql.connection.rollback()
        current_app.logger.exception("Failed to update user profile for user_id=%s", current_user.get("user_id"))
        return jsonify({"error": "Failed to update profile"}), 500
    finally:
        if cursor:
            cursor.close()

    return jsonify({"message": "Profile updated successfully"}), 200
