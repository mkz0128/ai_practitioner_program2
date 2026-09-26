from dataclasses import replace
from pathlib import Path

from fastapi.testclient import TestClient

from src.api.main import app, store
from src.services.importer import parse_workbook
from src.services.matrix import SimulatedRouteProvider
from src.services.planner import build_ortools
from src.services.solve_scope import prioritize_remaining_order, route_progress

SAMPLE_WORKBOOK = Path(__file__).parents[1] / "data" / "samples" / "demo-delivery-40-orders.xlsx"
client = TestClient(app)


def _create_plan() -> tuple[str, dict, str, str]:
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
    created = client.post(
        "/api/v1/plans",
        json={
            "dataset_id": imported.json()["dataset_id"],
            "algorithm": "ORTOOLS",
            "route_provider_preference": "SIMULATED",
        },
    )
    assert created.status_code == 201, created.text
    dataset, report = parse_workbook(SAMPLE_WORKBOOK)
    assert dataset is not None and report.is_valid
    sample_order = next(order for order in dataset.orders if order.zone_code == "Z1")
    return created.json()["plan_id"], created.json(), sample_order.city, sample_order.district


def test_loaded_scope_freezes_assignments_and_reduces_urgent_options() -> None:
    plan_id, plan, city, district = _create_plan()
    assert plan["stage"] == "PRE_LOAD"
    assert plan["solve_scope"]["frozen_vehicle_assignments"] == []

    loaded = client.post(
        f"/api/v1/plans/{plan_id}/load",
        json={"version": 1, "confirmation": "START_LOADING", "dispatcher_reference": "test"},
    )
    assert loaded.status_code == 200, loaded.text
    loaded_body = loaded.json()
    assert loaded_body["state"] == "LOADED"
    assert loaded_body["stage"] == "LOADED"
    assert len(loaded_body["solve_scope"]["frozen_vehicle_assignments"]) == 40

    urgent = client.post(
        f"/api/v1/plans/{plan_id}/urgent-insert/batch-preview",
        json={
            "base_plan_version": 1,
            "orders": [
                {
                    "order": {
                        "order_id": "URG-SCOPE-01",
                        "zone_code": "Z1",
                            "city": city,
                            "district": district,
                        "location_label": "上車後示範點",
                        "latitude": 25.015,
                        "longitude": 121.46,
                        "time_slot": "MORNING",
                        "declared_package_count": 1,
                        "priority": "HIGH",
                    },
                    "packages": [
                        {
                            "package_id": "URG-SCOPE-01-PKG",
                            "order_id": "URG-SCOPE-01",
                            "weight_kg": 2,
                        }
                    ],
                }
            ],
        },
    )
    assert urgent.status_code == 200, urgent.text
    body = urgent.json()
    assert len(body["options"]) == 1
    assert body["options"][0]["cost"]["vehicle_change_count"] == 0
    assert body["options"][0]["diff"]["reassigned_orders"] == []

    # 上車後又來一張急單是這套系統本來就要處理的事,方案卡也給了【確認套用】。
    # 這顆按鈕按下去必須真的建立新版本,不能回 409——不然畫面在騙人。
    option = body["options"][0]
    confirmed = client.post(
        f"/api/v1/plans/{plan_id}/confirm",
        json={
            "version": option["preview_version"],
            "confirmation": "CONFIRM_PLAN",
            "dispatcher_reference": "test",
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    confirmed_body = confirmed.json()
    # 還在上車後,不能被降回 PROPOSED/CONFIRMED,不然接不下去模擬出發。
    assert confirmed_body["state"] == "LOADED"
    assert confirmed_body["stage"] == "LOADED"
    assigned = {
        order_id
        for route in confirmed_body["vehicles"]
        for order_id in [stop["order_id"] for stop in route["stops"]]
    }
    assert "URG-SCOPE-01" in assigned
    departed = client.post(
        f"/api/v1/plans/{plan_id}/simulate-departure",
        json={
            "version": confirmed_body["version"],
            "confirmation": "START_SIMULATED_DEPARTURE",
        },
    )
    assert departed.status_code == 200, departed.text


def test_loaded_stage_refuses_a_preview_that_moves_goods_off_a_loaded_vehicle() -> None:
    plan_id, _, _, _ = _create_plan()
    loaded = client.post(
        f"/api/v1/plans/{plan_id}/load",
        json={"version": 1, "confirmation": "START_LOADING", "dispatcher_reference": "test"},
    )
    assert loaded.status_code == 200, loaded.text
    current = store.get_plan(plan_id)
    assert current is not None

    # 偽造一個把某台車第一站搬走的版本:貨已經在車上,這種版本不能確認。
    moved = current.plan.model_copy(
        update={
            "routes": [
                route.model_copy(
                    update={"stops": route.stops[1:], "order_ids": route.order_ids[1:]}
                )
                if index == 0
                else route
                for index, route in enumerate(current.plan.routes)
            ]
        }
    )
    tampered = replace(current, version=current.version + 1, plan=moved)
    store.add_plan(tampered, make_current=False)

    refused = client.post(
        f"/api/v1/plans/{plan_id}/confirm",
        json={
            "version": tampered.version,
            "confirmation": "CONFIRM_PLAN",
            "dispatcher_reference": "test",
        },
    )
    assert refused.status_code == 409, refused.text
    assert refused.json()["error"]["code"] == "PLAN_NOT_CONFIRMABLE"


def test_dispatched_scope_exposes_deterministic_progress_and_remaining_reorder() -> None:
    plan_id, _, _, _ = _create_plan()
    loaded = client.post(
        f"/api/v1/plans/{plan_id}/load",
        json={"version": 1, "confirmation": "START_LOADING", "dispatcher_reference": "test"},
    )
    assert loaded.status_code == 200, loaded.text
    departed = client.post(
        f"/api/v1/plans/{plan_id}/simulate-departure",
        json={"version": 1, "confirmation": "START_SIMULATED_DEPARTURE"},
    )
    assert departed.status_code == 200, departed.text
    assert departed.json()["stage"] == "DISPATCHED"

    map_data = client.get(f"/api/v1/plans/{plan_id}/map-data?timeline_minutes=120")
    assert map_data.status_code == 200, map_data.text
    routes = map_data.json()["routes"]
    assert len(routes) == 4
    statuses = {stop["status"] for route in routes for stop in route["stops"]}
    assert "COMPLETED" in statuses
    assert "CURRENT" in statuses
    assert "UPCOMING" in statuses

    dataset, report = parse_workbook(SAMPLE_WORKBOOK)
    assert dataset is not None and report.is_valid
    matrix = SimulatedRouteProvider().build(dataset)
    base = build_ortools(dataset, matrix, time_limit_seconds=10, objective="BALANCED")
    progress = route_progress(base, 120)
    frozen = tuple(
        item["order_id"]
        for route in progress
        for item in route["stop_statuses"]
        if item["status"] == "COMPLETED"
    )
    candidate_route = next(route for route in base.routes if len(route.order_ids) >= 2)
    target = next(
        order_id for order_id in reversed(candidate_route.order_ids) if order_id not in frozen
    )
    preview = prioritize_remaining_order(base, dataset, matrix, target, frozen)
    assert preview is not None
    before_prefix = [order_id for order_id in candidate_route.order_ids if order_id in frozen]
    after_route = next(
        route for route in preview.routes if route.vehicle_id == candidate_route.vehicle_id
    )
    assert after_route.order_ids[: len(before_prefix)] == before_prefix
