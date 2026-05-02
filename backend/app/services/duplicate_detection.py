from app.services.location_checks import haversine_meters


SIMILAR_DISTANCE_METERS = 250
SIMILAR_WINDOW_SECONDS = 6 * 60 * 60


def keyword_set(text: str) -> set[str]:
    cleaned = "".join(char.lower() if char.isalnum() else " " for char in text)
    return {word for word in cleaned.split() if len(word) > 2}


def similar_nearby_reports(report: dict, reports: list[dict]) -> list[dict]:
    report_words = keyword_set(f"{report.get('title', '')} {report.get('description', '')}")
    report_time = report.get("_timestamp_dt")
    matches = []

    for candidate in reports:
        if candidate["report_id"] == report["report_id"]:
            continue
        if candidate["category"] != report["category"]:
            continue
        candidate_words = keyword_set(f"{candidate.get('title', '')} {candidate.get('description', '')}")
        if not report_words.intersection(candidate_words):
            continue
        if haversine_meters(report, candidate) > SIMILAR_DISTANCE_METERS:
            continue
        candidate_time = candidate.get("_timestamp_dt")
        if report_time and candidate_time and abs((report_time - candidate_time).total_seconds()) > SIMILAR_WINDOW_SECONDS:
            continue
        matches.append(candidate)

    return matches
