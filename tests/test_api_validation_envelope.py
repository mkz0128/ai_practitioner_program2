from pathlib import Path

from fastapi.testclient import TestClient

from src.api.main import app, store

SAMPLE_WORKBOOK = Path(__file__).parents[1] / "data" / "samples" / "demo-delivery-40-orders.xlsx"


def test_malformed_request_uses_field_level_manual_review_envelope() -> None:
    response = TestClient(app).post(
        "/api/v1/plans/PLAN-NOT-USED/urgent-insert/preview",
        json={"base_plan_version": 1, "order": {}, "packages": [{}]},
    )

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "FIELD_VALIDATION_ERROR"
    field_errors = body["error"]["field_errors"]
    assert field_errors
    assert all(error["requires_manual_review"] for error in field_errors)
    assert any(error["path"] == "order.order_id" for error in field_errors)
    assert any(error["path"] == "packages.0.package_id" for error in field_errors)
    assert all("input" not in error for error in field_errors)


def test_solver_edge_case_returns_unassignable_without_mutating_plan(monkeypatch) -> None:
    store.datasets.clear()
    store.plans.clear()
    store.current_versions.clear()
    client = TestClient(app)
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
    dataset_id = imported.json()["dataset_id"]
    created = client.post(
        "/api/v1/plans",
        json={
            "dataset_id": dataset_id,
            "algorithm": "ORTOOLS",
            "route_provider_preference": "SIMULATED",
        },
    )
    plan_id = created.json()["plan_id"]

    def raise_solver_error(*_args, **_kwargs):
        raise RuntimeError("synthetic solver edge case")

    monkeypatch.setattr("src.api.main.try_minimal_insert", raise_solver_error)
    response = client.post(
        f"/api/v1/plans/{plan_id}/urgent-insert/preview",
        json={
            "base_plan_version": 1,
            "order": {
                "order_id": "PUBLIC-SOLVER-EDGE",
                "zone_code": "Z4",
                "city": "臺北市",
                "district": "信義",
                "location_label": "合成錯誤處理點",
                "latitude": 25.033,
                "longitude": 121.565,
                "time_slot": "PM",
                "declared_package_count": 1,
                "priority": "HIGH",
            },
            "packages": [
                {
                    "package_id": "PUBLIC-SOLVER-EDGE-PKG",
                    "order_id": "PUBLIC-SOLVER-EDGE",
                    "weight_kg": 2.0,
                }
            ],
        },
    )

    assert response.status_code == 409
    body = response.json()
    assert body["error"]["code"] == "URGENT_INSERT_UNASSIGNABLE"
    assert body["error"]["details"]["reason"] == "PLANNER_NO_FEASIBLE_CANDIDATE"
    assert client.get(f"/api/v1/plans/{plan_id}").json()["version"] == 1
