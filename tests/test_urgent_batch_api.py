from dataclasses import replace
from datetime import datetime
from pathlib import Path

from fastapi import Request
from fastapi.testclient import TestClient

from src.agent.runtime import DispatchAgentContext
from src.agent.urgent_workflow import (
    URGENT_PREVIEW_REQUIRED_FIELDS,
    UrgentOrderDraft,
    UrgentUnderstanding,
    missing_fields,
)
from src.api.main import (
    UrgentOrderBundleRequest,
    UrgentOrderRequest,
    _urgent_insert_preview_response,
    agent_sessions,
    app,
    store,
)
from src.domain.models import Order, Package, Priority
from src.services.importer import parse_workbook
from src.services.matrix import MatrixResult, SimulatedRouteProvider, _distance_m
from src.services.planner import build_ortools
from src.services.urgent_options import build_urgent_options, count_reordered_orders

SAMPLE_WORKBOOK = Path(__file__).parents[1] / "data" / "samples" / "demo-delivery-40-orders.xlsx"
RELAXED_WORKBOOK = Path(__file__).parents[1] / "data" / "samples" / "demo-50-relaxed.xlsx"
TIGHT_WORKBOOK = Path(__file__).parents[1] / "data" / "samples" / "demo-50-tight.xlsx"
client = TestClient(app)


def _base_plan(workbook_path: Path = SAMPLE_WORKBOOK) -> tuple[str, int]:
    store.datasets.clear()
    store.plans.clear()
    store.current_versions.clear()
    with workbook_path.open("rb") as workbook:
        imported = client.post(
            "/api/v1/datasets/import-excel",
            files={
                "file": (
                    workbook_path.name,
                    workbook,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
    created = client.post(
        "/api/v1/plans",
        json={
            "dataset_id": imported.json()["dataset_id"],
            "algorithm": "ORTOOLS",
            "route_provider_preference": "SIMULATED",
        },
    )
    assert created.status_code == 201, created.text
    return created.json()["plan_id"], created.json()["version"]


def _bundle(
    order_id: str,
    *,
    weight: float = 1.0,
    slot: str = "AM",
    zone_code: str = "Z1",
    city: str = "新北市",
    district: str = "板橋",
) -> dict:
    return {
        "order": {
            "order_id": order_id,
            "zone_code": zone_code,
            "city": city,
            "district": district,
            "location_label": f"合成測試點 {order_id}",
            "latitude": 25.0114,
            "longitude": 121.4618,
            "time_slot": slot,
            "declared_package_count": 1,
            "priority": "HIGH",
        },
        "packages": [
            {"package_id": f"PKG-{order_id}-01", "order_id": order_id, "weight_kg": weight}
        ],
    }


def test_batch_preview_inserts_multiple_orders_in_one_immutable_version() -> None:
    plan_id, version = _base_plan()
    response = client.post(
        f"/api/v1/plans/{plan_id}/urgent-insert/batch-preview",
        json={
            "base_plan_version": version,
            "orders": [_bundle("TMP-201"), _bundle("TMP-202")],
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["base_version"] == version
    assert body["preview_version"] == version + 1
    assert body["diff"]["inserted_order_ids"] == ["TMP-201", "TMP-202"]
    assert {item["order_id"] for item in body["inserted_orders"]} == {"TMP-201", "TMP-202"}
    assert all(item["status"] == "ASSIGNED" for item in body["inserted_orders"])
    assert body["validator"]["valid"] is True
    assert client.get(f"/api/v1/plans/{plan_id}").json()["version"] == version


def test_batch_preview_returns_pareto_feasible_costed_options() -> None:
    plan_id, version = _base_plan()
    response = client.post(
        f"/api/v1/plans/{plan_id}/urgent-insert/batch-preview",
        json={"base_plan_version": version, "orders": [_bundle("TMP-OPTIONS")]},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    options = body["options"]
    assert 1 <= len(options) <= 4
    assert all(option["feasible"] is True for option in options)
    assert all(option["selectable"] is True for option in options)
    assert all(option["validator"]["valid"] is True for option in options)
    assert all(option["mode"] in {"INSERTION", "ROUTE_REORDER"} for option in options)
    assert all("FULL_REPLAN" not in option["mode"] for option in options)
    assert all(option["cost"]["distance_delta_m"] >= 0 for option in options)
    assert all(option["cost"]["duration_delta_s"] >= 0 for option in options)
    assert all(option["cost"]["vehicle_change_count"] <= 3 for option in options)
    assert all(option["inserted_orders"][0]["status"] == "ASSIGNED" for option in options)
    assert all(
        set(option["cost"]) == {
            "distance_delta_m",
            "distance_delta_km",
            "duration_delta_s",
            "duration_delta_min",
            "vehicle_change_count",
            "minimum_capacity_slack_kg",
        }
        for option in options
    )
    assert len({option["preview_version"] for option in options}) == len(options)
    assert client.get(f"/api/v1/plans/{plan_id}").json()["version"] == version


def test_single_preview_returns_only_non_dominated_local_options() -> None:
    plan_id, version = _base_plan(RELAXED_WORKBOOK)
    response = client.post(
        f"/api/v1/plans/{plan_id}/urgent-insert/batch-preview",
        json={
            "base_plan_version": version,
            "orders": [
                _bundle(
                    "URG-DEMO-041",
                    zone_code="Z4",
                    city="新北市",
                    district="板橋",
                )
            ],
        },
    )
    assert response.status_code == 200, response.text
    options = response.json()["options"]
    assert 1 <= len(options) <= 3
    assert all(option["mode"] in {"INSERTION", "ROUTE_REORDER"} for option in options)
    assert all(option["cost"]["distance_delta_m"] >= 0 for option in options)
    assert all(option["cost"]["duration_delta_s"] >= 0 for option in options)
    assert all(option["cost"]["vehicle_change_count"] <= 3 for option in options)


def test_missing_fields_match_urgent_preview_required_fields() -> None:
    preview_required = {
        field_name
        for field_name, field_info in UrgentOrderRequest.model_fields.items()
        if field_info.is_required()
    } | {"package_weight_kg"}

    assert set(URGENT_PREVIEW_REQUIRED_FIELDS) == preview_required
    assert set(missing_fields(UrgentOrderDraft())) == preview_required


def test_tight_insert_options_offer_a_different_vehicle_placement() -> None:
    dataset, report = parse_workbook(TIGHT_WORKBOOK)
    assert dataset is not None and report.is_valid
    matrix = SimulatedRouteProvider().build(dataset)
    base_plan = build_ortools(dataset, matrix, time_limit_seconds=10, objective="BALANCED")
    pending = Order(
        order_id="URG-TIGHT-001",
        zone_code="Z3",
        city="臺北市",
        district="信義",
        location_label="大安信義交界緊急站",
        latitude=25.040,
        longitude=121.560,
        time_slot="MORNING",
        declared_package_count=1,
        priority=Priority.HIGH,
        packages=(
            Package(
                package_id="PKG-URG-TIGHT-001-01",
                order_id="URG-TIGHT-001",
                weight_kg=2.0,
            ),
        ),
    )
    preview_dataset = dataset.model_copy(
        update={
            "orders": (*dataset.orders, pending),
            "packages": (*dataset.packages, *pending.packages),
        }
    )
    preview_matrix = SimulatedRouteProvider().build(preview_dataset)
    options = build_urgent_options(
        base_plan,
        preview_dataset,
        preview_matrix,
        time_limit_seconds=10,
        incoming_order_ids=[pending.order_id],
    )
    assert len(options) >= 2
    assert len({option.vehicle_id for option in options}) >= 2
    insertion_options = [option for option in options if option.mode == "INSERTION"]
    placements = {
        (option.vehicle_id, option.insertion_sequence) for option in insertion_options
    }
    assert len(placements) == len(insertion_options)


def test_tight_ord101_options_have_a_meaningful_distance_tradeoff() -> None:
    dataset, report = parse_workbook(TIGHT_WORKBOOK)
    assert dataset is not None and report.is_valid
    matrix = SimulatedRouteProvider().build(dataset)
    base_plan = build_ortools(dataset, matrix, time_limit_seconds=10, objective="BALANCED")
    pending = Order(
        order_id="ORD-101",
        zone_code="Z3",
        city="臺北市",
        district="信義",
        location_label="大安信義交界示範配送點 Z3-51",
        latitude=25.040,
        longitude=121.560,
        time_slot="MORNING",
        declared_package_count=1,
        priority=Priority.HIGH,
        packages=(
            Package(
                package_id="PKG-ORD-101-01",
                order_id="ORD-101",
                weight_kg=15.0,
            ),
        ),
    )
    preview_dataset = dataset.model_copy(
        update={
            "orders": (*dataset.orders, pending),
            "packages": (*dataset.packages, *pending.packages),
        }
    )
    preview_matrix = SimulatedRouteProvider().build(preview_dataset)
    options = build_urgent_options(
        base_plan,
        preview_dataset,
        preview_matrix,
        time_limit_seconds=10,
        incoming_order_ids=[pending.order_id],
    )
    costs = [option.diff["total_distance_delta_m"] for option in options]
    assert len(options) >= 2
    assert max(costs) - min(costs) > 3_000
    assert all(cost >= 0 for cost in costs)


def test_urgent_options_do_not_include_a_fully_dominated_candidate() -> None:
    dataset, report = parse_workbook(RELAXED_WORKBOOK)
    assert dataset is not None and report.is_valid
    matrix = SimulatedRouteProvider().build(dataset)
    base_plan = build_ortools(dataset, matrix, time_limit_seconds=10, objective="BALANCED")
    pending = Order(
        order_id="ORD-101",
        zone_code="Z3",
        city="臺北市",
        district="信義",
        location_label="大安信義交界示範配送點 Z3-51",
        latitude=25.040,
        longitude=121.560,
        time_slot="MORNING",
        declared_package_count=1,
        priority=Priority.HIGH,
        packages=(
            Package(
                package_id="PKG-ORD-101-01",
                order_id="ORD-101",
                weight_kg=15.0,
            ),
        ),
    )
    preview_dataset = dataset.model_copy(
        update={
            "orders": (*dataset.orders, pending),
            "packages": (*dataset.packages, *pending.packages),
        }
    )
    preview_matrix = SimulatedRouteProvider().build(preview_dataset)
    options = build_urgent_options(
        base_plan,
        preview_dataset,
        preview_matrix,
        time_limit_seconds=10,
        incoming_order_ids=[pending.order_id],
    )

    def cost_vector(option):
        stop = next(
            stop
            for route in option.plan.routes
            for stop in route.stops
            if stop.order_id == pending.order_id
        )
        return (
            option.diff["total_distance_delta_m"],
            option.diff["total_duration_delta_s"],
            len(option.diff["reassigned_orders"]),
            count_reordered_orders(base_plan, option.plan, {pending.order_id}),
            datetime.fromisoformat(stop.eta).timestamp(),
        )

    vectors = [cost_vector(option) for option in options]
    for left_index, left in enumerate(vectors):
        for right_index, right in enumerate(vectors):
            if left_index == right_index:
                continue
            assert not (
                all(
                    left_value >= right_value
                    for left_value, right_value in zip(left, right, strict=True)
                )
                and any(
                    left_value > right_value
                    for left_value, right_value in zip(left, right, strict=True)
                )
            )


def test_unassignable_batch_can_be_rendered_as_non_selectable_option() -> None:
    plan_id, version = _base_plan()
    record = store.get_plan(plan_id, version)
    assert record is not None
    heavy = _bundle("TMP-HEAVY", weight=500.0)
    response = _urgent_insert_preview_response(
        plan_id,
        version,
        [
            UrgentOrderBundleRequest(
                order=UrgentOrderRequest.model_validate(heavy["order"]),
                packages=[Package.model_validate(item) for item in heavy["packages"]],
            )
        ],
        Request(scope={"type": "http", "method": "POST", "path": "/test"}),
        include_unassignable_option=True,
    )
    assert isinstance(response, dict)
    assert response["feasible"] is False
    assert response["options"][0]["selectable"] is False
    assert response["options"][0]["unassigned_orders"] == ["TMP-HEAVY"]
    assert client.get(f"/api/v1/plans/{plan_id}").json()["version"] == version


def test_batch_preview_rejects_duplicate_id_without_new_version() -> None:
    plan_id, version = _base_plan()
    response = client.post(
        f"/api/v1/plans/{plan_id}/urgent-insert/batch-preview",
        json={
            "base_plan_version": version,
            "orders": [_bundle("TMP-201"), _bundle("TMP-201")],
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "URGENT_ORDER_DUPLICATE"
    assert client.get(f"/api/v1/plans/{plan_id}").json()["version"] == version


def test_batch_preview_rejects_unassignable_order_without_polluting_plan() -> None:
    plan_id, version = _base_plan()
    response = client.post(
        f"/api/v1/plans/{plan_id}/urgent-insert/batch-preview",
        json={
            "base_plan_version": version,
            "orders": [_bundle("TMP-HEAVY", weight=500.0)],
        },
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "URGENT_INSERT_UNASSIGNABLE"
    assert response.json()["error"]["details"]["unassigned_reasons"] == {
        "TMP-HEAVY": "CAPACITY_LIMIT"
    }
    assert client.get(f"/api/v1/plans/{plan_id}").json()["version"] == version


def test_batch_preview_reports_time_or_route_conflict_without_polluting_plan(monkeypatch) -> None:
    plan_id, version = _base_plan()
    record = store.get_plan(plan_id, version)
    assert record is not None
    size = len(record.matrix.node_ids)
    record.matrix = MatrixResult(
        node_ids=record.matrix.node_ids,
        distance_m=tuple(
            tuple(0 if row == col else 1000 for col in range(size))
            for row in range(size)
        ),
        duration_s=tuple(
            tuple(0 if row == col else 50_000 for col in range(size))
            for row in range(size)
        ),
        provider_mode="SIMULATED",
        matrix_version="time-conflict-test",
    )

    def time_conflict_matrix(dataset):
        node_ids = (
            "DEPOT-001",
            *(
                order.order_id
                for order in sorted(dataset.orders, key=lambda item: item.order_id)
            ),
        )
        matrix_size = len(node_ids)
        return MatrixResult(
            node_ids=node_ids,
            distance_m=tuple(
                tuple(0 if row == col else 1000 for col in range(matrix_size))
                for row in range(matrix_size)
            ),
            duration_s=tuple(
                tuple(0 if row == col else 50_000 for col in range(matrix_size))
                for row in range(matrix_size)
            ),
            provider_mode="SIMULATED",
            matrix_version="time-conflict-test",
        )

    monkeypatch.setattr(
        "src.api.main.SimulatedRouteProvider.build",
        lambda self, dataset: time_conflict_matrix(dataset),
    )
    response = client.post(
        f"/api/v1/plans/{plan_id}/urgent-insert/batch-preview",
        json={"base_plan_version": version, "orders": [_bundle("TMP-LATE", weight=1.0)]},
    )
    assert response.status_code == 409
    assert response.json()["error"]["details"]["unassigned_reasons"] == {
        "TMP-LATE": "TIME_OR_ROUTE_CONFLICT"
    }
    assert client.get(f"/api/v1/plans/{plan_id}").json()["version"] == version


def test_agent_urgent_state_machine_reviews_then_previews_once(monkeypatch) -> None:
    plan_id, version = _base_plan()
    outputs = [
        UrgentUnderstanding(
            is_urgent_insertion=True,
            action="ADD_OR_UPDATE",
            orders=[
                UrgentOrderDraft(
                    order_id="TMP-301",
                    zone_code="Z1",
                    city="新北市",
                    district="板橋",
                    location_label="合成測試點 TMP-301",
                    latitude=25.0114,
                    longitude=121.4618,
                    time_slot="AM",
                    declared_package_count=1,
                    package_weight_kg=1.0,
                    priority="HIGH",
                )
            ],
        ),
        UrgentUnderstanding(is_urgent_insertion=True, action="PREVIEW"),
    ]

    async def fake_understanding(message, state):
        return outputs.pop(0), object()

    async def fake_dispatch_agent(message, dataset, matrix, **kwargs):
        first_understanding = outputs.pop(0)
        context = DispatchAgentContext(
            dataset=dataset,
            matrix=matrix,
            current_user_message=message,
            plan=kwargs.get("plan"),
        )
        context.budget.total_tokens = 1
        context.evidence.append(
            {
                "tool": "begin_urgent_insertion",
                "action": first_understanding.action,
                "orders": [
                    order.model_dump(mode="json") for order in first_understanding.orders
                ],
            }
        )
        return "已收到臨時訂單資料。", context, object()

    monkeypatch.setattr("src.api.main.understand_urgent_message", fake_understanding)
    monkeypatch.setattr("src.api.main.run_dispatch_agent", fake_dispatch_agent)
    monkeypatch.setattr("src.api.main.settings.openai_api_key", "configured-for-test")
    first = client.post(
        "/api/v1/agent/chat",
        json={
            "session_id": "URGENT-STATE-301",
            "message": "臨時多一張配送單",
            "context": {"plan_id": plan_id, "plan_version": version},
        },
    )
    assert first.status_code == 200, first.text
    assert first.json()["evidence"][0]["data"]["stage"] == "REVIEW_READY"
    assert max(store.plans[plan_id]) == version

    second = client.post(
        "/api/v1/agent/chat",
        json={
            "session_id": "URGENT-STATE-301",
            "message": "產生插單預覽",
            "context": {"plan_id": plan_id, "plan_version": version},
        },
    )
    assert second.status_code == 200, second.text
    evidence = second.json()["evidence"][0]["data"]
    assert evidence["stage"] == "PREVIEW_READY"
    assert evidence["preview"]["diff"]["inserted_order_ids"] == ["TMP-301"]
    assert client.get(f"/api/v1/plans/{plan_id}").json()["version"] == version


def test_agent_urgent_state_machine_reports_missing_fields_per_order(monkeypatch) -> None:
    plan_id, version = _base_plan()

    async def fake_understanding(message, state):
        return (
            UrgentUnderstanding(
                is_urgent_insertion=True,
                action="ADD_OR_UPDATE",
                orders=[
                    UrgentOrderDraft(order_id="TMP-401"),
                    UrgentOrderDraft(
                        order_id="TMP-402",
                        zone_code="Z1",
                        city="新北市",
                        district="板橋",
                        location_label="合成測試點 TMP-402",
                        latitude=25.0114,
                        longitude=121.4618,
                        time_slot="AM",
                        declared_package_count=1,
                        package_weight_kg=1.0,
                        priority="HIGH",
                    ),
                ],
            ),
            object(),
            )

    first_understanding = (
        UrgentUnderstanding(
            is_urgent_insertion=True,
            action="ADD_OR_UPDATE",
            orders=[
                UrgentOrderDraft(order_id="TMP-401"),
                UrgentOrderDraft(
                    order_id="TMP-402",
                    zone_code="Z1",
                    city="新北市",
                    district="板橋",
                    location_label="合成測試點 TMP-402",
                    latitude=25.0114,
                    longitude=121.4618,
                    time_slot="AM",
                    declared_package_count=1,
                    package_weight_kg=1.0,
                    priority="HIGH",
                ),
            ],
        )
    )

    async def fake_dispatch_agent(message, dataset, matrix, **kwargs):
        context = DispatchAgentContext(
            dataset=dataset,
            matrix=matrix,
            current_user_message=message,
            plan=kwargs.get("plan"),
        )
        context.budget.total_tokens = 1
        context.evidence.append(
            {
                "tool": "begin_urgent_insertion",
                "action": first_understanding.action,
                "orders": [
                    order.model_dump(mode="json") for order in first_understanding.orders
                ],
            }
        )
        return "已收到臨時訂單資料。", context, object()

    monkeypatch.setattr("src.api.main.understand_urgent_message", fake_understanding)
    monkeypatch.setattr("src.api.main.run_dispatch_agent", fake_dispatch_agent)
    monkeypatch.setattr("src.api.main.settings.openai_api_key", "configured-for-test")
    response = client.post(
        "/api/v1/agent/chat",
        json={
            "session_id": "URGENT-MISSING-401",
            "message": "一次新增這兩張單",
            "context": {"plan_id": plan_id, "plan_version": version},
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()["evidence"][0]["data"]
    assert data["stage"] == "COLLECTING"
    assert data["missing_by_order"][0]["order_ref"] == "TMP-401"
    assert "TMP-402" not in response.json()["message"]
    assert max(store.plans[plan_id]) == version


def test_preview_validation_keeps_urgent_context_for_followup(monkeypatch) -> None:
    plan_id, version = _base_plan(RELAXED_WORKBOOK)
    session_id = "URGENT-VALIDATION-CONTEXT"
    outputs = [
        UrgentUnderstanding(
            is_urgent_insertion=True,
            action="ADD_OR_UPDATE",
            orders=[
                UrgentOrderDraft(
                    order_id="TMP-VALIDATION-501",
                    zone_code="Z4",
                    city="臺北市",
                    district="內湖",
                    location_label="測試配送點 TMP-VALIDATION-501",
                    latitude=25.033,
                    longitude=121.565,
                    time_slot="MORNING",
                    declared_package_count=1,
                    package_weight_kg=1.0,
                )
            ],
        ),
        UrgentUnderstanding(is_urgent_insertion=True, action="PREVIEW"),
        UrgentUnderstanding(
            is_urgent_insertion=True,
            action="ADD_OR_UPDATE",
            orders=[UrgentOrderDraft(district="信義")],
        ),
    ]

    async def fake_understanding(message, state):
        return outputs.pop(0), object()

    async def fake_dispatch_agent(message, dataset, matrix, **kwargs):
        first_understanding = outputs.pop(0)
        context = DispatchAgentContext(
            dataset=dataset,
            matrix=matrix,
            current_user_message=message,
            plan=kwargs.get("plan"),
        )
        context.budget.total_tokens = 1
        context.evidence.append(
            {
                "tool": "begin_urgent_insertion",
                "action": first_understanding.action,
                "orders": [
                    order.model_dump(mode="json") for order in first_understanding.orders
                ],
            }
        )
        return "已收到臨時訂單資料。", context, object()

    monkeypatch.setattr("src.api.main.understand_urgent_message", fake_understanding)
    monkeypatch.setattr("src.api.main.run_dispatch_agent", fake_dispatch_agent)
    monkeypatch.setattr("src.api.main.settings.openai_api_key", "configured-for-test")
    context = {"plan_id": plan_id, "plan_version": version}

    summary = client.post(
        "/api/v1/agent/chat",
        json={"session_id": session_id, "message": "新增一張臨時配送單", "context": context},
    )
    assert summary.status_code == 200, summary.text
    assert summary.json()["evidence"][0]["data"]["stage"] == "REVIEW_READY"

    failed_preview = client.post(
        "/api/v1/agent/chat",
        json={"session_id": session_id, "message": "產生插單預覽", "context": context},
    )
    assert failed_preview.status_code == 422, failed_preview.text
    assert failed_preview.json()["error"]["code"] == "URGENT_ORDER_INVALID"
    assert agent_sessions[session_id].urgent_workflow["stage"] == "REVIEW_READY"

    corrected = client.post(
        "/api/v1/agent/chat",
        json={"session_id": session_id, "message": "行政區是信義", "context": context},
    )
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["evidence"][0]["data"]["stage"] == "REVIEW_READY"
    assert "我記下來了，確認一下" in corrected.json()["message"]


def test_google_batch_preview_reuses_base_matrix_and_only_extends_new_nodes(monkeypatch) -> None:
    plan_id, version = _base_plan()
    record = store.get_plan(plan_id, version)
    assert record is not None
    record.matrix = replace(
        record.matrix, provider_mode="GOOGLE", matrix_version="google-routes-v1"
    )
    calls: list[tuple[int, int]] = []

    def fake_extend(
        self, base_matrix, base_node_ids, base_coordinates, node_ids, coordinates, **kw
    ):
        calls.append((len(base_node_ids), len(node_ids)))
        distances = tuple(
            tuple(
                0 if origin == target else _distance_m(*origin, *target)
                for target in coordinates
            )
            for origin in coordinates
        )
        durations = tuple(
            tuple(0 if distance == 0 else max(60, round(distance / 8)) for distance in row)
            for row in distances
        )
        return MatrixResult(
            node_ids=node_ids,
            distance_m=distances,
            duration_s=durations,
            provider_mode="GOOGLE",
            matrix_version="google-routes-v1",
        )

    def forbid_full_build(*args, **kwargs):
        raise AssertionError("batch preview must not rebuild the full matrix")

    monkeypatch.setattr("src.api.main.GoogleRoutesProvider.extend_matrix", fake_extend)
    monkeypatch.setattr("src.api.main.GoogleRoutesProvider.build", forbid_full_build)
    response = client.post(
        f"/api/v1/plans/{plan_id}/urgent-insert/batch-preview",
        json={
            "base_plan_version": version,
            "orders": [
                _bundle("TMP-501"),
                _bundle("TMP-502"),
            ],
        },
    )
    assert response.status_code == 200, response.text
    assert calls == [(41, 43)]
    assert response.json()["matrix_elements_added"] == 168
