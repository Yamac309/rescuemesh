from collections import defaultdict, deque
from datetime import datetime, timezone
import hmac
import os
from pathlib import Path
import time

from fastapi import Depends, Header, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

from . import database
from .config.emergency_zone import get_emergency_zone, get_node_id
from .services.incident_guidance import generate_incident_guidance
from .services.live_incidents import (
    LiveIncidentStoreUnavailable,
    list_live_incidents,
    live_incident_status,
    refresh_live_incidents,
)
from .services.location_checks import get_known_locations
from .services.location_search import geocode_location
from .schemas import (
    ConfirmRequest,
    Comment,
    CommentCreate,
    DeleteDemoReportsRequest,
    IncidentGuidanceRequest,
    IncidentGuidanceResponse,
    LiveIncident,
    LiveIncidentRefreshResponse,
    LiveIncidentStatus,
    LocationSuggestion,
    NodeStatus,
    Report,
    ReportCreate,
    ResponderNoteRequest,
    SyncRequest,
    SyncResponse,
)

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

app = FastAPI(title="RescueMesh Node", version="0.1.0")
RATE_LIMITS: dict[tuple[str, str], deque[float]] = defaultdict(deque)
DEFAULT_CORS_ORIGIN_REGEX = (
    r"https?://(localhost|127\.0\.0\.1|"
    r"192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?"
)

DEMO_REPORT_TITLES = [
    "Water available at library",
    "Road blocked near main entrance",
    "First aid station at gym",
    "Charging station open at student center",
    "Dangerous flooding near parking lot",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("RESCUEMESH_CORS_ORIGINS", "").split(",") if origin.strip()],
    allow_origin_regex=os.getenv("RESCUEMESH_CORS_ORIGIN_REGEX", DEFAULT_CORS_ORIGIN_REGEX),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict) -> None:
        dead_connections: list[WebSocket] = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except RuntimeError:
                dead_connections.append(connection)
        for connection in dead_connections:
            self.disconnect(connection)

    @property
    def connected_count(self) -> int:
        return len(self.active_connections)


manager = ConnectionManager()
FRONTEND_DIST_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist"
FRONTEND_INDEX = FRONTEND_DIST_DIR / "index.html"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def public_mode_enabled() -> bool:
    return os.getenv("RESCUEMESH_PUBLIC_MODE", "").lower() in {"1", "true", "yes"}


def token_matches(expected: str | None, provided: str | None) -> bool:
    return bool(expected and provided and hmac.compare_digest(expected, provided))


def require_admin_token(x_admin_token: str | None = Header(default=None)) -> None:
    admin_token = os.getenv("RESCUEMESH_ADMIN_TOKEN")

    if not public_mode_enabled() and not admin_token:
        return
    if token_matches(admin_token, x_admin_token):
        return

    raise HTTPException(status_code=403, detail="Admin token required")


def require_responder_token(
    x_responder_token: str | None = Header(default=None),
    x_admin_token: str | None = Header(default=None),
) -> None:
    responder_token = os.getenv("RESCUEMESH_RESPONDER_TOKEN")
    admin_token = os.getenv("RESCUEMESH_ADMIN_TOKEN")

    if not public_mode_enabled() and not responder_token and not admin_token:
        return
    if token_matches(responder_token, x_responder_token) or token_matches(admin_token, x_admin_token):
        return

    raise HTTPException(status_code=403, detail="Responder token required")


def client_key_from_request(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def check_rate_limit(client_key: str, bucket: str, limit: int, window_seconds: int) -> None:
    if os.getenv("RESCUEMESH_DISABLE_RATE_LIMITING", "").lower() in {"1", "true", "yes"}:
        return
    now = time.monotonic()
    events = RATE_LIMITS[(bucket, client_key)]
    while events and now - events[0] > window_seconds:
        events.popleft()
    if len(events) >= limit:
        raise HTTPException(status_code=429, detail="Too many requests. Please slow down.")
    events.append(now)


def rate_limiter(bucket: str, limit: int, window_seconds: int):
    async def dependency(request: Request) -> None:
        check_rate_limit(client_key_from_request(request), bucket, limit, window_seconds)

    return dependency


def https_required() -> bool:
    return os.getenv("RESCUEMESH_REQUIRE_HTTPS", "").lower() in {"1", "true", "yes"}


def request_is_https(request: Request) -> bool:
    return request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").split(",")[0].strip() == "https"


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    if https_required() and not request_is_https(request):
        return JSONResponse(status_code=403, content={"detail": "HTTPS is required"})

    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Permissions-Policy", "geolocation=(self), camera=(), microphone=()")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; "
        "script-src 'self' https://cdn.apple-mapkit.com; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data: blob: https://server.arcgisonline.com https://*.arcgisonline.com https://*.tile.openstreetmap.org; "
        "connect-src 'self' http: https: ws: wss:; "
        "base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    )
    if request_is_https(request):
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


@app.on_event("startup")
def on_startup() -> None:
    database.init_db()


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "RescueMesh Node"}


@app.get("/reports", response_model=list[Report])
def list_reports() -> list[dict]:
    return database.get_all_reports()


@app.get("/reports/needs-review", response_model=list[Report])
def needs_review_reports() -> list[dict]:
    return database.get_needs_review_reports()


@app.post("/reports", response_model=Report, status_code=201, dependencies=[Depends(rate_limiter("create_report", 30, 60))])
async def create_report(report: ReportCreate) -> dict:
    inserted, saved_report = database.insert_report(report)
    if inserted:
        await manager.broadcast({"type": "report:new", "report": saved_report})
    return saved_report


@app.post("/sync", response_model=SyncResponse, dependencies=[Depends(rate_limiter("sync", 120, 60))])
async def sync_reports(payload: SyncRequest) -> dict:
    accepted_reports: list[dict] = []
    duplicate_report_ids: list[str] = []

    for report in payload.reports:
        inserted, saved_report = database.insert_report(report)
        if inserted and saved_report:
            accepted_reports.append(saved_report)
        else:
            duplicate_report_ids.append(report.report_id)

    missing_reports = database.get_reports_missing_from_client(payload.known_report_ids)
    deleted_report_ids = database.get_deleted_report_ids(payload.known_report_ids)
    database.set_meta("last_sync_time", utc_now())

    for report in accepted_reports:
        await manager.broadcast({"type": "report:new", "report": report})

    return {
        "missing_reports": missing_reports,
        "accepted_reports": accepted_reports,
        "duplicate_report_ids": duplicate_report_ids,
        "deleted_report_ids": deleted_report_ids,
        "backend_report_ids": database.get_report_ids(),
        "total_reports": database.total_reports(),
    }


@app.post("/reports/{report_id}/confirm", response_model=Report, dependencies=[Depends(rate_limiter("confirm", 80, 60))])
async def confirm_report(report_id: str, payload: ConfirmRequest) -> dict:
    report = database.confirm_report(report_id, payload.device_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    await manager.broadcast({"type": "report:updated", "report": report})
    return report


@app.get("/reports/{report_id}/comments", response_model=list[Comment])
def list_report_comments(report_id: str) -> list[dict]:
    if database.get_report(report_id) is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return database.get_comments(report_id)


@app.post("/reports/{report_id}/comments", response_model=Comment, status_code=201, dependencies=[Depends(rate_limiter("comment", 30, 60))])
async def create_report_comment(report_id: str, payload: CommentCreate) -> dict:
    if payload.report_id != report_id:
        raise HTTPException(status_code=400, detail="Comment report_id must match URL report_id")
    inserted, comment = database.insert_comment(payload)
    if comment is None:
        raise HTTPException(status_code=404, detail="Report not found")
    if inserted:
        await manager.broadcast({"type": "comment:new", "comment": comment})
    return comment


@app.post("/reports/{report_id}/resolve", response_model=Report, dependencies=[Depends(rate_limiter("resolve", 60, 60))])
async def resolve_report(report_id: str) -> dict:
    report = database.resolve_report(report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    await manager.broadcast({"type": "report:updated", "report": report})
    return report


@app.post(
    "/reports/{report_id}/responder-verify",
    response_model=Report,
    dependencies=[Depends(require_responder_token), Depends(rate_limiter("responder", 80, 60))],
)
async def responder_verify_report(report_id: str) -> dict:
    report = database.responder_verify(report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    await manager.broadcast({"type": "report:updated", "report": report})
    return report


@app.post(
    "/reports/{report_id}/responder-reject",
    response_model=Report,
    dependencies=[Depends(require_responder_token), Depends(rate_limiter("responder", 80, 60))],
)
async def responder_reject_report(report_id: str) -> dict:
    report = database.responder_reject(report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    await manager.broadcast({"type": "report:updated", "report": report})
    return report


@app.post(
    "/reports/{report_id}/responder-note",
    response_model=Report,
    dependencies=[Depends(require_responder_token), Depends(rate_limiter("responder", 80, 60))],
)
async def add_responder_note(report_id: str, payload: ResponderNoteRequest) -> dict:
    report = database.responder_note(report_id, payload.note)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    await manager.broadcast({"type": "report:updated", "report": report})
    return report


@app.delete("/demo/reports", dependencies=[Depends(require_admin_token), Depends(rate_limiter("delete", 20, 60))])
async def delete_demo_reports(payload: DeleteDemoReportsRequest | None = None) -> dict:
    requested_report_ids = payload.report_ids if payload else []
    if requested_report_ids:
        database.remember_deleted_report_ids(requested_report_ids)
    deleted_report_ids = database.delete_demo_reports()
    if not deleted_report_ids:
        deleted_report_ids = database.delete_reports_by_titles(DEMO_REPORT_TITLES)
    all_deleted_report_ids = sorted(set([*requested_report_ids, *deleted_report_ids]))
    if all_deleted_report_ids:
        await manager.broadcast({"type": "reports:deleted", "report_ids": all_deleted_report_ids})
    return {"deleted_report_ids": all_deleted_report_ids, "deleted_count": len(all_deleted_report_ids)}


@app.delete("/reports", dependencies=[Depends(require_admin_token), Depends(rate_limiter("delete", 20, 60))])
async def delete_all_reports() -> dict:
    deleted_report_ids = database.delete_all_reports()
    if deleted_report_ids:
        await manager.broadcast({"type": "reports:deleted", "report_ids": deleted_report_ids})
    return {"deleted_report_ids": deleted_report_ids, "deleted_count": len(deleted_report_ids)}


@app.get("/node/status", response_model=NodeStatus)
def node_status() -> dict:
    return {
        "node_name": os.getenv("RESCUEMESH_NODE_NAME", "RescueMesh Local Node"),
        "connected_clients": manager.connected_count,
        "total_reports": database.total_reports(),
        "last_sync_time": database.get_meta("last_sync_time"),
        "backend_health": "ok",
    }


@app.get("/security/config")
def security_config() -> dict:
    return {
        "publicMode": public_mode_enabled(),
        "adminTokenRequired": public_mode_enabled() or bool(os.getenv("RESCUEMESH_ADMIN_TOKEN")),
        "responderTokenRequired": public_mode_enabled()
        or bool(os.getenv("RESCUEMESH_RESPONDER_TOKEN"))
        or bool(os.getenv("RESCUEMESH_ADMIN_TOKEN")),
        "rateLimitingEnabled": os.getenv("RESCUEMESH_DISABLE_RATE_LIMITING", "").lower() not in {"1", "true", "yes"},
        "httpsRequired": https_required(),
        "corsRestricted": True,
    }


@app.get("/verification/config")
def verification_config() -> dict:
    return {
        "nodeId": get_node_id(),
        "emergencyZone": get_emergency_zone(),
        "knownLocations": get_known_locations(),
        "scoring": {
            "baseScore": 30,
            "confirmationMax": 30,
            "similarNearbyRadiusMeters": 250,
            "similarNearbyWindowHours": 6,
        },
    }


@app.get("/geocode", response_model=list[LocationSuggestion], dependencies=[Depends(rate_limiter("geocode", 60, 60))])
async def geocode(query: str, limit: int = 5) -> list[dict]:
    cleaned_query = query.strip()
    if len(cleaned_query) < 2:
        return []
    return await geocode_location(cleaned_query, limit)


@app.get("/live-incidents/status", response_model=LiveIncidentStatus)
def get_live_incident_status() -> dict:
    return live_incident_status()


@app.get("/live-incidents", response_model=list[LiveIncident])
def get_live_incidents(days: int = 7, limit: int = 200) -> list[dict]:
    try:
        return list_live_incidents(days=days, limit=limit)
    except LiveIncidentStoreUnavailable:
        return []


@app.post("/live-incidents/refresh", response_model=LiveIncidentRefreshResponse)
async def refresh_live_incident_feed(days: int = 7, limit: int = 200) -> dict:
    try:
        return await refresh_live_incidents(days=days, limit=limit)
    except LiveIncidentStoreUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.get("/ai/status")
def ai_status() -> dict:
    return {
        "googleAiConfigured": bool(os.getenv("GOOGLE_AI_API_KEY")),
        "model": os.getenv("GOOGLE_AI_MODEL", "gemini-2.5-flash-lite"),
    }


@app.post("/ai/incident-guidance", response_model=IncidentGuidanceResponse, dependencies=[Depends(rate_limiter("ai", 30, 60))])
async def incident_guidance(payload: IncidentGuidanceRequest) -> dict:
    return await generate_incident_guidance(payload)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    client_host = websocket.headers.get("x-forwarded-for", "").split(",")[0].strip() or (websocket.client.host if websocket.client else "unknown")
    if https_required() and websocket.url.scheme != "wss" and websocket.headers.get("x-forwarded-proto", "").split(",")[0].strip() != "https":
        await websocket.close(code=1008)
        return
    try:
        check_rate_limit(client_host, "websocket", 30, 60)
    except HTTPException:
        await websocket.close(code=1013)
        return
    await manager.connect(websocket)
    try:
        await websocket.send_json({"type": "node:hello", "message": "Connected to RescueMesh Node"})
        while True:
            # Keep the socket open. Later mesh transports can feed node-to-node messages here.
            # TODO: Bridge Bluetooth, Wi-Fi Direct, Raspberry Pi, or LoRa node events into this stream.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket)


if FRONTEND_DIST_DIR.exists():
    assets_dir = FRONTEND_DIST_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="frontend-assets")

    @app.get("/", include_in_schema=False)
    def serve_frontend_index() -> FileResponse:
        return FileResponse(FRONTEND_INDEX)

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_frontend_app(full_path: str) -> FileResponse:
        requested_path = FRONTEND_DIST_DIR / full_path
        if requested_path.is_file():
            return FileResponse(requested_path)
        return FileResponse(FRONTEND_INDEX)
