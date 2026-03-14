import re

from MySQLdb import IntegrityError
from flask import Blueprint, current_app, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

from extensions import mysql
from utils.jwt_handler import generate_token, token_required
from utils.user_status import USER_STATUS_ACTIVE, ensure_user_status_table

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
LOCAL_PHONE_PATTERN = re.compile(r"^[0-9]{10}$")
FULL_PHONE_PATTERN = re.compile(r"^[0-9]{10,13}$")
COUNTRY_CODE_PATTERN = re.compile(r"^[1-9][0-9]{0,2}$")
MIN_PASSWORD_LENGTH = 8


def _clean_text(value):
    return value.strip() if isinstance(value, str) else ""


def _decode_if_bytes(value):
    return value.decode("utf-8") if isinstance(value, bytes) else value


def _normalize_phone(value):
    if not isinstance(value, str):
        return ""
    return re.sub(r"\D", "", value)


def _normalize_digits(value):
    return _normalize_phone(value)


def _normalize_country_code(value):
    if value is None:
        return ""
    return _normalize_digits(value)


def _build_full_phone(country_code_raw, phone_raw):
    local_phone = _normalize_digits(phone_raw)
    country_code = _normalize_country_code(country_code_raw)

    if country_code:
        if not COUNTRY_CODE_PATTERN.match(country_code):
            return None, "Country code must be 1 to 3 digits"
        if not LOCAL_PHONE_PATTERN.match(local_phone):
            return None, "Phone number must be 10 digits"
        return f"{country_code}{local_phone}", None

    if not LOCAL_PHONE_PATTERN.match(local_phone):
        return None, "Phone number must be 10 digits"
    return local_phone, None


def _normalize_identifier(value):
    cleaned = _clean_text(value)
    if not cleaned:
        return None, ""
    lowered = cleaned.lower()
    if EMAIL_PATTERN.match(lowered):
        return "email", lowered
    normalized_phone = _normalize_phone(cleaned)
    if LOCAL_PHONE_PATTERN.match(normalized_phone) or FULL_PHONE_PATTERN.match(normalized_phone):
        return "phone", normalized_phone
    return None, ""


def _phone_match_clause(column_name, phone_digits):
    if len(phone_digits) == 10:
        return f"RIGHT({column_name}, 10) = %s", (phone_digits,)
    return f"{column_name} = %s", (phone_digits,)


def _mask_email(value):
    email = _decode_if_bytes(value) or ""
    if "@" not in email:
        return ""
    local, domain = email.split("@", 1)
    if not local:
        return f"***@{domain}"
    if len(local) <= 2:
        masked_local = f"{local[0]}*"
    else:
        masked_local = f"{local[0]}{'*' * (len(local) - 2)}{local[-1]}"
    return f"{masked_local}@{domain}"


def _mask_phone(value):
    phone = _normalize_phone(_decode_if_bytes(value))
    if not phone:
        return ""
    if len(phone) <= 4:
        return "*" * len(phone)
    return f"{'*' * (len(phone) - 4)}{phone[-4:]}"


def _fetch_user_status(cursor, user_id):
    try:
        ensure_user_status_table(cursor)
        cursor.execute(
            """
            SELECT status
            FROM UserAccountStatus
            WHERE user_id = %s
            LIMIT 1
            """,
            (user_id,),
        )
        row = cursor.fetchone()
        return _decode_if_bytes(row[0]) if row else USER_STATUS_ACTIVE
    except Exception:
        current_app.logger.exception("Failed to fetch account status for user_id=%s", user_id)
        return USER_STATUS_ACTIVE


@auth_bp.route("/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}

    name = _clean_text(data.get("name"))
    email = _clean_text(data.get("email")).lower()
    phone_raw = data.get("phone")
    country_code_raw = data.get("country_code")
    password = data.get("password") if isinstance(data.get("password"), str) else ""
    role = _clean_text(data.get("role")).lower()

    if not name or not email or not phone_raw or not password or not role:
        return jsonify({"error": "All fields are required"}), 400
    if role not in {"customer", "owner"}:
        return jsonify({"error": "Invalid role"}), 400
    if not EMAIL_PATTERN.match(email):
        return jsonify({"error": "Invalid email format"}), 400
    full_phone, phone_error = _build_full_phone(country_code_raw, phone_raw)
    if phone_error:
        return jsonify({"error": phone_error}), 400
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
            (name, email, full_phone, generate_password_hash(password), role),
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

    cursor = None
    try:
        cursor = mysql.connection.cursor()
        account_status = _fetch_user_status(cursor, user_id)
    finally:
        if cursor:
            cursor.close()

    if str(account_status).lower() != USER_STATUS_ACTIVE:
        return jsonify({"error": f"Account {account_status}"}), 403

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


@auth_bp.route("/password-reset/identify", methods=["POST"])
def password_reset_identify():
    data = request.get_json(silent=True) or {}
    identifier_type, identifier = _normalize_identifier(data.get("identifier"))

    if not identifier_type:
        return jsonify({"error": "Valid email or phone number is required"}), 400

    cursor = None
    try:
        cursor = mysql.connection.cursor()
        if identifier_type == "email":
            cursor.execute(
                """
                SELECT user_id, email, phone
                FROM Users
                WHERE LOWER(email) = %s
                LIMIT 1
                """,
                (identifier,),
            )
        else:
            clause, params = _phone_match_clause("phone", identifier)
            cursor.execute(
                f"""
                SELECT user_id, email, phone
                FROM Users
                WHERE {clause}
                LIMIT 1
                """,
                params,
            )
        user = cursor.fetchone()
    except Exception:
        current_app.logger.exception("Password reset identify failed for %s=%s", identifier_type, identifier)
        return jsonify({"error": "Password reset lookup failed"}), 500
    finally:
        if cursor:
            cursor.close()

    if not user:
        return jsonify({"error": "Account not found"}), 404

    email = _decode_if_bytes(user[1]) or ""
    phone = _decode_if_bytes(user[2]) or ""
    verification_type = "phone" if identifier_type == "email" else "email"
    masked = _mask_phone(phone) if verification_type == "phone" else _mask_email(email)

    return jsonify(
        {
            "message": "Account verified. Provide your additional verification detail.",
            "verification": {
                "type": verification_type,
                "masked": masked,
            },
        }
    ), 200


@auth_bp.route("/password-reset/complete", methods=["POST"])
def password_reset_complete():
    data = request.get_json(silent=True) or {}
    identifier_type, identifier = _normalize_identifier(data.get("identifier"))
    verification_raw = data.get("verification")
    new_password = data.get("new_password") if isinstance(data.get("new_password"), str) else ""

    if not identifier_type:
        return jsonify({"error": "Valid email or phone number is required"}), 400
    if not new_password:
        return jsonify({"error": "New password is required"}), 400
    if len(new_password) < MIN_PASSWORD_LENGTH:
        return jsonify({"error": f"Password must be at least {MIN_PASSWORD_LENGTH} characters"}), 400

    if identifier_type == "email":
        verification = _normalize_phone(_clean_text(verification_raw))
        if not (LOCAL_PHONE_PATTERN.match(verification) or FULL_PHONE_PATTERN.match(verification)):
            return jsonify({"error": "Valid phone number is required"}), 400
        clause, params = _phone_match_clause("phone", verification)
        lookup_query = f"""
            SELECT user_id
            FROM Users
            WHERE LOWER(email) = %s AND {clause}
            LIMIT 1
        """
        lookup_params = (identifier, *params)
    else:
        verification = _clean_text(verification_raw).lower()
        if not EMAIL_PATTERN.match(verification):
            return jsonify({"error": "Valid email address is required"}), 400
        clause, params = _phone_match_clause("phone", identifier)
        lookup_query = f"""
            SELECT user_id
            FROM Users
            WHERE {clause} AND LOWER(email) = %s
            LIMIT 1
        """
        lookup_params = (*params, verification)

    cursor = None
    try:
        cursor = mysql.connection.cursor()
        cursor.execute(lookup_query, lookup_params)
        user = cursor.fetchone()
        if not user:
            return jsonify({"error": "Verification failed. Please check your details."}), 401

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
        current_app.logger.exception("Password reset failed for %s=%s", identifier_type, identifier)
        return jsonify({"error": "Password reset failed"}), 500
    finally:
        if cursor:
            cursor.close()

    return jsonify({"message": "Password updated successfully"}), 200


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
    raw_country_code = data.get("country_code")
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

    if raw_phone is not None or raw_country_code is not None:
        full_phone, phone_error = _build_full_phone(raw_country_code, raw_phone)
        if phone_error:
            return jsonify({"error": phone_error}), 400
        update_fields["phone"] = full_phone

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
