import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import database
from app.main import RATE_LIMITS, app


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("RESCUEMESH_DB_PATH", str(db_path))
    monkeypatch.setenv("RESCUEMESH_DISABLE_RATE_LIMITING", "true")
    monkeypatch.delenv("RESCUEMESH_PUBLIC_MODE", raising=False)
    monkeypatch.delenv("RESCUEMESH_ADMIN_TOKEN", raising=False)
    monkeypatch.delenv("RESCUEMESH_RESPONDER_TOKEN", raising=False)
    RATE_LIMITS.clear()
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


def report_with(report_id: str, **overrides) -> dict:
    return {**sample_report(report_id), **overrides}


def test_report_creation(client: TestClient) -> None:
    response = client.post(
        "/reports",
        json={**sample_report(), "location_name": "Library", "location_address": "100 Library Walk, RescueMesh Campus"},
    )
    assert response.status_code == 201
    assert response.json()["report_id"] == "local-report-1"
    assert response.json()["location_name"] == "Library"
    assert response.json()["location_address"] == "100 Library Walk, RescueMesh Campus"

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


def test_report_comments_can_be_created_and_listed(client: TestClient) -> None:
    client.post("/reports", json=sample_report())
    comment = {
        "comment_id": "comment-local-1",
        "report_id": "local-report-1",
        "body": "Road access is still clear from the south side.",
        "image_data_url": "",
        "device_id": "device-beta",
        "timestamp": "2026-05-01T12:05:00Z",
    }

    created = client.post("/reports/local-report-1/comments", json=comment)
    listed = client.get("/reports/local-report-1/comments")

    assert created.status_code == 201
    assert created.json()["body"] == comment["body"]
    assert listed.status_code == 200
    assert listed.json() == [comment]


def test_report_comments_can_include_pasted_image_data(client: TestClient) -> None:
    client.post("/reports", json=sample_report())
    comment = {
        "comment_id": "comment-image-1",
        "report_id": "local-report-1",
        "body": "",
        "image_data_url": "data:image/png;base64,iVBORw0KGgo=",
        "device_id": "device-beta",
        "timestamp": "2026-05-01T12:05:00Z",
    }

    created = client.post("/reports/local-report-1/comments", json=comment)

    assert created.status_code == 201
    assert created.json()["image_data_url"].startswith("data:image/png")


def test_comment_requires_matching_report_id(client: TestClient) -> None:
    client.post("/reports", json=sample_report())

    response = client.post(
        "/reports/local-report-1/comments",
        json={
            "comment_id": "comment-local-1",
            "report_id": "different-report",
            "body": "Wrong report.",
            "device_id": "device-beta",
            "timestamp": "2026-05-01T12:05:00Z",
        },
    )

    assert response.status_code == 400


def test_marking_report_resolved(client: TestClient) -> None:
    client.post("/reports", json=sample_report())

    response = client.post("/reports/local-report-1/resolve")

    assert response.status_code == 200
    assert response.json()["status"] == "Resolved"


def test_delete_demo_reports(client: TestClient) -> None:
    client.post("/reports", json={**sample_report(), "is_demo": True})
    client.post("/reports", json={**sample_report("custom-report-1"), "title": "Custom field report"})

    response = client.delete("/demo/reports")

    assert response.status_code == 200
    assert response.json()["deleted_count"] == 1
    remaining_titles = [report["title"] for report in client.get("/reports").json()]
    assert remaining_titles == ["Custom field report"]


def test_delete_demo_reports_tombstones_requested_local_ids(client: TestClient) -> None:
    response = client.request("DELETE", "/demo/reports", json={"report_ids": ["local-demo-not-yet-synced"]})

    assert response.status_code == 200
    assert response.json()["deleted_report_ids"] == ["local-demo-not-yet-synced"]

    sync_response = client.post(
        "/sync",
        json={"known_report_ids": [], "reports": [sample_report("local-demo-not-yet-synced")]},
    )

    assert sync_response.status_code == 200
    assert sync_response.json()["accepted_reports"] == []
    assert sync_response.json()["total_reports"] == 0


def test_sync_only_returns_deleted_ids_known_by_client(client: TestClient) -> None:
    client.request("DELETE", "/demo/reports", json={"report_ids": ["known-deleted-report", "unknown-deleted-report"]})

    response = client.post(
        "/sync",
        json={"known_report_ids": ["known-deleted-report"], "reports": []},
    )

    assert response.status_code == 200
    assert response.json()["deleted_report_ids"] == ["known-deleted-report"]


def test_delete_all_reports(client: TestClient) -> None:
    client.post("/reports", json=sample_report())
    client.post("/reports", json=sample_report("second-report-1"))

    response = client.delete("/reports")

    assert response.status_code == 200
    assert response.json()["deleted_count"] == 2
    assert client.get("/reports").json() == []


def test_live_incidents_are_empty_without_mongodb(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MONGODB_URI", raising=False)

    response = client.get("/live-incidents")
    status = client.get("/live-incidents/status").json()

    assert response.status_code == 200
    assert response.json() == []
    assert status["configured"] is False
    assert status["available"] is False
    assert status["window_days"] == 7


def test_live_incident_refresh_requires_mongodb(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MONGODB_URI", raising=False)

    response = client.post("/live-incidents/refresh")

    assert response.status_code == 503


def test_geocode_returns_known_locations_without_remote_lookup(client: TestClient) -> None:
    response = client.get("/geocode", params={"query": "library"})

    assert response.status_code == 200
    body = response.json()
    assert body[0]["name"] == "Library"
    assert body[0]["source"] == "known-location"
    assert body[0]["address"] == "100 Library Walk, RescueMesh Campus"
    assert body[0]["latitude"] == 40.7136


def test_geocode_returns_usf_for_broad_campus_query(client: TestClient) -> None:
    response = client.get("/geocode", params={"query": "USF"})

    assert response.status_code == 200
    body = response.json()
    assert body[0]["name"] == "University of South Florida"
    assert body[0]["source"] == "known-location"


def test_public_mode_requires_admin_token_for_delete(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RESCUEMESH_PUBLIC_MODE", "true")
    monkeypatch.setenv("RESCUEMESH_ADMIN_TOKEN", "secret-token")
    client.post("/reports", json=sample_report())

    blocked = client.delete("/reports")
    allowed = client.delete("/reports", headers={"X-Admin-Token": "secret-token"})

    assert blocked.status_code == 403
    assert allowed.status_code == 200
    assert allowed.json()["deleted_count"] == 1


def test_public_mode_requires_responder_token_for_responder_actions(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RESCUEMESH_PUBLIC_MODE", "true")
    monkeypatch.setenv("RESCUEMESH_RESPONDER_TOKEN", "responder-secret")
    client.post("/reports", json=sample_report())

    blocked = client.post("/reports/local-report-1/responder-verify")
    allowed = client.post("/reports/local-report-1/responder-verify", headers={"X-Responder-Token": "responder-secret"})

    assert blocked.status_code == 403
    assert allowed.status_code == 200
    assert allowed.json()["responder_verified"] is True


def test_security_headers_are_set(client: TestClient) -> None:
    response = client.get("/health")

    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]


def test_rate_limiting_can_block_request_bursts(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("RESCUEMESH_DISABLE_RATE_LIMITING", raising=False)
    RATE_LIMITS.clear()

    responses = [client.post("/reports", json=sample_report(f"rate-limit-{index}")) for index in range(31)]

    assert responses[-1].status_code == 429


def test_comment_image_rejects_svg_data_url(client: TestClient) -> None:
    client.post("/reports", json=sample_report())

    response = client.post(
        "/reports/local-report-1/comments",
        json={
            "comment_id": "comment-svg-1",
            "report_id": "local-report-1",
            "body": "",
            "image_data_url": "data:image/svg+xml;base64,PHN2Zy8+",
            "device_id": "device-beta",
            "timestamp": "2026-05-01T12:05:00Z",
        },
    )

    assert response.status_code == 422


def test_inside_emergency_zone_increases_confidence(client: TestClient) -> None:
    response = client.post("/reports", json=report_with("inside-zone-1", timestamp="2099-01-01T12:00:00Z"))

    assert response.json()["verification_signals"]["insideEmergencyZone"] is True
    assert "Report is inside the configured emergency area." in response.json()["evidence_reasons"]


def test_outside_emergency_zone_lowers_confidence(client: TestClient) -> None:
    response = client.post("/reports", json=report_with("outside-zone-1", latitude=51.0, longitude=-75.0))

    assert response.json()["verification_signals"]["insideEmergencyZone"] is False
    assert "Report is outside the configured emergency area." in response.json()["warning_reasons"]
    assert response.json()["confidence_score"] <= 30


def test_stale_report_lowers_confidence(client: TestClient) -> None:
    response = client.post("/reports", json=report_with("stale-report-1", timestamp="2020-01-01T00:00:00Z"))

    assert response.json()["aging_label"] == "Stale"
    assert "This report is old. Verify before relying on it." in response.json()["warning_reasons"]


def test_similar_nearby_reports_increase_confidence(client: TestClient) -> None:
    client.post("/reports", json=report_with("similar-1", title="Water at library", timestamp="2099-01-01T12:00:00Z"))
    response = client.post(
        "/reports",
        json=report_with("similar-2", title="Water available library", device_id="device-beta", timestamp="2099-01-01T12:03:00Z"),
    )

    assert response.json()["verification_signals"]["hasSimilarNearbyReports"] is True
    assert response.json()["verification_signals"]["similarReportCount"] >= 1


def test_same_device_cannot_confirm_twice(client: TestClient) -> None:
    client.post("/reports", json=sample_report())

    client.post("/reports/local-report-1/confirm", json={"device_id": "device-beta"})
    repeated = client.post("/reports/local-report-1/confirm", json={"device_id": "device-beta"})

    assert repeated.json()["unique_confirmation_count"] == 1


def test_two_unique_confirmations_can_confirm_report(client: TestClient) -> None:
    client.post("/reports", json=sample_report())

    client.post("/reports/local-report-1/confirm", json={"device_id": "device-beta"})
    response = client.post("/reports/local-report-1/confirm", json={"device_id": "device-gamma"})

    assert response.json()["status"] == "Confirmed"


def test_responder_verification_increases_confidence(client: TestClient) -> None:
    client.post("/reports", json=report_with("responder-verify-1", timestamp="2099-01-01T12:00:00Z"))

    response = client.post("/reports/responder-verify-1/responder-verify")

    assert response.json()["responder_verified"] is True
    assert response.json()["confidence_score"] >= 60


def test_responder_rejection_forces_low_trust(client: TestClient) -> None:
    client.post("/reports", json=sample_report())

    response = client.post("/reports/local-report-1/responder-reject")

    assert response.json()["responder_rejected"] is True
    assert response.json()["verification_label"] == "Low Trust"


def test_suspicious_device_activity_lowers_confidence(client: TestClient) -> None:
    for index in range(6):
        client.post(
            "/reports",
            json=report_with(
                f"suspicious-{index}",
                title=f"Critical danger report {index}",
                urgency="Critical",
                timestamp=f"2099-01-01T12:00:0{index}Z",
                device_id="device-spam",
            ),
        )

    response = client.get("/reports").json()[0]

    assert response["verification_signals"]["suspiciousDeviceActivity"] is True
    assert response["status"] == "Needs Review"


def test_confidence_score_is_clamped(client: TestClient) -> None:
    response = client.post(
        "/reports",
        json=report_with("clamped-1", timestamp="2099-01-01T12:00:00Z", photo_evidence_attached=True),
    )
    client.post("/reports/clamped-1/responder-verify")
    client.post("/reports/clamped-1/confirm", json={"device_id": "device-beta"})
    client.post("/reports/clamped-1/confirm", json={"device_id": "device-gamma"})
    client.post("/reports/clamped-1/confirm", json={"device_id": "device-delta"})
    response = client.get("/reports").json()[0]

    assert 0 <= response["confidence_score"] <= 100


def test_resolved_status_overrides_verification_changes(client: TestClient) -> None:
    client.post("/reports", json=sample_report())
    client.post("/reports/local-report-1/resolve")

    response = client.post("/reports/local-report-1/responder-reject")

    assert response.json()["status"] == "Resolved"


def test_incident_guidance_uses_local_fallback_without_google_key(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GOOGLE_AI_API_KEY", raising=False)

    response = client.post(
        "/ai/incident-guidance",
        json={
            "title": "Road blocked near main entrance",
            "category": "Blocked Road",
            "description": "Large tree and debris across the entrance road.",
            "urgency": "High",
            "status": "Unverified",
            "aging_label": "Fresh",
            "verification_label": "Unverified",
            "confidence_score": 45,
        },
    )

    body = response.json()
    assert response.status_code == 200
    assert body["source"] == "local-fallback"
    assert body["should_do"]
    assert body["avoid"]
    assert body["unavailable_reason"] == "Gemini is not configured on this backend."


def test_ai_status_reports_google_ai_configuration(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOOGLE_AI_API_KEY", "test-key")
    monkeypatch.setenv("GOOGLE_AI_MODEL", "gemini-2.5-flash-lite")

    response = client.get("/ai/status")

    assert response.status_code == 200
    assert response.json() == {"googleAiConfigured": True, "model": "gemini-2.5-flash-lite"}
