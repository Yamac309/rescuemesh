import os
import sqlite3
from pathlib import Path

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
            CREATE TABLE IF NOT EXISTS node_meta (
                key TEXT PRIMARY KEY,
                value TEXT
            )
            """
        )


def row_to_report(row: sqlite3.Row) -> dict:
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
        "confirmation_count": row["confirmation_count"],
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
            COUNT(c.device_id) AS confirmation_count
        FROM reports r
        LEFT JOIN confirmations c ON c.report_id = r.report_id
        {where_clause}
        GROUP BY r.report_id
        ORDER BY r.timestamp DESC
    """


def get_all_reports() -> list[dict]:
    with get_connection() as db:
        rows = db.execute(report_select_sql()).fetchall()
        return [row_to_report(row) for row in rows]


def get_report_ids() -> list[str]:
    with get_connection() as db:
        rows = db.execute("SELECT report_id FROM reports").fetchall()
        return [row["report_id"] for row in rows]


def get_report(report_id: str) -> dict | None:
    with get_connection() as db:
        row = db.execute(
            report_select_sql("WHERE r.report_id = ?"),
            (report_id,),
        ).fetchone()
        return row_to_report(row) if row else None


def insert_report(report: ReportCreate) -> tuple[bool, dict]:
    with get_connection() as db:
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
                device_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            ),
        )
        db.commit()
    return True, get_report(report.report_id)


def get_reports_missing_from_client(known_report_ids: list[str]) -> list[dict]:
    all_reports = get_all_reports()
    known = set(known_report_ids)
    return [report for report in all_reports if report["report_id"] not in known]


def confirm_report(report_id: str, device_id: str) -> dict | None:
    with get_connection() as db:
        report_exists = db.execute(
            "SELECT report_id FROM reports WHERE report_id = ?",
            (report_id,),
        ).fetchone()
        if not report_exists:
            return None

        db.execute(
            "INSERT OR IGNORE INTO confirmations (report_id, device_id) VALUES (?, ?)",
            (report_id, device_id),
        )
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
    return get_report(report_id)


def resolve_report(report_id: str) -> dict | None:
    with get_connection() as db:
        cursor = db.execute(
            "UPDATE reports SET status = 'Resolved' WHERE report_id = ?",
            (report_id,),
        )
        db.commit()
        if cursor.rowcount == 0:
            return None
    return get_report(report_id)


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
            id_placeholders = ",".join("?" for _ in report_ids)
            db.execute(f"DELETE FROM confirmations WHERE report_id IN ({id_placeholders})", report_ids)
            db.execute(f"DELETE FROM reports WHERE report_id IN ({id_placeholders})", report_ids)
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
