from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any


def _sqlite_path(database_url: str) -> Path:
    if not database_url.startswith("sqlite:///"):
        raise ValueError("Only local sqlite:/// URLs are supported in the MVP.")
    return Path(database_url.removeprefix("sqlite:///"))


def _json_value(value: Any) -> str:
    if is_dataclass(value):
        value = asdict(value)  # type: ignore[arg-type]
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json")
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


class SQLiteRepository:
    """Small transactional repository with immutable plan-version rows."""

    def __init__(self, database_url: str = "sqlite:///./data/runtime/dispatch.db") -> None:
        self.path = _sqlite_path(database_url)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS datasets (
                    dataset_id TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    validation_json TEXT NOT NULL,
                    matrix_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS plans (
                    plan_id TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    dataset_id TEXT NOT NULL REFERENCES datasets(dataset_id),
                    state TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    validation_json TEXT NOT NULL,
                    matrix_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (plan_id, version)
                );
                CREATE TABLE IF NOT EXISTS audit_events (
                    event_id TEXT PRIMARY KEY,
                    plan_id TEXT,
                    version INTEGER,
                    event_type TEXT NOT NULL,
                    metadata_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS plan_current (
                    plan_id TEXT PRIMARY KEY,
                    version INTEGER NOT NULL
                );
                """
            )

    def save_dataset(
        self,
        dataset_id: str,
        dataset: Any,
        validation: Any,
        matrix: Any,
        created_at: str,
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO datasets
                    (dataset_id, payload_json, validation_json, matrix_json, created_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(dataset_id) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    validation_json = excluded.validation_json,
                    matrix_json = excluded.matrix_json,
                    created_at = excluded.created_at
                """,
                (
                    dataset_id,
                    _json_value(dataset),
                    _json_value(validation),
                    _json_value(matrix),
                    created_at,
                ),
            )

    def save_plan(self, record: Any, make_current: bool = True) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO plans
                (
                    plan_id, version, dataset_id, state, payload_json,
                    validation_json, matrix_json, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record.plan_id,
                    record.version,
                    record.dataset_id,
                    record.state,
                    _json_value(record.plan),
                    _json_value(record.validation),
                    _json_value(record.matrix),
                    record.created_at,
                ),
            )
            if make_current:
                connection.execute(
                    """
                    INSERT INTO plan_current (plan_id, version) VALUES (?, ?)
                    ON CONFLICT(plan_id) DO UPDATE SET version = excluded.version
                    """,
                    (record.plan_id, record.version),
                )

    def append_audit(
        self,
        event_id: str,
        event_type: str,
        created_at: str,
        plan_id: str | None = None,
        version: int | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO audit_events VALUES (?, ?, ?, ?, ?, ?)",
                (event_id, plan_id, version, event_type, _json_value(metadata or {}), created_at),
            )

    def count(self, table: str) -> int:
        if table not in {"datasets", "plans", "audit_events"}:
            raise ValueError("Unsupported repository table.")
        with self._connect() as connection:
            row = connection.execute(f"SELECT COUNT(*) AS count FROM {table}").fetchone()
            return int(row["count"])

    def load_datasets(self) -> list[sqlite3.Row]:
        with self._connect() as connection:
            return list(
                connection.execute("SELECT * FROM datasets ORDER BY created_at, dataset_id")
            )

    def load_plans(self) -> list[sqlite3.Row]:
        with self._connect() as connection:
            return list(connection.execute("SELECT * FROM plans ORDER BY plan_id, version"))

    def current_versions(self) -> dict[str, int]:
        with self._connect() as connection:
            rows = connection.execute("SELECT plan_id, version FROM plan_current").fetchall()
            return {str(row["plan_id"]): int(row["version"]) for row in rows}
