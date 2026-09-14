from pathlib import Path

from src.domain.models import TimeSlot
from src.services.importer import parse_workbook
from src.services.matrix import SimulatedRouteProvider
from src.services.planner import (
    AFTERNOON_END,
    AFTERNOON_START,
    EVENING_END,
    EVENING_START,
    MORNING_END,
    MORNING_START,
    build_ortools,
    time_window_bounds,
)
from src.services.validator import validate_plan

SAMPLES = Path("data/samples")


def test_v2_time_slots_have_three_deterministic_work_windows() -> None:
    assert [slot.value for slot in TimeSlot] == ["MORNING", "AFTERNOON", "EVENING"]
    assert time_window_bounds(TimeSlot.MORNING) == (MORNING_START, MORNING_END)
    assert time_window_bounds(TimeSlot.AFTERNOON) == (AFTERNOON_START, AFTERNOON_END)
    assert time_window_bounds(TimeSlot.EVENING) == (EVENING_START, EVENING_END)
    assert EVENING_END == 11 * 3600
    assert MORNING_START == 0


def test_relaxed_demo_has_fifty_orders_and_four_usable_routes() -> None:
    dataset, report = parse_workbook(SAMPLES / "demo-50-relaxed.xlsx", "demo-50-relaxed.xlsx")
    assert dataset is not None and report.is_valid
    assert len(dataset.orders) == 50
    assert {order.time_slot for order in dataset.orders} == set(TimeSlot)

    matrix = SimulatedRouteProvider().build(dataset)
    plan = build_ortools(dataset, matrix, time_limit_seconds=2, objective="BALANCED")
    validation = validate_plan(dataset, plan, matrix)
    assert plan.complete
    assert not plan.unassigned_orders
    assert validation.valid
    assert all(route.order_ids for route in plan.routes)
    assert all(0.60 <= route.load_utilization <= 0.80 for route in plan.routes)


def test_tight_demo_is_valid_but_contains_the_documented_unassignable_order() -> None:
    dataset, report = parse_workbook(SAMPLES / "demo-50-tight.xlsx", "demo-50-tight.xlsx")
    assert dataset is not None and report.is_valid
    assert len(dataset.orders) == 50

    matrix = SimulatedRouteProvider().build(dataset)
    plan = build_ortools(dataset, matrix, time_limit_seconds=2)
    validation = validate_plan(dataset, plan, matrix)
    assert not plan.complete
    assert plan.unassigned_orders == ["ORD-050"]
    assert plan.unassigned_reasons["ORD-050"] == "UNASSIGNABLE"
    assert validation.valid


def test_demo_planning_is_reproducible_for_same_sample_and_matrix() -> None:
    dataset, report = parse_workbook(SAMPLES / "demo-50-tight.xlsx", "demo-50-tight.xlsx")
    assert dataset is not None and report.is_valid
    matrix = SimulatedRouteProvider().build(dataset)

    first = build_ortools(dataset, matrix, time_limit_seconds=2)
    second = build_ortools(dataset, matrix, time_limit_seconds=2)
    assert [route.model_dump() for route in first.routes] == [
        route.model_dump() for route in second.routes
    ]
    assert first.unassigned_orders == second.unassigned_orders
