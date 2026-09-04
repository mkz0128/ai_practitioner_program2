import sqlite3
from dataclasses import dataclass

from src.repositories.sqlite import SQLiteRepository
from src.services.matrix import MatrixResult


def test_sqlite_repository_creates_dataset_plan_and_audit_tables(tmp_path) -> None:
    repository = SQLiteRepository(f"sqlite:///{tmp_path / 'dispatch.db'}")

    with sqlite3.connect(repository.path) as connection:
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }

    assert {"datasets", "plans", "audit_events"} <= tables
    assert repository.count("datasets") == 0
    assert repository.count("plans") == 0
    assert repository.count("audit_events") == 0


@dataclass
class _PlanRecord:
    plan_id: str
    version: int
    dataset_id: str
    state: str
    plan: dict
    validation: dict
    matrix: MatrixResult
    created_at: str


def test_sqlite_repository_persists_immutable_plan_versions(tmp_path) -> None:
    repository = SQLiteRepository(f"sqlite:///{tmp_path / 'dispatch.db'}")
    matrix = MatrixResult(node_ids=("DEPOT-001",), distance_m=((0,),), duration_s=((0,),))
    repository.save_dataset("DS-1", {"orders": []}, {"is_valid": True}, matrix, "now")
    repository.save_plan(
        _PlanRecord(
            "PLAN-1",
            1,
            "DS-1",
            "PROPOSED",
            {"algorithm": "BASELINE"},
            {"valid": True},
            matrix,
            "now",
        )
    )
    repository.append_audit("AUD-1", "PLAN_CREATED", "now", "PLAN-1", 1)

    assert repository.count("datasets") == 1
    assert repository.count("plans") == 1
    assert repository.count("audit_events") == 1


def test_sqlite_repository_updates_confirmed_state_and_current_pointer(tmp_path) -> None:
    repository = SQLiteRepository(f"sqlite:///{tmp_path / 'dispatch.db'}")
    matrix = MatrixResult(node_ids=("DEPOT-001",), distance_m=((0,),), duration_s=((0,),))
    repository.save_dataset("DS-1", {"orders": []}, {"is_valid": True}, matrix, "now")
    repository.save_plan(
        _PlanRecord(
            "PLAN-1",
            1,
            "DS-1",
            "PROPOSED",
            {"algorithm": "BASELINE"},
            {"valid": True},
            matrix,
            "now",
        )
    )
    repository.set_current_version("PLAN-1", 1)
    repository.update_plan_state("PLAN-1", 1, "CONFIRMED")

    assert repository.current_versions() == {"PLAN-1": 1}
    row = repository.load_plans()[0]
    assert row["state"] == "CONFIRMED"
