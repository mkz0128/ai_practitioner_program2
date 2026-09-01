from pathlib import Path

from src.services.benchmark import run_benchmark
from src.services.importer import parse_workbook
from src.services.matrix import SimulatedRouteProvider

SAMPLE_WORKBOOK = Path(__file__).parents[1] / "data" / "samples" / "demo-delivery-40-orders.xlsx"


def test_benchmark_uses_fixed_shared_matrix_and_reports_required_metrics() -> None:
    dataset, report = parse_workbook(SAMPLE_WORKBOOK)
    assert report.is_valid and dataset is not None
    matrix = SimulatedRouteProvider().build(dataset)

    result = run_benchmark(dataset, matrix, time_limit_seconds=1)

    assert result.provider_mode == "SIMULATED"
    assert result.matrix_version == "sim-v1"
    assert (result.order_count, result.vehicle_count, result.zone_count) == (40, 4, 5)
    assert len(result.baseline.vehicles) == 4
    assert len(result.optimized.vehicles) == 4
    assert set(result.baseline.violations) == {"overload", "cross_zone", "duplicate", "time_window"}
    assert set(result.optimized.violations) == {
        "overload",
        "cross_zone",
        "duplicate",
        "time_window",
    }
    assert result.baseline.solve_time_ms >= 0
    assert result.optimized.solve_time_ms >= 0
