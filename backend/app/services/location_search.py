from __future__ import annotations

import os

import httpx

from app.services.location_checks import get_known_locations


NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search"
USA_BOUNDS = {
    "minLatitude": 24.396308,
    "maxLatitude": 49.384358,
    "minLongitude": -124.848974,
    "maxLongitude": -66.885444,
}
LOCAL_PLACE_ALIASES = [
    {
        "name": "University of South Florida",
        "address": "University of South Florida, 4202 East Fowler Avenue, Tampa, FL 33620",
        "latitude": 28.0599999,
        "longitude": -82.4138362,
        "source": "known-location",
        "keywords": ["usf", "university of south florida", "usf tampa", "south florida university"],
    }
]


def _inside_usa_bounds(latitude: float, longitude: float) -> bool:
    return (
        USA_BOUNDS["minLatitude"] <= latitude <= USA_BOUNDS["maxLatitude"]
        and USA_BOUNDS["minLongitude"] <= longitude <= USA_BOUNDS["maxLongitude"]
    )


def _known_location_suggestions(query: str, limit: int) -> list[dict]:
    normalized_query = query.strip().lower()
    if not normalized_query:
        return []

    suggestions: list[dict] = []
    for place in LOCAL_PLACE_ALIASES:
        haystack = f"{place['name']} {place['address']} {' '.join(place['keywords'])}".lower()
        if normalized_query in haystack:
            suggestions.append(
                {
                    "name": place["name"],
                    "address": place["address"],
                    "latitude": place["latitude"],
                    "longitude": place["longitude"],
                    "source": place["source"],
                }
            )
        if len(suggestions) >= limit:
            return suggestions

    for location in get_known_locations():
        haystack = f"{location['name']} {location.get('category', '')}".lower()
        if normalized_query in haystack:
            suggestions.append(
                {
                    "name": location["name"],
                    "address": location.get("address") or f"{location.get('category', 'Known')} known location",
                    "latitude": location["latitude"],
                    "longitude": location["longitude"],
                    "source": "known-location",
                }
            )
        if len(suggestions) >= limit:
            break
    return suggestions


async def geocode_location(query: str, limit: int = 5) -> list[dict]:
    safe_limit = max(1, min(limit, 8))
    local_matches = _known_location_suggestions(query, safe_limit)
    if len(local_matches) >= safe_limit:
        return local_matches

    if os.getenv("RESCUEMESH_DISABLE_REMOTE_GEOCODING", "").lower() in {"1", "true", "yes"}:
        return local_matches

    try:
        async with httpx.AsyncClient(timeout=4) as client:
            response = await client.get(
                NOMINATIM_ENDPOINT,
                params={
                    "q": query,
                    "format": "jsonv2",
                    "limit": safe_limit - len(local_matches),
                    "addressdetails": 1,
                    "countrycodes": "us",
                },
                headers={"User-Agent": "RescueMesh/0.1 emergency-reporting-demo"},
            )
        response.raise_for_status()
        remote_matches = []
        for item in response.json():
            if not item.get("lat") or not item.get("lon"):
                continue
            latitude = float(item["lat"])
            longitude = float(item["lon"])
            if not _inside_usa_bounds(latitude, longitude):
                continue
            remote_matches.append(
                {
                    "name": item.get("name") or item.get("display_name", "Selected location").split(",")[0],
                    "address": item.get("display_name", ""),
                    "latitude": latitude,
                    "longitude": longitude,
                    "source": "openstreetmap",
                }
            )
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        remote_matches = []

    return [*local_matches, *remote_matches][:safe_limit]
