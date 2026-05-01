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
Status = Literal["Unverified", "Confirmed", "Resolved"]


class ReportBase(BaseModel):
    report_id: str = Field(min_length=8)
    title: str = Field(min_length=1, max_length=120)
    category: Category
    description: str = Field(default="", max_length=2000)
    urgency: Urgency
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    status: Status = "Unverified"
    timestamp: str
    device_id: str = Field(min_length=4)


class ReportCreate(ReportBase):
    pass


class Report(ReportBase):
    confirmation_count: int = 0


class SyncRequest(BaseModel):
    known_report_ids: list[str] = Field(default_factory=list)
    reports: list[ReportCreate] = Field(default_factory=list)


class SyncResponse(BaseModel):
    missing_reports: list[Report]
    accepted_reports: list[Report]
    duplicate_report_ids: list[str]
    backend_report_ids: list[str]
    total_reports: int


class ConfirmRequest(BaseModel):
    device_id: str = Field(min_length=4)


class NodeStatus(BaseModel):
    node_name: str
    connected_clients: int
    total_reports: int
    last_sync_time: str | None
    backend_health: str
