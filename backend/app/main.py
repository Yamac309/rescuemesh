from datetime import datetime, timezone
import os

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from . import database
from .schemas import ConfirmRequest, NodeStatus, Report, ReportCreate, SyncRequest, SyncResponse


app = FastAPI(title="RescueMesh Node", version="0.1.0")

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


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.on_event("startup")
def on_startup() -> None:
    database.init_db()


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "RescueMesh Node"}


@app.get("/reports", response_model=list[Report])
def list_reports() -> list[dict]:
    return database.get_all_reports()


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
        if inserted:
            accepted_reports.append(saved_report)
        else:
            duplicate_report_ids.append(report.report_id)

    missing_reports = database.get_reports_missing_from_client(payload.known_report_ids)
    database.set_meta("last_sync_time", utc_now())

    for report in accepted_reports:
        await manager.broadcast({"type": "report:new", "report": report})

    return {
        "missing_reports": missing_reports,
        "accepted_reports": accepted_reports,
        "duplicate_report_ids": duplicate_report_ids,
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


@app.post("/reports/{report_id}/resolve", response_model=Report)
async def resolve_report(report_id: str) -> dict:
    report = database.resolve_report(report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    await manager.broadcast({"type": "report:updated", "report": report})
    return report


@app.get("/node/status", response_model=NodeStatus)
def node_status() -> dict:
    return {
        "node_name": os.getenv("RESCUEMESH_NODE_NAME", "RescueMesh Local Node"),
        "connected_clients": manager.connected_count,
        "total_reports": database.total_reports(),
        "last_sync_time": database.get_meta("last_sync_time"),
        "backend_health": "ok",
    }


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
        manager.disconnect(websocket)
