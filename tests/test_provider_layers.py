from pathlib import Path

import pytest

from src.config import get_settings
from src.providers.google_routes import GoogleRoutesProvider
from src.providers.tdx import TDXProvider
from src.services.importer import parse_workbook

SAMPLE_WORKBOOK = Path(__file__).parents[1] / "data" / "samples" / "demo-delivery-40-orders.xlsx"


def test_google_missing_key_falls_back_without_network() -> None:
    dataset, report = parse_workbook(SAMPLE_WORKBOOK)
    assert report.is_valid and dataset is not None

    matrix = GoogleRoutesProvider(None).build(dataset)

    assert matrix.provider_mode == "SIMULATED"
    assert matrix.warning == "GOOGLE_KEY_MISSING"


def test_tdx_missing_credentials_are_explicitly_disabled() -> None:
    status = TDXProvider(None, None).status()

    assert status.enabled is False
    assert status.status == "disabled"
    assert status.mode == "UNAVAILABLE"


@pytest.mark.live
def test_live_google_requires_explicit_environment_key() -> None:
    if not get_settings().google_routes_server_api_key:
        pytest.skip("GOOGLE_ROUTES_SERVER_API_KEY is not exported for live tests")
