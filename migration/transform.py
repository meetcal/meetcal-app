"""
transform.py — Field name transformations from Supabase (snake_case) to Convex (camelCase).

Usage:
    from transform import transform_row
    convex_row = transform_row("lifting_results", supabase_row)
"""

from typing import Any


def _to_float(val):
    """Convert a numeric/decimal value to float, or None."""
    return float(val) if val is not None else None


def _to_int(val):
    """Convert a value to int, or None."""
    return int(val) if val is not None else None


def transform_athlete(row: dict) -> dict:
    return {
        "memberId": row["member_id"],
        "name": row["name"],
        "age": int(row["age"]),
        "club": row["club"],
        "gender": row["gender"],
        "weightClass": row["weight_class"],
        "entryTotal": int(row["entry_total"]),
        "sessionNumber": _to_int(row.get("session_number")),
        "sessionPlatform": row.get("session_platform"),
        "meet": row["meet"],
        "adaptive": bool(row.get("adaptive", False)),
    }


def transform_intl_ranking(row: dict) -> dict:
    return {
        "legacyId": _to_int(row.get("id")),
        "meet": row.get("meet"),
        "ranking": _to_int(row.get("ranking")),
        "name": row.get("name"),
        "weightClass": row.get("weight_class"),
        "total": _to_int(row.get("total")),
        "percentA": _to_float(row.get("percent_a")),
        "gender": row.get("gender"),
        "ageCategory": row.get("age_category"),
    }


def transform_lifting_result(row: dict) -> dict:
    return {
        "legacyId": _to_int(row.get("id")),
        "eventId": row["event_id"],
        "meet": row["meet"],
        "date": row["date"],
        "name": row["name"],
        "age": row.get("age"),
        "bodyWeight": _to_float(row.get("body_weight")),
        "snatch1": _to_float(row.get("snatch1")),
        "snatch2": _to_float(row.get("snatch2")),
        "snatch3": _to_float(row.get("snatch3")),
        "snatchBest": _to_float(row.get("snatch_best")),
        "cj1": _to_float(row.get("cj1")),
        "cj2": _to_float(row.get("cj2")),
        "cj3": _to_float(row.get("cj3")),
        "cjBest": _to_float(row.get("cj_best")),
        "total": _to_float(row.get("total")),
        "adaptive": bool(row.get("adaptive", False)),
        "federation": row.get("federation"),
    }


def transform_meet(row: dict) -> dict:
    return {
        "name": row["name"],
        "venueName": row["venue_name"],
        "venueStreet": row["venue_street"],
        "venueCity": row["venue_city"],
        "venueState": row["venue_state"],
        "venueZip": row["venue_zip"],
        "timeZone": row["time_zone"],
        "startDate": str(row["start_date"]),
        "endDate": str(row["end_date"]),
        "status": row.get("status", "upcoming"),
        "federation": row.get("federation"),
    }


def transform_qualifying_total(row: dict) -> dict:
    return {
        "eventName": row["event_name"],
        "gender": row["gender"],
        "ageCategory": row["age_category"],
        "weightClass": row["weight_class"],
        "qualifyingTotal": int(row["qualifying_total"]),
    }


def transform_record(row: dict) -> dict:
    return {
        "recordType": row["record_type"],
        "ageCategory": row["age_category"],
        "gender": row["gender"],
        "weightClass": row["weight_class"],
        "snatchRecord": _to_float(row.get("snatch_record")),
        "cjRecord": _to_float(row.get("cj_record")),
        "totalRecord": _to_float(row.get("total_record")),
    }


def transform_saved_session(row: dict) -> dict:
    return {
        "sessionId": row["id"],
        "userId": row["user_id"],
        "meet": row["meet"],
        "sessionNumber": int(row["session_number"]),
        "platform": row["platform"],
        "weightClass": row.get("weight_class"),
        "startTime": row.get("start_time"),
        "notes": row.get("notes"),
        "athleteNames": row.get("athlete_names"),  # Already a list in Supabase
        "date": str(row["date"]) if row.get("date") else None,
    }


def transform_session_schedule(row: dict) -> dict:
    return {
        "date": str(row["date"]),
        "sessionId": int(row["session_id"]),
        "startTime": str(row["start_time"]),
        "weighInTime": str(row["weigh_in_time"]),
        "platform": row["platform"],
        "weightClass": row["weight_class"],
        "meet": row["meet"],
    }


def transform_standard(row: dict) -> dict:
    return {
        "ageCategory": row["age_category"],
        "gender": row["gender"],
        "weightClass": row["weight_class"],
        "standardA": int(row["standard_a"]),
        "standardB": int(row.get("standard_b", 0)),
    }


def transform_world_record(row: dict) -> dict:
    return {
        "gender": row["gender"],
        "ageCategory": row["age_category"],
        "weightClass": row["weight_class"],
        "snatchRecord": _to_float(row.get("snatch_record")),
        "cjRecord": _to_float(row.get("cj_record")),
        "totalRecord": _to_float(row.get("total_record")),
    }


def transform_wso_record(row: dict) -> dict:
    return {
        "wso": row["wso"],
        "ageCategory": row["age_category"],
        "gender": row["gender"],
        "weightClass": row["weight_class"],
        "snatchRecord": _to_float(row.get("snatch_record")),
        "cjRecord": _to_float(row.get("cj_record")),
        "totalRecord": _to_float(row.get("total_record")),
    }


# Dispatch table
TRANSFORMERS = {
    "athletes": transform_athlete,
    "intl_rankings": transform_intl_ranking,
    "lifting_results": transform_lifting_result,
    "meets": transform_meet,
    "qualifying_totals": transform_qualifying_total,
    "records": transform_record,
    "saved_sessions": transform_saved_session,
    "session_schedule": transform_session_schedule,
    "standards": transform_standard,
    "world_records": transform_world_record,
    "wso_records": transform_wso_record,
}


def transform_row(table: str, row: dict) -> dict:
    """Transform a single Supabase row to a Convex-ready dict."""
    transformer = TRANSFORMERS.get(table)
    if not transformer:
        raise ValueError(f"No transformer found for table: {table}")
    result = transformer(row)
    # Remove None values for optional fields so Convex doesn't reject them
    return {k: v for k, v in result.items() if v is not None or k in _required_fields(table)}


def _required_fields(table: str) -> set:
    """Fields that must be present even if None (not filtered out)."""
    return {
        "lifting_results": {"adaptive"},
        "athletes": {"adaptive"},
        "meets": {"status"},
    }.get(table, set())
