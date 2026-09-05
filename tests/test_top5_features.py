from pathlib import Path

from fastapi.testclient import TestClient

from src.api.main import app, store

SAMPLE_WORKBOOK = Path(__file__).parents[1] / "data" / "samples" / "demo-delivery-40-orders.xlsx"
client = TestClient(app)


def _plan() -> tuple[str, dict]:
    store.datasets.clear()
    store.plans.clear()
    store.current_versions.clear()
    with SAMPLE_WORKBOOK.open("rb") as workbook:
        imported = client.post(
            "/api/v1/datasets/import-excel",
            files={
                "file": (
                    SAMPLE_WORKBOOK.name,
                    workbook,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
    assert imported.status_code == 201, imported.text
    dataset_id = imported.json()["dataset_id"]
    created = client.post(
        "/api/v1/plans",
        json={
            "dataset_id": dataset_id,
            "algorithm": "ORTOOLS",
            "route_provider_preference": "SIMULATED",
        },
    )
    assert created.status_code == 201, created.text
    return created.json()["plan_id"], created.json()


def test_strategy_comparison_uses_three_objectives_and_one_matrix() -> None:
    dataset_id = None
    with SAMPLE_WORKBOOK.open("rb") as workbook:
        imported = client.post(
            "/api/v1/datasets/import-excel",
            files={
                "file": (
                    SAMPLE_WORKBOOK.name,
                    workbook,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
    assert imported.status_code == 201
    dataset_id = imported.json()["dataset_id"]
    response = client.post(
        "/api/v1/plans/compare",
        json={"dataset_id": dataset_id, "route_provider_preference": "SIMULATED"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert {item["objective"] for item in body["strategies"]} == {"FASTEST", "BALANCED", "STABLE"}
    assert len({item["validator"]["valid"] for item in body["strategies"]}) == 1
    assert len({item["algorithm"] for item in body["strategies"]}) == 1
    fingerprints = {
        (
            item["total_distance_m"],
            item["total_duration_s"],
            item["load_spread_kg"],
        )
        for item in body["strategies"]
    }
    assert len(fingerprints) == 3
    assert body["matrix_hash"]
    by_objective = {item["objective"]: item for item in body["strategies"]}
    assert all(item["primary_goal"] and item["tradeoff"] for item in body["strategies"])
    assert by_objective["FASTEST"]["total_duration_s"] <= min(
        by_objective["BALANCED"]["total_duration_s"],
        by_objective["STABLE"]["total_duration_s"],
    )
    assert by_objective["BALANCED"]["load_spread_kg"] <= min(
        by_objective["FASTEST"]["load_spread_kg"],
        by_objective["STABLE"]["load_spread_kg"],
    )
    assert by_objective["STABLE"]["min_slack_minutes"] >= max(
        by_objective["FASTEST"]["min_slack_minutes"],
        by_objective["BALANCED"]["min_slack_minutes"],
    )


def test_strategy_comparison_can_reuse_the_current_plan_matrix(monkeypatch) -> None:
    plan_id, plan = _plan()

    def fail_if_matrix_is_rebuilt(*args, **kwargs):
        del args, kwargs
        raise AssertionError("目前方案已有矩陣，策略比較不應重新呼叫 Provider")

    monkeypatch.setattr("src.api.main._build_matrix", fail_if_matrix_is_rebuilt)
    response = client.post(
        "/api/v1/plans/compare",
        json={
            "dataset_id": plan["dataset_id"],
            "plan_id": plan_id,
            "version": plan["version"],
            "route_provider_preference": "AUTO",
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["matrix_hash"] == plan["matrix_hash"]
    assert body["provider_mode"] == plan["provider_mode"]


def test_delay_preview_returns_deterministic_slack_and_simulation() -> None:
    plan_id, _ = _plan()
    response = client.post(
        f"/api/v1/plans/{plan_id}/delay-preview", json={"version": 1, "delay_minutes": 20}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["simulation"]["delay_minutes"] == 20
    assert body["risks"]
    assert {item["risk_level"] for item in body["risks"]} <= {"GREEN", "YELLOW", "RED"}
    assert body["validator"]["valid"] is True


def test_reassignment_preview_is_non_mutating_and_validated() -> None:
    plan_id, initial = _plan()
    source_routes = [route for route in initial["vehicles"] if route["stops"]]
    vehicle_ids = [route["vehicle_id"] for route in initial["vehicles"]]
    preview = None
    for source in source_routes:
        for stop in source["stops"]:
            for target in vehicle_ids:
                if target == source["vehicle_id"]:
                    continue
                candidate = client.post(
                    f"/api/v1/plans/{plan_id}/reassign/preview",
                    json={
                        "base_plan_version": 1,
                        "order_id": stop["order_id"],
                        "target_vehicle_id": target,
                    },
                )
                if candidate.status_code == 200:
                    preview = candidate.json()
                    break
            if preview:
                break
        if preview:
            break
    assert preview is not None
    assert preview["base_version"] == 1
    assert preview["preview_version"] == 2
    assert preview["requires_human_confirmation"] is True
    assert preview["validator"]["valid"] is True
    assert client.get(f"/api/v1/plans/{plan_id}").json()["version"] == 1


def test_restore_creates_new_version_and_dispatch_is_disabled() -> None:
    plan_id, _ = _plan()
    confirmed = client.post(
        f"/api/v1/plans/{plan_id}/confirm",
        json={"version": 1, "confirmation": "CONFIRM_PLAN", "dispatcher_reference": "test"},
    )
    assert confirmed.status_code == 200, confirmed.text
    restored = client.post(
        f"/api/v1/plans/{plan_id}/restore",
        json={"source_version": 1, "dispatcher_reference": "restore-test"},
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["version"] == 2
    assert restored.json()["state"] == "PROPOSED"
    assert restored.json()["validation"]["valid"] is True
    dispatch = client.post(
        f"/api/v1/plans/{plan_id}/dispatch",
        json={"version": 1, "confirmation": "MARK_DISPATCHED"},
    )
    assert dispatch.status_code == 403
    assert dispatch.json()["error"]["code"] == "DISPATCH_DISABLED"
