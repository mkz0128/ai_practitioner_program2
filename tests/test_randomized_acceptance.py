from scripts.run_randomized_insert_audit import (
    RANDOM_WORKBOOK,
    STRESS_SEEDS,
    _chained_inserts,
    _generated_dataset,
)
from src.services.fingerprint import dataset_hash
from src.services.importer import parse_workbook
from src.services.matrix import SimulatedRouteProvider
from src.services.planner import build_ortools
from src.services.validator import validate_plan


def test_ten_fixed_random_seeds_are_reproducible_and_validator_safe() -> None:
    for seed in STRESS_SEEDS:
        dataset = _generated_dataset(seed)
        repeated = _generated_dataset(seed)
        assert len(dataset.orders) == 40
        assert dataset_hash(dataset) == dataset_hash(repeated)
        matrix = SimulatedRouteProvider().build(dataset)
        plan = build_ortools(dataset, matrix, time_limit_seconds=1)
        validation = validate_plan(dataset, plan, matrix)
        assert validation.valid, (seed, validation.errors)
        assert all(value == 0 for value in validation.violations.values())
        assigned = [order_id for route in plan.routes for order_id in route.order_ids]
        assert len(assigned) == len(set(assigned))


def test_random_workbook_chained_insert_cases_preserve_confirmed_versions() -> None:
    dataset, report = parse_workbook(RANDOM_WORKBOOK)
    assert dataset is not None and report.is_valid
    matrix = SimulatedRouteProvider().build(dataset)
    base_plan = build_ortools(dataset, matrix, time_limit_seconds=2)
    results = _chained_inserts(260904, dataset, matrix, base_plan)

    assert [item["order_id"] for item in results[:4]] == [
        "TMP-260904-01",
        "TMP-260904-02",
        "TMP-260904-03",
        "TMP-260904-04",
    ]
    assert results[0]["mode"] == "MINIMAL_CHANGE"
    assert results[1]["mode"] == "MINIMAL_CHANGE"
    assert results[2]["mode"] == "FULL_REPLAN"
    assert results[3]["status"] == "UNASSIGNED"
    assert results[3]["before_version"] == results[3]["after_version"] == 4
    assert results[4]["status"] == "REJECTED"
    assert results[4]["before_version"] == results[4]["after_version"] == 4
    assert results[5]["status"] == "REJECTED"
    assert results[5]["before_version"] == results[5]["after_version"] == 4
    assert all(item.get("validator_valid", True) for item in results)
    assert all(item.get("vehicle_loads") for item in results[:4])
