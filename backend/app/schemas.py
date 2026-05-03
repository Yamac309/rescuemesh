from typing import Literal

from pydantic import BaseModel, Field


Category = Literal[
    "Need Help",
    "Food",
    "Water",
    "Shelter",
    "First Aid",
    "Charging",
    "Blocked Road",
    "Dangerous Area",
    "General Update",
]

Urgency = Literal["Low", "Medium", "High", "Critical"]
Status = Literal["Unverified", "Confirmed", "Resolved", "Needs Review"]


class ReportBase(BaseModel):
    report_id: str = Field(min_length=8)
    title: str = Field(min_length=1, max_length=120)
    category: Category
    description: str = Field(default="", max_length=2000)
    urgency: Urgency
    location_name: str = Field(default="", max_length=240)
    location_address: str = Field(default="", max_length=500)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    status: Status = "Unverified"
    timestamp: str
    device_id: str = Field(min_length=4)
    photo_evidence_attached: bool = False
    is_demo: bool = False


class ReportCreate(ReportBase):
    pass


class Report(ReportBase):
    confirmation_count: int = 0
    unique_confirmation_count: int = 0
    confidence_score: int = 30
    verification_label: str = "Unverified"
    evidence_reasons: list[str] = Field(default_factory=list)
    warning_reasons: list[str] = Field(default_factory=list)
    aging_label: str = "Fresh"
    verification_signals: dict = Field(default_factory=dict)
    responder_verified: bool = False
    responder_rejected: bool = False
    responder_note: str | None = None
    seen_by_nodes: list[str] = Field(default_factory=list)
    updated_at: str | None = None


class SyncRequest(BaseModel):
    known_report_ids: list[str] = Field(default_factory=list)
    reports: list[ReportCreate] = Field(default_factory=list)


class SyncResponse(BaseModel):
    missing_reports: list[Report]
    accepted_reports: list[Report]
    duplicate_report_ids: list[str]
    deleted_report_ids: list[str] = Field(default_factory=list)
    backend_report_ids: list[str]
    total_reports: int


class ConfirmRequest(BaseModel):
    device_id: str = Field(min_length=4)


class ResponderNoteRequest(BaseModel):
    note: str = Field(default="", max_length=1000)


class IncidentGuidanceRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    category: Category
    description: str = Field(default="", max_length=2000)
    urgency: Urgency
    status: Status = "Unverified"
    timestamp: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    confidence_score: int | None = Field(default=None, ge=0, le=100)
    verification_label: str | None = None
    aging_label: str | None = None


class IncidentGuidanceResponse(BaseModel):
    should_do: list[str]
    avoid: list[str]
    safety_note: str
    source: Literal["google-ai", "local-fallback"]
    model: str | None = None
    unavailable_reason: str | None = None


class LocationSuggestion(BaseModel):
    name: str
    address: str = ""
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    source: Literal["known-location", "openstreetmap"]


class NodeStatus(BaseModel):
    node_name: str
    connected_clients: int
    total_reports: int
    last_sync_time: str | None
    backend_health: str
