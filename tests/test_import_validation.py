from pathlib import Path

from src.agent.dataset_repair import blank_cells_from_paths
from src.services.importer import parse_workbook

SAMPLES = Path(__file__).parents[1] / "data" / "samples"
SAMPLE_WORKBOOK = SAMPLES / "demo-delivery-40-orders.xlsx"
BLANK_WORKBOOK = SAMPLES / "demo-50-tight-missing.xlsx"
TIGHT_WORKBOOK = SAMPLES / "demo-50-tight.xlsx"

# The three cells demo-50-tight-missing leaves empty, and the values the file
# they were taken from carries.
BLANKS = {
    "orders.ORD-001.location_label": "北投示範配送點 01",
    "orders.ORD-002.time_slot": "MORNING",
    "packages.PKG-003-01.weight_kg": "1.35",
}


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


def test_blank_required_cells_are_reported_as_fillable_paths() -> None:
    dataset, report = parse_workbook(BLANK_WORKBOOK)

    assert dataset is None
    assert not report.is_valid
    paths = [error.path for error in report.errors if error.code == "MISSING_REQUIRED_FIELD"]
    assert sorted(paths) == sorted(BLANKS)
    # Every reported path has to survive the trip back into a cell we can offer
    # to fill, or the dispatcher is told about a blank nobody can clear.
    assert sorted(cell.path for cell in blank_cells_from_paths(paths)) == sorted(BLANKS)


def test_supplied_values_reproduce_the_workbook_they_were_removed_from() -> None:
    supplied, report = parse_workbook(BLANK_WORKBOOK, field_overrides=BLANKS)
    original, original_report = parse_workbook(TIGHT_WORKBOOK)

    assert report.is_valid, report.model_dump()
    assert original_report.is_valid
    assert supplied is not None and original is not None
    assert len(supplied.orders) == len(original.orders)
    assert {order.order_id: order.total_weight_kg for order in supplied.orders} == {
        order.order_id: order.total_weight_kg for order in original.orders
    }
    by_id = {order.order_id: order for order in supplied.orders}
    assert by_id["ORD-001"].location_label == "北投示範配送點 01"
    assert by_id["ORD-002"].time_slot == "MORNING"


def test_partial_and_unusable_values_leave_the_cell_blank() -> None:
    # One cell answered, two still outstanding.
    dataset, report = parse_workbook(
        BLANK_WORKBOOK, field_overrides={"orders.ORD-002.time_slot": "MORNING"}
    )
    assert dataset is None
    outstanding = {error.path for error in report.errors if error.code == "MISSING_REQUIRED_FIELD"}
    assert outstanding == {"orders.ORD-001.location_label", "packages.PKG-003-01.weight_kg"}

    # A weight that is not a number must not reach the strict domain model as a
    # type error the dispatcher cannot act on; the cell stays blank and is asked
    # for again.
    _, unusable = parse_workbook(
        BLANK_WORKBOOK, field_overrides={**BLANKS, "packages.PKG-003-01.weight_kg": "大概五公斤"}
    )
    assert any(
        error.path == "packages.PKG-003-01.weight_kg" and error.code == "MISSING_REQUIRED_FIELD"
        for error in unusable.errors
    )


def test_overrides_never_replace_a_value_the_workbook_already_has() -> None:
    dataset, report = parse_workbook(
        TIGHT_WORKBOOK, field_overrides={"orders.ORD-001.location_label": "不該蓋掉原本的值"}
    )

    assert report.is_valid
    assert dataset is not None
    assert next(
        order for order in dataset.orders if order.order_id == "ORD-001"
    ).location_label == "北投示範配送點 01"
