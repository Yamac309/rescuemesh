from datetime import datetime, timezone

from app.config.emergency_zone import get_emergency_zone
from app.services.device_trust import adjusted_trust_score, suspicious_reasons
from app.services.duplicate_detection import similar_nearby_reports
from app.services.location_checks import inside_emergency_zone, nearest_known_location


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def aging_label(report: dict) -> str:
    age_hours = max(0, (datetime.now(timezone.utc) - parse_time(report["timestamp"])).total_seconds() / 3600)
    if age_hours < 1:
        return "Fresh"
    if age_hours < 6:
        return "Recent"
    if age_hours < 24:
        return "Aging"
    return "Stale"


def verification_label(score: int, responder_rejected: bool) -> str:
    if responder_rejected:
        return "Low Trust"
    if score < 30:
        return "Low Trust"
    if score < 60:
        return "Unverified"
    if score < 80:
        return "Likely Verified"
    return "Verified"


def evaluate_report(report: dict, reports: list[dict], device_trust_score: int, node_id: str) -> dict:
    enriched_reports = [{**item, "_timestamp_dt": parse_time(item["timestamp"])} for item in reports]
    current = {**report, "_timestamp_dt": parse_time(report["timestamp"])}
    similar_reports = similar_nearby_reports(current, enriched_reports)
    known_location = nearest_known_location(report)
    inside_zone = inside_emergency_zone(report, get_emergency_zone())
    age = aging_label(report)
    confirmation_count = report.get("unique_confirmation_count", report.get("confirmation_count", 0)) or 0
    seen_by_nodes = sorted(set([*(report.get("seen_by_nodes") or []), node_id]))
    responder_verified = bool(report.get("responder_verified"))
    responder_rejected = bool(report.get("responder_rejected"))
    photo_evidence = bool(report.get("photo_evidence_attached"))
    adjusted_trust = adjusted_trust_score(device_trust_score, report, reports)
    suspicious = adjusted_trust < device_trust_score or bool(suspicious_reasons(report, reports))

    score = 30
    evidence = []
    warnings = []

    if inside_zone:
        score += 10
        evidence.append("Report is inside the configured emergency area.")
    else:
        score -= 30
        warnings.append("Report is outside the configured emergency area.")

    if age == "Fresh":
        score += 10
        evidence.append("Report is less than 1 hour old.")
    elif age == "Aging":
        score -= 20
        warnings.append("This report is aging. Verify before relying on it.")
    elif age == "Stale":
        score -= 35
        warnings.append("This report is old. Verify before relying on it.")

    if known_location:
        score += 10
        evidence.append(f"Report is near known location: {known_location['name']}.")

    if similar_reports:
        score += 15
        evidence.append("Similar nearby reports were found.")

    if confirmation_count:
        score += min(confirmation_count, 3) * 10
        evidence.append(f"{confirmation_count} unique confirmations.")

    if responder_verified:
        score += 30
        evidence.append("Responder verified this report.")
    else:
        warnings.append("No responder verification yet.")

    if responder_rejected:
        score -= 40
        warnings.append("Responder rejected this report.")

    if photo_evidence:
        score += 10
        evidence.append("Photo evidence attached.")

    if len(seen_by_nodes) >= 2:
        score += 10
        evidence.append("Report has been seen by multiple nodes.")

    suspicious_reasons_list = suspicious_reasons(report, reports)
    if suspicious:
        score -= 30
        warnings.extend(suspicious_reasons_list or ["Suspicious device activity detected."])

    if adjusted_trust < 40:
        score -= 25
        warnings.append("Device trust score is below 40.")

    score = max(0, min(100, score))
    label = verification_label(score, responder_rejected)
    status = report["status"]
    if status != "Resolved":
        if suspicious or score < 30:
            status = "Needs Review"
        elif confirmation_count >= 2 or score >= 80:
            status = "Confirmed"

    return {
        "confidence_score": score,
        "verification_label": label,
        "evidence_reasons": evidence,
        "warning_reasons": warnings,
        "aging_label": age,
        "status": status,
        "seen_by_nodes": seen_by_nodes,
        "verification_signals": {
            "insideEmergencyZone": inside_zone,
            "nearKnownLocation": known_location is not None,
            "knownLocationName": known_location["name"] if known_location else None,
            "isFresh": age == "Fresh",
            "isStale": age == "Stale",
            "hasSimilarNearbyReports": bool(similar_reports),
            "similarReportCount": len(similar_reports),
            "uniqueConfirmationCount": confirmation_count,
            "responderVerified": responder_verified,
            "responderRejected": responder_rejected,
            "deviceTrustScore": adjusted_trust,
            "suspiciousDeviceActivity": suspicious,
            "photoEvidenceAttached": photo_evidence,
            "seenByNodeCount": len(seen_by_nodes),
        },
    }
