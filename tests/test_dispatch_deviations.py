from pathlib import Path

from src.services import dispatch_parameters
from src.services.dispatch_deviations import compute_dispatch_deviations
from src.services.importer import parse_workbook
from src.services.matrix import SimulatedRouteProvider
from src.services.planner import build_ortools

SAMPLE_WORKBOOK = Path(__file__).parents[1] / "data" / "samples" / "demo-50-relaxed.xlsx"


def _sample_plan():
    dataset, report = parse_workbook(SAMPLE_WORKBOOK)
    assert dataset is not None and report.is_valid
    matrix = SimulatedRouteProvider().build(dataset)
    plan = build_ortools(dataset, matrix, time_limit_seconds=10, objective="BALANCED")
    return dataset, matrix, plan


def test_timeline_deviations_are_deterministic_and_include_both_cases() -> None:
    dataset, _, plan = _sample_plan()

    before = compute_dispatch_deviations(plan, dataset, 0)
    assert before["has_deviations"] is False

    result = compute_dispatch_deviations(plan, dataset, 80)
    assert result["source"] == "TIMELINE_SIMULATION"
    assert result["has_deviations"] is True
    assert result["vehicle_deviations"][0]["vehicle_id"] == "VEH-003"
    assert result["vehicle_deviations"][0]["delay_minutes"] == 3
    assert result["zone_deviations"][0]["zone_code"] == "Z5"
    assert result["zone_deviations"][0]["extra_service_minutes_per_stop"] == 6
    assert result["suggestions"][0]["from_service_minutes"] == 3
    assert result["suggestions"][0]["to_service_minutes"] == 9


def test_confirmed_service_parameter_is_not_applied_until_confirmed(monkeypatch) -> None:
    test_path = Path(__file__).parents[1] / "data" / "runtime" / "test-f6-parameters.json"
    test_path.unlink(missing_ok=True)
    monkeypatch.setattr(dispatch_parameters, "_PARAMETERS_PATH", test_path)
    dataset, matrix, plan = _sample_plan()

    try:
        assert dispatch_parameters.parameter_state() == {
            "default_service_minutes": 3,
            "service_minutes_by_zone": {},
        }
        assert dispatch_parameters.apply_service_time_parameters(plan, dataset, matrix) is plan

        confirmed = dispatch_parameters.confirm_service_parameter("Z5", 3, 7)
        assert confirmed["service_minutes_by_zone"] == {"Z5": 7}
        adjusted = dispatch_parameters.apply_service_time_parameters(plan, dataset, matrix)
        assert adjusted.solver_status == "PARAMETERIZED_REPLAN"
        assert adjusted.total_distance_m >= 0
        order_by_id = {order.order_id: order for order in dataset.orders}
        assert all(
            stop.service_duration_s == 420
            for route in adjusted.routes
            for stop in route.stops
            if order_by_id[stop.order_id].zone_code == "Z5"
        )
    finally:
        test_path.unlink(missing_ok=True)
