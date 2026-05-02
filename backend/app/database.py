import json
import os
import sqlite3
from pathlib import Path

from .config.emergency_zone import get_node_id
from .schemas import ReportCreate


def get_db_path() -> Path:
    default_path = Path(__file__).resolve().parents[1] / "data" / "rescuemesh.db"
    return Path(os.getenv("RESCUEMESH_DB_PATH", default_path))


def get_connection() -> sqlite3.Connection:
    db_path = get_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    with get_connection() as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS reports (
                report_id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                category TEXT NOT NULL,
                description TEXT NOT NULL,
                urgency TEXT NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                status TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                device_id TEXT NOT NULL
            )
            """
        )
        existing_columns = {row["name"] for row in db.execute("PRAGMA table_info(reports)").fetchall()}
        report_columns = {
            "photo_evidence_attached": "INTEGER DEFAULT 0",
            "confidence_score": "INTEGER DEFAULT 30",
            "verification_label": "TEXT DEFAULT 'Unverified'",
            "evidence_reasons": "TEXT DEFAULT '[]'",
            "warning_reasons": "TEXT DEFAULT '[]'",
            "aging_label": "TEXT DEFAULT 'Fresh'",
            "verification_signals": "TEXT DEFAULT '{}'",
            "responder_verified": "INTEGER DEFAULT 0",
            "responder_rejected": "INTEGER DEFAULT 0",
            "responder_note": "TEXT",
            "seen_by_nodes": "TEXT DEFAULT '[]'",
            "updated_at": "TEXT",
        }
        for column, definition in report_columns.items():
            if column not in existing_columns:
                db.execute(f"ALTER TABLE reports ADD COLUMN {column} {definition}")
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS confirmations (
                report_id TEXT NOT NULL,
                device_id TEXT NOT NULL,
                confirmed_at TEXT DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (report_id, device_id),
                FOREIGN KEY (report_id) REFERENCES reports(report_id)
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS device_trust (
                device_id TEXT PRIMARY KEY,
                trust_score INTEGER NOT NULL DEFAULT 70,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS node_meta (
                key TEXT PRIMARY KEY,
                value TEXT
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS deleted_reports (
                report_id TEXT PRIMARY KEY,
                deleted_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
            """
        )


def _json_loads(value: str | None, fallback):
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def _bool(value) -> bool:
    return bool(int(value or 0))


def row_to_report(row: sqlite3.Row) -> dict:
    confirmation_count = row["confirmation_count"]
    return {
        "report_id": row["report_id"],
        "title": row["title"],
        "category": row["category"],
        "description": row["description"],
        "urgency": row["urgency"],
        "latitude": row["latitude"],
        "longitude": row["longitude"],
        "status": row["status"],
        "timestamp": row["timestamp"],
        "device_id": row["device_id"],
        "photo_evidence_attached": _bool(row["photo_evidence_attached"]),
        "confirmation_count": confirmation_count,
        "unique_confirmation_count": confirmation_count,
        "confidence_score": row["confidence_score"] or 30,
        "verification_label": row["verification_label"] or "Unverified",
        "evidence_reasons": _json_loads(row["evidence_reasons"], []),
        "warning_reasons": _json_loads(row["warning_reasons"], []),
        "aging_label": row["aging_label"] or "Fresh",
        "verification_signals": _json_loads(row["verification_signals"], {}),
        "responder_verified": _bool(row["responder_verified"]),
        "responder_rejected": _bool(row["responder_rejected"]),
        "responder_note": row["responder_note"],
        "seen_by_nodes": _json_loads(row["seen_by_nodes"], []),
        "updated_at": row["updated_at"],
    }


def report_select_sql(where_clause: str = "") -> str:
    return f"""
        SELECT
            r.report_id,
            r.title,
            r.category,
            r.description,
            r.urgency,
            r.latitude,
            r.longitude,
            r.status,
            r.timestamp,
            r.device_id,
            r.photo_evidence_attached,
            r.confidence_score,
            r.verification_label,
            r.evidence_reasons,
            r.warning_reasons,
            r.aging_label,
            r.verification_signals,
            r.responder_verified,
            r.responder_rejected,
            r.responder_note,
            r.seen_by_nodes,
            r.updated_at,
            COUNT(c.device_id) AS confirmation_count
        FROM reports r
        LEFT JOIN confirmations c ON c.report_id = r.report_id
        {where_clause}
        GROUP BY r.report_id
        ORDER BY r.timestamp DESC
    """


def get_all_reports() -> list[dict]:
    recalculate_all_verification()
    with get_connection() as db:
        rows = db.execute(report_select_sql()).fetchall()
        return [row_to_report(row) for row in rows]


def get_report_ids() -> list[str]:
    with get_connection() as db:
        rows = db.execute("SELECT report_id FROM reports").fetchall()
        return [row["report_id"] for row in rows]


def get_report(report_id: str) -> dict | None:
    recalculate_all_verification()
    with get_connection() as db:
        row = db.execute(
            report_select_sql("WHERE r.report_id = ?"),
            (report_id,),
        ).fetchone()
        return row_to_report(row) if row else None


def insert_report(report: ReportCreate) -> tuple[bool, dict]:
    with get_connection() as db:
        ensure_device_trust(report.device_id)
        deleted = db.execute(
            "SELECT report_id FROM deleted_reports WHERE report_id = ?",
            (report.report_id,),
        ).fetchone()
        if deleted:
            return False, None
        existing = db.execute(
            "SELECT report_id FROM reports WHERE report_id = ?",
            (report.report_id,),
        ).fetchone()
        if existing:
            return False, get_report(report.report_id)

        db.execute(
            """
            INSERT INTO reports (
                report_id,
                title,
                category,
                description,
                urgency,
                latitude,
                longitude,
                status,
                timestamp,
                device_id,
                photo_evidence_attached,
                seen_by_nodes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                report.report_id,
                report.title,
                report.category,
                report.description,
                report.urgency,
                report.latitude,
                report.longitude,
                report.status,
                report.timestamp,
                report.device_id,
                int(report.photo_evidence_attached),
                json.dumps([get_node_id()]),
            ),
        )
        db.commit()
    recalculate_all_verification()
    return True, get_report(report.report_id)


def get_deleted_report_ids() -> list[str]:
    with get_connection() as db:
        rows = db.execute("SELECT report_id FROM deleted_reports").fetchall()
        return [row["report_id"] for row in rows]


def remember_deleted_report_ids(report_ids: list[str]) -> None:
    if not report_ids:
        return
    with get_connection() as db:
        db.executemany(
            "INSERT OR IGNORE INTO deleted_reports (report_id) VALUES (?)",
            [(report_id,) for report_id in report_ids],
        )
        db.commit()


def get_reports_missing_from_client(known_report_ids: list[str]) -> list[dict]:
    all_reports = get_all_reports()
    known = set(known_report_ids)
    return [report for report in all_reports if report["report_id"] not in known]


def confirm_report(report_id: str, device_id: str) -> dict | None:
    creator_to_reward = None
    with get_connection() as db:
        ensure_device_trust(device_id)
        report_exists = db.execute(
            "SELECT report_id FROM reports WHERE report_id = ?",
            (report_id,),
        ).fetchone()
        if not report_exists:
            return None

        cursor = db.execute(
            "INSERT OR IGNORE INTO confirmations (report_id, device_id) VALUES (?, ?)",
            (report_id, device_id),
        )
        if cursor.rowcount:
            creator_to_reward = db.execute("SELECT device_id FROM reports WHERE report_id = ?", (report_id,)).fetchone()["device_id"]
        count = db.execute(
            "SELECT COUNT(*) AS count FROM confirmations WHERE report_id = ?",
            (report_id,),
        ).fetchone()["count"]
        if count >= 2:
            db.execute(
                "UPDATE reports SET status = 'Confirmed' WHERE report_id = ? AND status != 'Resolved'",
                (report_id,),
            )
        db.commit()
    if creator_to_reward:
        adjust_device_trust(creator_to_reward, 5)
    recalculate_all_verification()
    return get_report(report_id)


def resolve_report(report_id: str) -> dict | None:
    with get_connection() as db:
        cursor = db.execute(
            "UPDATE reports SET status = 'Resolved', updated_at = CURRENT_TIMESTAMP WHERE report_id = ?",
            (report_id,),
        )
        db.commit()
        if cursor.rowcount == 0:
            return None
    recalculate_all_verification()
    return get_report(report_id)


def responder_verify(report_id: str) -> dict | None:
    with get_connection() as db:
        row = db.execute("SELECT device_id FROM reports WHERE report_id = ?", (report_id,)).fetchone()
        if not row:
            return None
        db.execute(
            """
            UPDATE reports
            SET responder_verified = 1, responder_rejected = 0, updated_at = CURRENT_TIMESTAMP
            WHERE report_id = ?
            """,
            (report_id,),
        )
        db.commit()
        adjust_device_trust(row["device_id"], 10)
    recalculate_all_verification()
    return get_report(report_id)


def responder_reject(report_id: str) -> dict | None:
    with get_connection() as db:
        row = db.execute("SELECT device_id FROM reports WHERE report_id = ?", (report_id,)).fetchone()
        if not row:
            return None
        db.execute(
            """
            UPDATE reports
            SET
                responder_verified = 0,
                responder_rejected = 1,
                status = CASE WHEN status = 'Resolved' THEN 'Resolved' ELSE 'Needs Review' END,
                updated_at = CURRENT_TIMESTAMP
            WHERE report_id = ?
            """,
            (report_id,),
        )
        db.commit()
        adjust_device_trust(row["device_id"], -10)
    recalculate_all_verification()
    return get_report(report_id)


def responder_note(report_id: str, note: str) -> dict | None:
    with get_connection() as db:
        cursor = db.execute(
            "UPDATE reports SET responder_note = ?, updated_at = CURRENT_TIMESTAMP WHERE report_id = ?",
            (note, report_id),
        )
        db.commit()
        if cursor.rowcount == 0:
            return None
    recalculate_all_verification()
    return get_report(report_id)


def get_needs_review_reports() -> list[dict]:
    return [report for report in get_all_reports() if report["status"] == "Needs Review" or report["verification_label"] == "Low Trust"]


def ensure_device_trust(device_id: str) -> None:
    with get_connection() as db:
        db.execute(
            "INSERT OR IGNORE INTO device_trust (device_id, trust_score) VALUES (?, 70)",
            (device_id,),
        )
        db.commit()


def adjust_device_trust(device_id: str, delta: int) -> None:
    ensure_device_trust(device_id)
    with get_connection() as db:
        db.execute(
            """
            UPDATE device_trust
            SET trust_score = MAX(0, MIN(100, trust_score + ?)), updated_at = CURRENT_TIMESTAMP
            WHERE device_id = ?
            """,
            (delta, device_id),
        )
        db.commit()


def get_device_trust_score(device_id: str) -> int:
    ensure_device_trust(device_id)
    with get_connection() as db:
        return db.execute("SELECT trust_score FROM device_trust WHERE device_id = ?", (device_id,)).fetchone()["trust_score"]


def recalculate_all_verification() -> None:
    from .services.verification import evaluate_report

    with get_connection() as db:
        rows = db.execute(report_select_sql()).fetchall()
        reports = [row_to_report(row) for row in rows]
        for device_id in {report["device_id"] for report in reports}:
            db.execute(
                "INSERT OR IGNORE INTO device_trust (device_id, trust_score) VALUES (?, 70)",
                (device_id,),
            )
        trust_rows = db.execute("SELECT device_id, trust_score FROM device_trust").fetchall()
        trust_scores = {row["device_id"]: row["trust_score"] for row in trust_rows}
        for report in reports:
            trust_score = trust_scores.get(report["device_id"], 70)
            evaluation = evaluate_report(report, reports, trust_score, get_node_id())
            db.execute(
                """
                UPDATE reports
                SET
                    confidence_score = ?,
                    verification_label = ?,
                    evidence_reasons = ?,
                    warning_reasons = ?,
                    aging_label = ?,
                    verification_signals = ?,
                    status = ?,
                    seen_by_nodes = ?,
                    updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
                WHERE report_id = ?
                """,
                (
                    evaluation["confidence_score"],
                    evaluation["verification_label"],
                    json.dumps(evaluation["evidence_reasons"]),
                    json.dumps(evaluation["warning_reasons"]),
                    evaluation["aging_label"],
                    json.dumps(evaluation["verification_signals"]),
                    evaluation["status"],
                    json.dumps(evaluation["seen_by_nodes"]),
                    report["report_id"],
                ),
            )
        db.commit()


def delete_reports_by_titles(titles: list[str]) -> list[str]:
    if not titles:
        return []

    placeholders = ",".join("?" for _ in titles)
    with get_connection() as db:
        rows = db.execute(
            f"SELECT report_id FROM reports WHERE title IN ({placeholders})",
            titles,
        ).fetchall()
        report_ids = [row["report_id"] for row in rows]
        if report_ids:
            db.executemany(
                "INSERT OR IGNORE INTO deleted_reports (report_id) VALUES (?)",
                [(report_id,) for report_id in report_ids],
            )
            id_placeholders = ",".join("?" for _ in report_ids)
            db.execute(f"DELETE FROM confirmations WHERE report_id IN ({id_placeholders})", report_ids)
            db.execute(f"DELETE FROM reports WHERE report_id IN ({id_placeholders})", report_ids)
        db.commit()
    return report_ids


def delete_all_reports() -> list[str]:
    with get_connection() as db:
        rows = db.execute("SELECT report_id FROM reports").fetchall()
        report_ids = [row["report_id"] for row in rows]
        if report_ids:
            db.executemany(
                "INSERT OR IGNORE INTO deleted_reports (report_id) VALUES (?)",
                [(report_id,) for report_id in report_ids],
            )
        db.execute("DELETE FROM confirmations")
        db.execute("DELETE FROM reports")
        db.commit()
    return report_ids


def total_reports() -> int:
    with get_connection() as db:
        return db.execute("SELECT COUNT(*) AS count FROM reports").fetchone()["count"]


def set_meta(key: str, value: str) -> None:
    with get_connection() as db:
        db.execute(
            """
            INSERT INTO node_meta (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (key, value),
        )


def get_meta(key: str) -> str | None:
    with get_connection() as db:
        row = db.execute("SELECT value FROM node_meta WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else None
