from __future__ import annotations

import os

import httpx

from app.services.location_checks import get_known_locations


NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search"


def _known_location_suggestions(query: str, limit: int) -> list[dict]:
    normalized_query = query.strip().lower()
    if not normalized_query:
        return []

    suggestions: list[dict] = []
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
                },
                headers={"User-Agent": "RescueMesh/0.1 emergency-reporting-demo"},
            )
        response.raise_for_status()
        remote_matches = [
            {
                "name": item.get("name") or item.get("display_name", "Selected location").split(",")[0],
                "address": item.get("display_name", ""),
                "latitude": float(item["lat"]),
                "longitude": float(item["lon"]),
                "source": "openstreetmap",
            }
            for item in response.json()
            if item.get("lat") and item.get("lon")
        ]
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        remote_matches = []

    return [*local_matches, *remote_matches][:safe_limit]
