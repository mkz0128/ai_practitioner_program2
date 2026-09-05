from dataclasses import replace
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from src.api import main as api_main
from src.api.main import app, store
from src.providers.google_routes import GoogleRoutesProvider, GoogleRoutesProviderError
from src.providers.tdx import TDXProvider
from src.services.matrix import SimulatedRouteProvider

SAMPLE_WORKBOOK = Path(__file__).parents[1] / "data" / "samples" / "demo-delivery-40-orders.xlsx"
client = TestClient(app)


def _upload_dataset() -> str:
    store.datasets.clear()
    store.plans.clear()
    store.current_versions.clear()
    with SAMPLE_WORKBOOK.open("rb") as workbook:
        response = client.post(
            "/api/v1/datasets/import-excel",
            files={
                "file": (
                    SAMPLE_WORKBOOK.name,
                    workbook,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
    assert response.status_code == 201, response.text
    return response.json()["dataset_id"]


def test_auto_plan_uses_google_matrix_when_provider_succeeds(monkeypatch) -> None:
    dataset_id = _upload_dataset()
    monkeypatch.setattr(api_main.settings, "google_routes_server_api_key", "test-google-key")
    def fake_build(self, dataset, *, allow_fallback=True):
        matrix = SimulatedRouteProvider().build(dataset)
        return replace(
            matrix, provider_mode="GOOGLE", matrix_version="mock-google-v1", warning=None
        )

    monkeypatch.setattr(GoogleRoutesProvider, "build", fake_build)
    response = client.post(
        "/api/v1/plans",
        json={"dataset_id": dataset_id, "algorithm": "ORTOOLS"},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["provider_mode"] == "GOOGLE"
    assert body["matrix_version"] == "mock-google-v1"
    assert body["matrix_hash"] == body["summary"]["matrix_hash"]
    assert all(route["route_provider_mode"] == "GOOGLE" for route in body["vehicles"])


def test_auto_plan_reports_google_failure_without_simulated_fallback(monkeypatch) -> None:
    dataset_id = _upload_dataset()
    monkeypatch.setattr(api_main.settings, "google_routes_server_api_key", "test-google-key")

    def fail_build(self, dataset, *, allow_fallback=True):
        raise GoogleRoutesProviderError("GOOGLE_HTTP_503")

    monkeypatch.setattr(GoogleRoutesProvider, "build", fail_build)
    response = client.post("/api/v1/plans", json={"dataset_id": dataset_id, "algorithm": "ORTOOLS"})
    assert response.status_code == 502
    body = response.json()
    assert body["error"]["code"] == "PROVIDER_UNAVAILABLE"
    assert body["error"]["details"]["provider_error"] == "GOOGLE_HTTP_503"
    assert body["error"]["details"]["fallback_used"] is False


def test_provider_status_distinguishes_configured_from_connected(monkeypatch) -> None:
    monkeypatch.setattr(api_main.settings, "google_routes_server_api_key", "test-google-key")
    monkeypatch.setattr(api_main.settings, "openai_api_key", "test-openai-key")
    monkeypatch.setitem(api_main.provider_runtime_state, "google_routes", "configured")
    monkeypatch.setitem(api_main.provider_runtime_state, "openai", "configured")

    response = client.get("/api/v1/providers/status")

    assert response.status_code == 200
    statuses = {item["name"]: item["status"] for item in response.json()["providers"]}
    assert statuses["google_routes"] == "configured"
    assert statuses["openai"] == "configured"
    assert "healthy" not in {statuses["google_routes"], statuses["openai"]}


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        (
            {"error": {"status": "PERMISSION_DENIED", "message": "Invalid API key"}},
            "INVALID_API_KEY",
        ),
        (
            {
                "error": {
                    "status": "PERMISSION_DENIED",
                    "message": "API keys with referer restrictions cannot be used",
                }
            },
            "WRONG_API_RESTRICTION",
        ),
        (
            {"error": {"status": "PERMISSION_DENIED", "message": "Billing disabled"}},
            "BILLING_DISABLED",
        ),
    ],
)
def test_google_http_errors_are_classified_without_response_leak(
    monkeypatch, payload: dict, expected: str
) -> None:
    dataset_id = _upload_dataset()

    def fake_post(*args, **kwargs):
        del args, kwargs
        return httpx.Response(
            403,
            json=payload,
            request=httpx.Request("POST", "https://routes.googleapis.com"),
        )

    monkeypatch.setattr(httpx, "post", fake_post)
    with pytest.raises(GoogleRoutesProviderError) as error:
        dataset = api_main.store.get_dataset(dataset_id)
        assert dataset is not None
        GoogleRoutesProvider("test-google-key").build(dataset.dataset, allow_fallback=False)
    assert error.value.code == "GOOGLE_HTTP_403"
    assert error.value.category == expected
    assert "test-google-key" not in str(error.value)


def test_tdx_oauth_and_event_projection_are_redacted(monkeypatch) -> None:
    class FakeResponse:
        def __init__(self, payload):
            self.payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self.payload

    monkeypatch.setattr(
        httpx,
        "post",
        lambda *args, **kwargs: FakeResponse({"access_token": "not-returned", "expires_in": 3600}),
    )
    monkeypatch.setattr(
        httpx,
        "get",
        lambda *args, **kwargs: FakeResponse(
            [
                {
                    "EventID": "E-001",
                    "EventType": "ACCIDENT",
                    "Description": "封閉一線道",
                    "Severity": "HIGH",
                    "CityCode": "NWT",
                    "Latitude": 25.01,
                    "Longitude": 121.46,
                }
            ]
        ),
    )
    result = TDXProvider("client", "secret", api_base_url="https://example.invalid").fetch_traffic()
    assert result.mode == "TDX"
    assert result.data_status == "EVENTS_FOUND"
    assert result.events[0].event_id == "E-001"
    assert "not-returned" not in result.model_dump_json()
