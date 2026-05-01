import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import database
from app.main import app


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("RESCUEMESH_DB_PATH", str(db_path))
    database.init_db()
    return TestClient(app)


def sample_report(report_id: str = "local-report-1") -> dict:
    return {
        "report_id": report_id,
        "title": "Water available at library",
        "category": "Water",
        "description": "Cases of bottled water at the front desk.",
        "urgency": "Medium",
        "latitude": 40.7128,
        "longitude": -74.006,
        "status": "Unverified",
        "timestamp": "2026-05-01T12:00:00Z",
        "device_id": "device-alpha",
    }


def test_report_creation(client: TestClient) -> None:
    response = client.post("/reports", json=sample_report())
    assert response.status_code == 201
    assert response.json()["report_id"] == "local-report-1"

    reports = client.get("/reports").json()
    assert len(reports) == 1


def test_duplicate_report_id_prevention(client: TestClient) -> None:
    assert client.post("/reports", json=sample_report()).status_code == 201
    duplicate = client.post("/reports", json=sample_report())

    assert duplicate.status_code == 201
    assert len(client.get("/reports").json()) == 1


def test_sync_missing_reports(client: TestClient) -> None:
    client.post("/reports", json=sample_report("server-report-1"))
    local_report = sample_report("client-report-1")

    response = client.post(
        "/sync",
        json={"known_report_ids": ["client-report-1"], "reports": [local_report]},
    )

    body = response.json()
    assert response.status_code == 200
    assert body["accepted_reports"][0]["report_id"] == "client-report-1"
    assert body["missing_reports"][0]["report_id"] == "server-report-1"
    assert body["total_reports"] == 2


def test_confirming_report(client: TestClient) -> None:
    client.post("/reports", json=sample_report())

    first = client.post("/reports/local-report-1/confirm", json={"device_id": "device-alpha"})
    second = client.post("/reports/local-report-1/confirm", json={"device_id": "device-beta"})
    repeated = client.post("/reports/local-report-1/confirm", json={"device_id": "device-beta"})

    assert first.json()["confirmation_count"] == 1
    assert second.json()["confirmation_count"] == 2
    assert second.json()["status"] == "Confirmed"
    assert repeated.json()["confirmation_count"] == 2


def test_marking_report_resolved(client: TestClient) -> None:
    client.post("/reports", json=sample_report())

    response = client.post("/reports/local-report-1/resolve")

    assert response.status_code == 200
    assert response.json()["status"] == "Resolved"


def test_delete_demo_reports(client: TestClient) -> None:
    client.post("/reports", json=sample_report())
    client.post("/reports", json={**sample_report("custom-report-1"), "title": "Custom field report"})

    response = client.delete("/demo/reports")

    assert response.status_code == 200
    assert response.json()["deleted_count"] == 1
    remaining_titles = [report["title"] for report in client.get("/reports").json()]
    assert remaining_titles == ["Custom field report"]


def test_delete_all_reports(client: TestClient) -> None:
    client.post("/reports", json=sample_report())
    client.post("/reports", json=sample_report("second-report-1"))

    response = client.delete("/reports")

    assert response.status_code == 200
    assert response.json()["deleted_count"] == 2
    assert client.get("/reports").json() == []
