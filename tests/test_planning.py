from pathlib import Path

from src.services.importer import parse_workbook
from src.services.matrix import SimulatedRouteProvider
from src.services.planner import build_baseline, build_ortools
from src.services.validator import validate_plan

SAMPLE_WORKBOOK = Path(__file__).parents[1] / "data" / "samples" / "demo-delivery-40-orders.xlsx"


def _dataset_and_matrix():
    dataset, report = parse_workbook(SAMPLE_WORKBOOK)
    assert report.is_valid and dataset is not None
    return dataset, SimulatedRouteProvider().build(dataset)


def test_baseline_returns_reconciled_plan_with_eligible_routes() -> None:
    dataset, matrix = _dataset_and_matrix()

    plan = build_baseline(dataset, matrix)
    validation = validate_plan(dataset, plan, matrix)

    assert validation.valid, validation.model_dump()
    assigned = {order_id for route in plan.routes for order_id in route.order_ids}
    assert assigned.isdisjoint(plan.unassigned_orders)
    assert assigned | set(plan.unassigned_orders) == {order.order_id for order in dataset.orders}
    assert all(route.starts_at_depot and route.ends_at_depot for route in plan.routes)


def test_ortools_returns_reconciled_valid_plan() -> None:
    dataset, matrix = _dataset_and_matrix()

    plan = build_ortools(dataset, matrix, time_limit_seconds=1)
    validation = validate_plan(dataset, plan, matrix)

    assert validation.valid, validation.model_dump()
    assert plan.solver_status in {"FEASIBLE", "NO_SOLUTION"}
    assigned = {order_id for route in plan.routes for order_id in route.order_ids}
    assert assigned.isdisjoint(plan.unassigned_orders)
    assert assigned | set(plan.unassigned_orders) == {order.order_id for order in dataset.orders}


def test_fixed_matrix_is_shared_for_comparison() -> None:
    dataset, matrix = _dataset_and_matrix()
    baseline = build_baseline(dataset, matrix)
    optimized = build_ortools(dataset, matrix, time_limit_seconds=1)

    assert baseline.provider_mode == optimized.provider_mode == matrix.provider_mode
    assert matrix.matrix_version == "sim-v1"
