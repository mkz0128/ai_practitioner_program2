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


def test_urgent_insert_preview_keeps_current_version_immutable() -> None:
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
    dataset_id = imported.json()["dataset_id"]
    created = client.post(
        "/api/v1/plans",
        json={
            "dataset_id": dataset_id,
            "algorithm": "BASELINE",
            "route_provider_preference": "SIMULATED",
        },
    )
    assert created.status_code == 201, created.text
    plan_id = created.json()["plan_id"]
    preview = client.post(
        f"/api/v1/plans/{plan_id}/urgent-insert/preview",
        json={
            "base_plan_version": 1,
            "order": {
                "order_id": "ORD-041",
                "zone_code": "Z4",
                "city": "臺北市",
                "district": "信義",
                "location_label": "模擬臨時配送點 Z4-U1",
                "latitude": 25.033,
                "longitude": 121.565,
                "time_slot": "PM",
                "declared_package_count": 1,
                "priority": "HIGH",
                "note": "測試插單",
            },
            "packages": [{"package_id": "PKG-041-01", "order_id": "ORD-041", "weight_kg": 2.0}],
        },
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["preview_version"] == 2
    assert client.get(f"/api/v1/plans/{plan_id}").json()["version"] == 1
    assert client.get(f"/api/v1/plans/{plan_id}?version=2").json()["version"] == 2


def test_urgent_insert_accepts_arbitrary_structured_order_and_sequential_versions() -> None:
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
    plan_id = created.json()["plan_id"]

    def preview(order_id: str, version: int, weight: float = 1.5):
        return client.post(
            f"/api/v1/plans/{plan_id}/urgent-insert/preview",
            json={
                "base_plan_version": version,
                "order": {
                    "order_id": order_id,
                    "zone_code": "Z4",
                    "city": "臺北市",
                    "district": "信義",
                    "location_label": f"合成臨時點 {order_id}",
                    "latitude": 25.033,
                    "longitude": 121.565,
                    "time_slot": "PM",
                    "declared_package_count": 1,
                    "priority": "HIGH",
                },
                "packages": [
                    {"package_id": f"PKG-{order_id}", "order_id": order_id, "weight_kg": weight}
                ],
            },
        )

    first = preview("RND-URGENT-901", 1)
    assert first.status_code == 200, first.text
    assert first.json()["comparison"]["base_algorithm"] == "ORTOOLS"
    assert first.json()["diff"]["inserted_order_id"] == "RND-URGENT-901"
    confirmed = client.post(
        f"/api/v1/plans/{plan_id}/confirm",
        json={
            "version": first.json()["preview_version"],
            "confirmation": "CONFIRM_PLAN",
            "dispatcher_reference": "acceptance",
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    second = preview("RND-URGENT-902", confirmed.json()["version"])
    assert second.status_code == 200, second.text
    assert second.json()["base_version"] == confirmed.json()["version"]
    assert second.json()["comparison"]["base_algorithm"] == "ORTOOLS"
    assert client.get(f"/api/v1/plans/{plan_id}").json()["version"] == confirmed.json()["version"]


def test_agent_explanation_uses_structured_tool_evidence() -> None:
    plan = next(iter(store.plans.values()))[1]
    order_id = next(order_id for route in plan.plan.routes for order_id in route.order_ids)

    response = client.post(
        "/api/v1/agent/chat",
        json={
            "session_id": "SESSION-TEST",
            "message": "為什麼這張訂單這樣分配?",
            "context": {"plan_id": plan.plan_id, "plan_version": 1, "order_id": order_id},
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["evidence"][0]["tool"] == "explain_assignment"
    assert response.json()["evidence"][0]["data"]["order_id"] == order_id
