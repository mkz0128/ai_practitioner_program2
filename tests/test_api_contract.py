import re
from pathlib import Path

from fastapi.testclient import TestClient

from src.api.main import app, store
from src.services.importer import parse_workbook

SAMPLE_WORKBOOK = Path(__file__).parents[1] / "data" / "samples" / "demo-delivery-40-orders.xlsx"
CONTRACT = Path(__file__).parents[1] / "docs" / "api-contract.md"
client = TestClient(app)


def _contract_endpoints() -> set[tuple[str, str]]:
    matches = re.findall(
        r"### `(?P<method>GET|POST) (?P<path>/[^`]+)`", CONTRACT.read_text(encoding="utf-8")
    )
    return {(method, path) for method, path in matches}


def _implemented_endpoints() -> set[tuple[str, str]]:
    endpoints: set[tuple[str, str]] = set()
    for route in app.routes:
        path = getattr(route, "path", None)
        methods = getattr(route, "methods", set())
        if isinstance(path, str):
            endpoints.update((method, path) for method in methods if method in {"GET", "POST"})
    return endpoints


def test_api_contract_is_fully_implemented() -> None:
    declared = _contract_endpoints()
    implemented = _implemented_endpoints()
    assert len(declared) == 13
    assert declared <= implemented
    assert len(implemented & declared) == len(declared)


def test_every_contract_endpoint_has_an_exercised_response() -> None:
    store.datasets.clear()
    store.plans.clear()
    store.current_versions.clear()
    outcomes: dict[tuple[str, str], int] = {}

    status_paths = [("GET", "/health"), ("GET", "/ready"), ("GET", "/api/v1/providers/status")]
    for method, path in status_paths:
        response = client.request(method, path)
        outcomes[(method, path)] = response.status_code
        assert response.status_code == 200

    invalid = client.post(
        "/api/v1/datasets/import-excel",
        files={"file": ("not-supported.txt", b"invalid", "text/plain")},
    )
    outcomes[("POST", "/api/v1/datasets/import-excel")] = invalid.status_code
    assert invalid.status_code == 400

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
    for path in [f"/api/v1/datasets/{dataset_id}", f"/api/v1/datasets/{dataset_id}/validation"]:
        response = client.get(path)
        assert response.status_code == 200
    outcomes[("GET", "/api/v1/datasets/{dataset_id}")] = 200
    outcomes[("GET", "/api/v1/datasets/{dataset_id}/validation")] = 200

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
    order_id = created.json()["vehicles"][0]["stops"][0]["order_id"]
    plan_paths = [
        ("GET", f"/api/v1/plans/{plan_id}"),
        ("GET", f"/api/v1/plans/{plan_id}/map-data"),
    ]
    for method, path in plan_paths:
        response = client.request(method, path)
        assert response.status_code == 200, response.text
    outcomes[("POST", "/api/v1/plans")] = created.status_code
    outcomes[("GET", "/api/v1/plans/{plan_id}")] = 200
    outcomes[("GET", "/api/v1/plans/{plan_id}/map-data")] = 200
    preview = client.post(
        f"/api/v1/plans/{plan_id}/urgent-insert/preview",
        json={
            "base_plan_version": 1,
            "order": {
                "order_id": "ORD-CONTRACT-041",
                "zone_code": "Z4",
                "city": z4_order.city,
                "district": z4_order.district,
                "location_label": "contract preview",
                "latitude": 25.033,
                "longitude": 121.565,
                "time_slot": "PM",
                "declared_package_count": 1,
                "priority": "HIGH",
            },
            "packages": [
                {
                    "package_id": "PKG-CONTRACT-041",
                    "order_id": "ORD-CONTRACT-041",
                    "weight_kg": 2.0,
                }
            ],
        },
    )
    assert preview.status_code == 200, preview.text
    outcomes[("POST", "/api/v1/plans/{plan_id}/urgent-insert/preview")] = preview.status_code
    chat = client.post(
        "/api/v1/agent/chat",
        json={
            "session_id": "CONTRACT-SESSION",
            "message": "Explain this assignment.",
            "context": {"plan_id": plan_id, "plan_version": 1, "order_id": order_id},
        },
    )
    assert chat.status_code in {200, 503}, chat.text
    outcomes[("POST", "/api/v1/agent/chat")] = chat.status_code

    for method, path, payload in [
        (
            "POST",
            f"/api/v1/plans/{plan_id}/confirm",
            {"version": 99, "confirmation": "CONFIRM_PLAN"},
        ),
        (
            "POST",
            f"/api/v1/plans/{plan_id}/dispatch",
            {"version": 99, "confirmation": "MARK_DISPATCHED"},
        ),
    ]:
        response = client.request(method, path, json=payload)
        assert response.status_code in {404, 409, 422}, response.text
    outcomes[("POST", "/api/v1/plans/{plan_id}/confirm")] = 404
    outcomes[("POST", "/api/v1/plans/{plan_id}/dispatch")] = 404

    assert len(outcomes) == 13
