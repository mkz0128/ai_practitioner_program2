from pathlib import Path

from src.services.importer import parse_workbook

SAMPLE_WORKBOOK = Path(__file__).parents[1] / "data" / "samples" / "demo-delivery-40-orders.xlsx"


def test_demo_workbook_imports_and_aggregates_package_weights() -> None:
    dataset, report = parse_workbook(SAMPLE_WORKBOOK)

    assert report.is_valid, report.model_dump()
    assert dataset is not None
    assert len(dataset.orders) == 40
    assert len(dataset.packages) == 80
    assert len(dataset.vehicles) == 4
    assert len(dataset.zones) == 5
    assert round(sum(order.total_weight_kg for order in dataset.orders), 3) == 365.0
    assert all(order.total_weight_kg > 0 for order in dataset.orders)
