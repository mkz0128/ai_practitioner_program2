from pathlib import Path

from fastapi.testclient import TestClient

from src.api.main import app, store
from src.providers.google_routes import GoogleRoutesProvider
from src.services.importer import parse_workbook

SAMPLE_WORKBOOK = Path(__file__).parents[1] / "data" / "samples" / "demo-delivery-40-orders.xlsx"
client = TestClient(app)


def test_demo_40_order_flow_stops_before_dispatch() -> None:
    store.datasets.clear()
    store.plans.clear()
    store.current_versions.clear()
    fixture_dataset, fixture_report = parse_workbook(SAMPLE_WORKBOOK)
    assert fixture_report.is_valid and fixture_dataset is not None
    z4_order = next(order for order in fixture_dataset.orders if order.zone_code == "Z4")

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
    assert imported.json()["counts"] == {
        "orders": 40,
        "packages": 80,
        "vehicles": 4,
        "zones": 5,
    }
    assert client.get(f"/api/v1/datasets/{dataset_id}/validation").json()["validation"]["is_valid"]

    initial = client.post(
        "/api/v1/plans",
        json={
            "dataset_id": dataset_id,
            "algorithm": "ORTOOLS",
            "route_provider_preference": "SIMULATED",
        },
    )
    assert initial.status_code == 201, initial.text
    plan = initial.json()
    assert plan["algorithm"] == "ORTOOLS"
    assert plan["summary"]["assigned_order_count"] == 40
    assert plan["summary"]["assigned_weight_kg"] == 365
    assert plan["summary"]["unassigned_orders"] == []
    assert [vehicle["planned_load_kg"] for vehicle in plan["vehicles"]] == [93.0, 97.0, 152.0, 23.0]
    assert plan["validation"]["valid"] is True
    plan_id = plan["plan_id"]
    order_id = next(
        vehicle["stops"][0]["order_id"] for vehicle in plan["vehicles"] if vehicle["stops"]
    )

    map_data = client.get(f"/api/v1/plans/{plan_id}/map-data")
    assert map_data.status_code == 200
    assert map_data.json()["provider_mode"] == "SIMULATED"

    google_fallback = GoogleRoutesProvider(None).build(fixture_dataset)
    assert google_fallback.provider_mode == "SIMULATED"
    assert google_fallback.warning == "GOOGLE_KEY_MISSING"

    explanation = client.post(
        "/api/v1/agent/chat",
        json={
            "session_id": "DEMO-SESSION",
            "message": "Explain this assignment using evidence.",
            "context": {"plan_id": plan_id, "plan_version": 1, "order_id": order_id},
        },
    )
    assert explanation.status_code in {200, 503}, explanation.text
    if explanation.status_code == 200:
        assert explanation.json()["evidence"][0]["tool"] == "explain_assignment"

    confirmed = client.post(
        f"/api/v1/plans/{plan_id}/confirm",
        json={"version": 1, "confirmation": "CONFIRM_PLAN", "dispatcher_reference": "demo"},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["state"] == "CONFIRMED"

    preview = client.post(
        f"/api/v1/plans/{plan_id}/urgent-insert/preview",
        json={
            "base_plan_version": 1,
            "order": {
                "order_id": "ORD-041",
                "zone_code": "Z4",
                "city": z4_order.city,
                "district": z4_order.district,
                "location_label": "Demo urgent stop",
                "latitude": 25.033,
                "longitude": 121.565,
                "time_slot": "PM",
                "declared_package_count": 1,
                "priority": "HIGH",
                "note": "preview only",
            },
            "packages": [{"package_id": "PKG-041-01", "order_id": "ORD-041", "weight_kg": 2.0}],
        },
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["preview_version"] == 2
    assert body["after"]["assigned_order_count"] + body["after"]["unassigned_order_count"] == 41
    assert body["diff"]["inserted_order_id"] == "ORD-041"
    assert body["before"]["algorithm"] == "ORTOOLS"
    assert body["before"]["dataset_hash"] == plan["dataset_hash"]
    assert body["before"]["assigned_weight_kg"] == 365
    assert body["before"]["unassigned_orders"] == []
    assert [vehicle["planned_load_kg"] for vehicle in body["before"]["vehicles"]] == [
        93.0,
        97.0,
        152.0,
        23.0,
    ]
    assert body["after"]["algorithm"] == "ORTOOLS"
    assert body["comparison"]["base_algorithm"] == body["comparison"]["preview_algorithm"]
    assert body["mode"] == "MINIMAL_CHANGE"
    assert body["affected_vehicle_count"] == 1
    assert body["moved_order_count"] == 0
    assert body["diff"]["sequence_changes"], body
    assert body["diff"]["vehicle_load_changes"], body
    assert any(
        change["delta_load_kg"] != 0 for change in body["diff"]["vehicle_load_changes"]
    )
    assert isinstance(body["diff"]["total_distance_delta_m"], int)
    assert isinstance(body["diff"]["total_duration_delta_s"], int)
    assert client.get(f"/api/v1/plans/{plan_id}").json()["version"] == 1
    assert client.get(f"/api/v1/plans/{plan_id}").json()["state"] == "CONFIRMED"
