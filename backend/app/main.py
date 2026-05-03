from datetime import datetime, timezone
import os
from pathlib import Path

from fastapi import Depends, Header, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

from . import database
from .config.emergency_zone import get_emergency_zone, get_node_id
from .services.incident_guidance import generate_incident_guidance
from .services.location_checks import get_known_locations
from .services.location_search import geocode_location
from .schemas import (
    ConfirmRequest,
    Comment,
    CommentCreate,
    DeleteDemoReportsRequest,
    IncidentGuidanceRequest,
    IncidentGuidanceResponse,
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

DEMO_REPORT_TITLES = [
    "Water available at library",
    "Road blocked near main entrance",
    "First aid station at gym",
    "Charging station open at student center",
    "Dangerous flooding near parking lot",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("RESCUEMESH_CORS_ORIGINS", "*").split(","),
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


def require_admin_token(x_admin_token: str | None = Header(default=None)) -> None:
    admin_token = os.getenv("RESCUEMESH_ADMIN_TOKEN")
    public_mode = os.getenv("RESCUEMESH_PUBLIC_MODE", "").lower() in {"1", "true", "yes"}

    if not public_mode and not admin_token:
        return
    if admin_token and x_admin_token == admin_token:
        return

    raise HTTPException(status_code=403, detail="Admin token required")


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


@app.post("/reports", response_model=Report, status_code=201)
async def create_report(report: ReportCreate) -> dict:
    inserted, saved_report = database.insert_report(report)
    if inserted:
        await manager.broadcast({"type": "report:new", "report": saved_report})
    return saved_report


@app.post("/sync", response_model=SyncResponse)
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


@app.post("/reports/{report_id}/confirm", response_model=Report)
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


@app.post("/reports/{report_id}/comments", response_model=Comment, status_code=201)
async def create_report_comment(report_id: str, payload: CommentCreate) -> dict:
    if payload.report_id != report_id:
        raise HTTPException(status_code=400, detail="Comment report_id must match URL report_id")
    inserted, comment = database.insert_comment(payload)
    if comment is None:
        raise HTTPException(status_code=404, detail="Report not found")
    if inserted:
        await manager.broadcast({"type": "comment:new", "comment": comment})
    return comment


@app.post("/reports/{report_id}/resolve", response_model=Report)
async def resolve_report(report_id: str) -> dict:
    report = database.resolve_report(report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    await manager.broadcast({"type": "report:updated", "report": report})
    return report


@app.post("/reports/{report_id}/responder-verify", response_model=Report)
async def responder_verify_report(report_id: str) -> dict:
    report = database.responder_verify(report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    await manager.broadcast({"type": "report:updated", "report": report})
    return report


@app.post("/reports/{report_id}/responder-reject", response_model=Report)
async def responder_reject_report(report_id: str) -> dict:
    report = database.responder_reject(report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    await manager.broadcast({"type": "report:updated", "report": report})
    return report


@app.post("/reports/{report_id}/responder-note", response_model=Report)
async def add_responder_note(report_id: str, payload: ResponderNoteRequest) -> dict:
    report = database.responder_note(report_id, payload.note)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    await manager.broadcast({"type": "report:updated", "report": report})
    return report


@app.delete("/demo/reports", dependencies=[Depends(require_admin_token)])
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


@app.delete("/reports", dependencies=[Depends(require_admin_token)])
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


@app.get("/geocode", response_model=list[LocationSuggestion])
async def geocode(query: str, limit: int = 5) -> list[dict]:
    cleaned_query = query.strip()
    if len(cleaned_query) < 2:
        return []
    return await geocode_location(cleaned_query, limit)


@app.get("/ai/status")
def ai_status() -> dict:
    return {
        "googleAiConfigured": bool(os.getenv("GOOGLE_AI_API_KEY")),
        "model": os.getenv("GOOGLE_AI_MODEL", "gemini-2.5-flash-lite"),
    }


@app.post("/ai/incident-guidance", response_model=IncidentGuidanceResponse)
async def incident_guidance(payload: IncidentGuidanceRequest) -> dict:
    return await generate_incident_guidance(payload)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
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
