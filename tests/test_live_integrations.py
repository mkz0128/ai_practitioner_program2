import os
from pathlib import Path

import pytest

from src.config import get_settings
from src.providers.google_routes import GoogleRoutesProvider
from src.services.fingerprint import matrix_hash
from src.services.importer import parse_workbook
from src.services.planner import build_ortools
from src.services.validator import validate_plan

SAMPLE_WORKBOOK = Path(__file__).parents[1] / "data" / "samples" / "demo-delivery-40-orders.xlsx"


@pytest.mark.live
def test_google_matrix_enters_same_live_ortools_solve() -> None:
    if not os.getenv("RUN_LIVE_PROVIDER_E2E"):
        pytest.skip("Set RUN_LIVE_PROVIDER_E2E=1 for the explicit provider E2E gate")
    settings = get_settings()
    if not settings.google_routes_server_api_key:
        pytest.skip("GOOGLE_ROUTES_SERVER_API_KEY is not configured")
    dataset, report = parse_workbook(SAMPLE_WORKBOOK)
    assert report.is_valid and dataset is not None
    matrix = GoogleRoutesProvider(settings.google_routes_server_api_key).build(
        dataset, allow_fallback=False
    )
    assert matrix.provider_mode == "GOOGLE"
    plan = build_ortools(dataset, matrix, time_limit_seconds=10)
    validation = validate_plan(dataset, plan, matrix)
    assert validation.valid is True
    assert matrix_hash(matrix)
    assert plan.provider_mode == matrix.provider_mode
