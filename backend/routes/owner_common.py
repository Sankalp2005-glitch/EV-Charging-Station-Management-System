import re

PHONE_PATTERN = re.compile(r"^[0-9]{10,13}$")


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
