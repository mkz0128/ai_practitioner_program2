import hashlib
import json
from pathlib import Path

from src.api.main import app

SNAPSHOT = Path(__file__).parents[1] / "docs" / "openapi-snapshot.sha256"
EXPECTED_PATHS = {
    "/health",
    "/ready",
    "/api/v1/datasets/import-excel",
    "/api/v1/datasets/{dataset_id}",
    "/api/v1/datasets/{dataset_id}/validation",
    "/api/v1/plans",
    "/api/v1/plans/{plan_id}",
    "/api/v1/plans/{plan_id}/map-data",
    "/api/v1/plans/{plan_id}/urgent-insert/preview",
    "/api/v1/plans/{plan_id}/confirm",
    "/api/v1/plans/{plan_id}/dispatch",
    "/api/v1/agent/chat",
    "/api/v1/providers/status",
}


def test_openapi_snapshot_and_paths_are_stable() -> None:
    schema = app.openapi()
    assert set(schema["paths"]) == EXPECTED_PATHS
    digest = hashlib.sha256(
        json.dumps(schema, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    assert digest == SNAPSHOT.read_text(encoding="utf-8").strip()
