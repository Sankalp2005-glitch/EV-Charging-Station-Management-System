import re

LOCAL_PHONE_PATTERN = re.compile(r"^[0-9]{10}$")
COUNTRY_CODE_PATTERN = re.compile(r"^[1-9][0-9]{0,2}$")
PHONE_PATTERN = LOCAL_PHONE_PATTERN


def normalize_digits(value):
    return re.sub(r"\D", "", value) if isinstance(value, str) else ""


def build_contact_number(contact_raw, country_code_raw):
    local_number = normalize_digits(contact_raw)
    country_code = normalize_digits(country_code_raw)

    if not local_number and not country_code:
        return "", None

    if country_code:
        if not COUNTRY_CODE_PATTERN.match(country_code):
            return None, "contact_country_code must be 1 to 3 digits"
        if not LOCAL_PHONE_PATTERN.match(local_number):
            return None, "contact_number must be 10 digits"
        return f"{country_code}{local_number}", None

    if LOCAL_PHONE_PATTERN.match(local_number):
        return local_number, None

    return None, "contact_number must be 10 digits"


def clean_text(value):
    return value.strip() if isinstance(value, str) else ""


def is_close(value, target, tolerance=0.01):
    try:
        return abs(float(value) - float(target)) <= tolerance
    except (TypeError, ValueError):
        return False


def resolve_slot_types(raw_slot_types, fallback_slot_type, total_slots):
    if isinstance(raw_slot_types, list):
        if len(raw_slot_types) != total_slots:
            return None, "slot_types length must match total_slots"

        resolved = []
        for slot_type in raw_slot_types:
            normalized = clean_text(slot_type).lower()
            if normalized not in {"fast", "normal"}:
                return None, "Each slot type must be 'fast' or 'normal'"
            resolved.append(normalized)
        return resolved, None

    normalized_fallback = clean_text(fallback_slot_type).lower()
    if normalized_fallback not in {"fast", "normal"}:
        return None, "Provide slot_types array or slot_type as 'fast'/'normal'"
    return [normalized_fallback for _ in range(total_slots)], None
