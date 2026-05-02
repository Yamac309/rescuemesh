import json
import math
from functools import lru_cache
from pathlib import Path

from app.config.emergency_zone import get_emergency_zone


KNOWN_LOCATION_RADIUS_METERS = 180


def haversine_meters(a: dict, b: dict) -> float:
    radius = 6371000
    lat1 = math.radians(a["latitude"])
    lat2 = math.radians(b["latitude"])
    d_lat = math.radians(b["latitude"] - a["latitude"])
    d_lon = math.radians(b["longitude"] - a["longitude"])
    h = math.sin(d_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(d_lon / 2) ** 2
    return 2 * radius * math.atan2(math.sqrt(h), math.sqrt(1 - h))


def inside_emergency_zone(report: dict, zone: dict | None = None) -> bool:
    current_zone = zone or get_emergency_zone()
    return (
        current_zone["minLatitude"] <= report["latitude"] <= current_zone["maxLatitude"]
        and current_zone["minLongitude"] <= report["longitude"] <= current_zone["maxLongitude"]
    )


@lru_cache
def get_known_locations() -> list[dict]:
    path = Path(__file__).resolve().parents[1] / "data" / "known_locations.json"
    return json.loads(path.read_text())


def nearest_known_location(report: dict) -> dict | None:
    nearest = None
    nearest_distance = float("inf")
    for location in get_known_locations():
        distance = haversine_meters(report, location)
        if distance < nearest_distance:
            nearest = location
            nearest_distance = distance
    if nearest and nearest_distance <= KNOWN_LOCATION_RADIUS_METERS:
        return {**nearest, "distance_meters": nearest_distance}
    return None
