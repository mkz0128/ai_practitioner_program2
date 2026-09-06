from dataclasses import replace
from pathlib import Path

from fastapi.testclient import TestClient

from src.agent.urgent_workflow import UrgentOrderDraft, UrgentUnderstanding
from src.api.main import app, store
from src.services.matrix import MatrixResult, _distance_m

SAMPLE_WORKBOOK = Path(__file__).parents[1] / "data" / "samples" / "demo-delivery-40-orders.xlsx"
client = TestClient(app)


def _base_plan() -> tuple[str, int]:
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


def _bundle(order_id: str, *, weight: float = 1.0, slot: str = "AM") -> dict:
    return {
        "order": {
            "order_id": order_id,
            "zone_code": "Z1",
            "city": "新北市",
            "district": "板橋",
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

    monkeypatch.setattr("src.api.main.understand_urgent_message", fake_understanding)
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

    monkeypatch.setattr("src.api.main.understand_urgent_message", fake_understanding)
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
            "orders": [_bundle("TMP-501"), _bundle("TMP-502")],
        },
    )
    assert response.status_code == 200, response.text
    assert calls == [(41, 43)]
    assert response.json()["matrix_elements_added"] == 168
