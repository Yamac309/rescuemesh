from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import os
from typing import Any

import httpx

try:
    from pymongo import MongoClient
    from pymongo.errors import PyMongoError
except ImportError:  # pragma: no cover - exercised when optional dependency is absent
    MongoClient = None

    class PyMongoError(Exception):
        pass


DEFAULT_ALERTS_URL = "https://api.weather.gov/alerts"
DEFAULT_USER_AGENT = "RescueMesh/0.1 live incident importer"
MAX_DAYS = 7
MAX_LIMIT = 200

_mongo_client: Any = None
_mongo_uri: str | None = None
_indexes_ready = False


class LiveIncidentStoreUnavailable(RuntimeError):
    pass


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def isoformat_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def clamp_days(days: int) -> int:
    return max(1, min(MAX_DAYS, int(days or MAX_DAYS)))


def clamp_limit(limit: int) -> int:
    return max(1, min(MAX_LIMIT, int(limit or MAX_LIMIT)))


def mongo_config() -> dict:
    return {
        "configured": bool(os.getenv("MONGODB_URI", "").strip()),
        "driver_installed": MongoClient is not None,
        "database": os.getenv("MONGODB_DATABASE", "rescuemesh"),
        "collection": os.getenv("MONGODB_LIVE_INCIDENTS_COLLECTION", "live_incidents"),
    }


def live_incident_status() -> dict:
    config = mongo_config()
    return {
        **config,
        "source": "National Weather Service alerts",
        "window_days": MAX_DAYS,
        "available": config["configured"] and config["driver_installed"],
    }


def _collection():
    global _mongo_client, _mongo_uri, _indexes_ready

    uri = os.getenv("MONGODB_URI", "").strip()
    if not uri:
        raise LiveIncidentStoreUnavailable("MongoDB Atlas connection string is not configured.")
    if MongoClient is None:
        raise LiveIncidentStoreUnavailable("PyMongo is not installed.")

    timeout_ms = int(os.getenv("MONGODB_TIMEOUT_MS", "2500"))
    if _mongo_client is None or _mongo_uri != uri:
        _mongo_client = MongoClient(
            uri,
            serverSelectionTimeoutMS=timeout_ms,
            connectTimeoutMS=timeout_ms,
            socketTimeoutMS=timeout_ms,
        )
        _mongo_uri = uri
        _indexes_ready = False

    database_name = os.getenv("MONGODB_DATABASE", "rescuemesh")
    collection_name = os.getenv("MONGODB_LIVE_INCIDENTS_COLLECTION", "live_incidents")
    collection = _mongo_client[database_name][collection_name]

    if not _indexes_ready:
        collection.create_index("incident_id", unique=True)
        collection.create_index("timestamp_dt")
        collection.create_index([("location", "2dsphere")])
        _indexes_ready = True

    return collection


def category_for_event(event: str) -> str:
    lowered = event.lower()
    if any(word in lowered for word in ["flood", "fire", "wildfire", "tornado", "hurricane", "earthquake", "storm", "heat", "wind"]):
        return "Dangerous Area"
    if any(word in lowered for word in ["road", "travel", "blizzard", "ice", "snow"]):
        return "Blocked Road"
    if any(word in lowered for word in ["shelter", "evacuation"]):
        return "Shelter"
    return "General Update"


def urgency_for_alert(properties: dict) -> str:
    severity = (properties.get("severity") or "").lower()
    urgency = (properties.get("urgency") or "").lower()
    certainty = (properties.get("certainty") or "").lower()

    if severity == "extreme" or (severity == "severe" and urgency == "immediate"):
        return "Critical"
    if severity == "severe" or urgency == "immediate":
        return "High"
    if severity == "moderate" or certainty in {"likely", "observed"}:
        return "Medium"
    return "Low"


def _flatten_coordinates(coordinates: Any) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    if not isinstance(coordinates, list):
        return points

    if len(coordinates) >= 2 and all(isinstance(value, (int, float)) for value in coordinates[:2]):
        longitude, latitude = float(coordinates[0]), float(coordinates[1])
        if -180 <= longitude <= 180 and -90 <= latitude <= 90:
            points.append((latitude, longitude))
        return points

    for item in coordinates:
        points.extend(_flatten_coordinates(item))
    return points


def centroid_from_geometry(geometry: dict | None) -> tuple[float, float] | None:
    if not geometry:
        return None
    points = _flatten_coordinates(geometry.get("coordinates"))
    if not points:
        return None

    min_lat = min(point[0] for point in points)
    max_lat = max(point[0] for point in points)
    min_lon = min(point[1] for point in points)
    max_lon = max(point[1] for point in points)
    return ((min_lat + max_lat) / 2, (min_lon + max_lon) / 2)


def short_description(properties: dict) -> str:
    description = (properties.get("description") or "").strip()
    instruction = (properties.get("instruction") or "").strip()
    text = description or instruction or "Official alert issued by the National Weather Service."
    compact = " ".join(text.split())
    return compact[:700]


def incident_id_for(properties: dict) -> str:
    source_id = properties.get("id") or properties.get("@id") or properties.get("event") or repr(properties)
    digest = hashlib.sha1(str(source_id).encode("utf-8")).hexdigest()[:18]
    return f"nws-{digest}"


def document_to_incident(document: dict) -> dict:
    timestamp = document.get("timestamp_dt")
    if isinstance(timestamp, datetime):
        timestamp_text = isoformat_z(timestamp)
    else:
        timestamp_text = document.get("timestamp") or isoformat_z(utc_now())

    return {
        "incident_id": document["incident_id"],
        "title": document.get("title", "Live incident"),
        "category": document.get("category", "General Update"),
        "description": document.get("description", ""),
        "urgency": document.get("urgency", "Low"),
        "location_name": document.get("location_name", ""),
        "location_address": document.get("location_address", ""),
        "latitude": document.get("latitude"),
        "longitude": document.get("longitude"),
        "status": document.get("status", "Confirmed"),
        "timestamp": timestamp_text,
        "source": document.get("source", "National Weather Service"),
        "source_url": document.get("source_url", ""),
        "event_type": document.get("event_type", ""),
        "expires_at": document.get("expires_at", ""),
    }


def feature_to_document(feature: dict, now: datetime) -> dict | None:
    properties = feature.get("properties") or {}
    centroid = centroid_from_geometry(feature.get("geometry"))
    if centroid is None:
        return None

    timestamp = (
        parse_datetime(properties.get("sent"))
        or parse_datetime(properties.get("effective"))
        or parse_datetime(properties.get("onset"))
        or now
    )
    if timestamp < now - timedelta(days=MAX_DAYS):
        return None

    latitude, longitude = centroid
    event = properties.get("event") or "Weather alert"
    area = properties.get("areaDesc") or "Impacted area"
    source_url = properties.get("@id") or properties.get("id") or ""

    return {
        "incident_id": incident_id_for(properties),
        "title": event,
        "category": category_for_event(event),
        "description": short_description(properties),
        "urgency": urgency_for_alert(properties),
        "location_name": area,
        "location_address": area,
        "latitude": latitude,
        "longitude": longitude,
        "location": {"type": "Point", "coordinates": [longitude, latitude]},
        "status": "Confirmed",
        "timestamp": isoformat_z(timestamp),
        "timestamp_dt": timestamp.replace(tzinfo=None),
        "source": "National Weather Service",
        "source_url": source_url,
        "event_type": event,
        "expires_at": properties.get("expires") or "",
        "updated_at": now.replace(tzinfo=None),
    }


async def fetch_nws_incidents(days: int = MAX_DAYS, limit: int = MAX_LIMIT) -> list[dict]:
    days = clamp_days(days)
    limit = clamp_limit(limit)
    now = utc_now()
    start = isoformat_z(now - timedelta(days=days))
    url = os.getenv("LIVE_INCIDENTS_NWS_ALERTS_URL", DEFAULT_ALERTS_URL)
    user_agent = os.getenv("LIVE_INCIDENTS_USER_AGENT", DEFAULT_USER_AGENT)

    async with httpx.AsyncClient(timeout=8) as client:
        response = await client.get(
            url,
            params={
                "status": "actual",
                "message_type": "alert,update",
                "start": start,
                "limit": str(limit),
            },
            headers={
                "Accept": "application/geo+json",
                "User-Agent": user_agent,
            },
        )
        response.raise_for_status()

    features = response.json().get("features", [])
    documents = [feature_to_document(feature, now) for feature in features]
    return [document for document in documents if document is not None]


def list_live_incidents(days: int = MAX_DAYS, limit: int = MAX_LIMIT) -> list[dict]:
    days = clamp_days(days)
    limit = clamp_limit(limit)
    since = (utc_now() - timedelta(days=days)).replace(tzinfo=None)

    try:
        collection = _collection()
        cursor = (
            collection.find({"timestamp_dt": {"$gte": since}}, {"_id": False})
            .sort("timestamp_dt", -1)
            .limit(limit)
        )
    except PyMongoError as error:
        raise LiveIncidentStoreUnavailable("MongoDB live incident store is unavailable.") from error
    return [document_to_incident(document) for document in cursor]


async def refresh_live_incidents(days: int = MAX_DAYS, limit: int = MAX_LIMIT) -> dict:
    try:
        collection = _collection()
    except PyMongoError as error:
        raise LiveIncidentStoreUnavailable("MongoDB live incident store is unavailable.") from error

    documents = await fetch_nws_incidents(days, limit)

    imported_count = 0
    for document in documents:
        result = collection.update_one(
            {"incident_id": document["incident_id"]},
            {"$set": document},
            upsert=True,
        )
        if result.upserted_id is not None or result.modified_count:
            imported_count += 1

    return {
        "imported_count": imported_count,
        "stored_count": collection.count_documents({}),
        "incidents": list_live_incidents(days, limit),
        "status": live_incident_status(),
    }
