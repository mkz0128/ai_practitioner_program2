from fastapi.testclient import TestClient

from src.api.main import app


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
