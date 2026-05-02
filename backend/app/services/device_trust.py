from datetime import datetime, timedelta, timezone

from app.config.emergency_zone import get_emergency_zone
from app.services.duplicate_detection import similar_nearby_reports
from app.services.location_checks import inside_emergency_zone


DEFAULT_TRUST_SCORE = 70


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def trust_label(score: int) -> str:
    if score >= 75:
        return "Trusted Source"
    if score < 40:
        return "Low Trust Source"
    return "Normal Source"


def suspicious_reasons(report: dict, reports: list[dict]) -> list[str]:
    created_at = parse_time(report["timestamp"])
    device_reports = [item for item in reports if item["device_id"] == report["device_id"]]
    recent_2m = [item for item in device_reports if abs((created_at - parse_time(item["timestamp"])).total_seconds()) <= 120]
    recent_5m_critical = [
        item
        for item in device_reports
        if item["urgency"] == "Critical" and abs((created_at - parse_time(item["timestamp"])).total_seconds()) <= 300
    ]
    outside_zone_count = sum(1 for item in device_reports if not inside_emergency_zone(item, get_emergency_zone()))
    duplicate_like_count = len(similar_nearby_reports(report, device_reports))
    reasons = []

    if len(recent_2m) > 5:
        reasons.append("Device submitted too many reports too quickly.")
    if len(recent_5m_critical) > 3:
        reasons.append("Device submitted many critical reports in a short time.")
    if outside_zone_count >= 3:
        reasons.append("Device submitted many reports outside the emergency area.")
    if duplicate_like_count >= 3:
        reasons.append("Device repeatedly submitted nearly identical reports.")

    return reasons


def adjusted_trust_score(base_score: int, report: dict, reports: list[dict]) -> int:
    score = base_score
    reasons = suspicious_reasons(report, reports)
    if "Device submitted too many reports too quickly." in reasons:
        score -= 15
    if "Device submitted many critical reports in a short time." in reasons:
        score -= 20
    if "Device submitted many reports outside the emergency area." in reasons:
        score -= 10
    if "Device repeatedly submitted nearly identical reports." in reasons:
        score -= 10
    return max(0, min(100, score))
