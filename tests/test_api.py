from pathlib import Path

from fastapi.testclient import TestClient

from src.api.main import app, store

SAMPLE_WORKBOOK = Path(__file__).parents[1] / "data" / "samples" / "demo-delivery-40-orders.xlsx"
client = TestClient(app)


def test_health_and_readiness_never_expose_credentials() -> None:
    health = client.get("/health")
    ready = client.get("/ready")

    assert health.status_code == 200
    assert health.json()["status"] == "ok"
    assert ready.status_code == 200
    assert "components" in ready.json()
    assert "api_key" not in ready.text.lower()


def test_import_create_and_lifecycle_for_simulated_plan() -> None:
    store.datasets.clear()
    store.plans.clear()
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
    assert imported.json()["counts"] == {"orders": 40, "packages": 80, "vehicles": 4, "zones": 5}

    created = client.post(
        "/api/v1/plans",
        json={
            "dataset_id": dataset_id,
            "algorithm": "BASELINE",
            "route_provider_preference": "SIMULATED",
        },
    )
    assert created.status_code == 201, created.text
    plan = created.json()
    assert plan["state"] == "PROPOSED"
    assert plan["validation"]["valid"] is True
    assert plan["summary"]["assigned_order_count"] + plan["summary"]["unassigned_order_count"] == 40

    plan_id = plan["plan_id"]
    confirmed = client.post(
        f"/api/v1/plans/{plan_id}/confirm",
        json={"version": 1, "confirmation": "CONFIRM_PLAN", "dispatcher_reference": "test"},
    )
    assert confirmed.status_code == 200
    dispatched = client.post(
        f"/api/v1/plans/{plan_id}/dispatch",
        json={"version": 1, "confirmation": "MARK_DISPATCHED"},
    )
    assert dispatched.status_code == 200
    assert dispatched.json()["state"] == "DISPATCHED"


def test_invalid_upload_uses_stable_error_envelope() -> None:
    response = client.post(
        "/api/v1/datasets/import-excel", files={"file": ("input.txt", b"not xlsx", "text/plain")}
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_FILE_TYPE"
    assert response.headers["X-Request-ID"] == response.json()["request_id"]
