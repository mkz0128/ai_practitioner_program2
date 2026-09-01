from __future__ import annotations

from time import perf_counter

from pydantic import BaseModel, ConfigDict

from src.domain.models import Dataset
from src.services.matrix import MatrixResult
from src.services.planner import PlanResult, build_baseline, build_ortools
from src.services.validator import PlanValidation, validate_plan


class VehicleBenchmark(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vehicle_id: str
    planned_load_kg: float
    max_load_kg: float
    utilization: float


class AlgorithmBenchmark(BaseModel):
    model_config = ConfigDict(extra="forbid")

    algorithm: str
    total_distance_m: int
    total_driving_time_s: int
    vehicles: list[VehicleBenchmark]
    utilization_gap: float
    unassigned_order_count: int
    violations: dict[str, int]
    solve_time_ms: float
    validation_valid: bool
    solver_status: str | None = None


class BenchmarkResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    matrix_version: str
    provider_mode: str
    order_count: int
    vehicle_count: int
    zone_count: int
    baseline: AlgorithmBenchmark
    optimized: AlgorithmBenchmark
    improvement_percent: dict[str, float | None]


def _algorithm_result(
    plan: PlanResult, validation: PlanValidation, solve_time_ms: float
) -> AlgorithmBenchmark:
    vehicles = [
        VehicleBenchmark(
            vehicle_id=route.vehicle_id,
            planned_load_kg=route.planned_load_kg,
            max_load_kg=route.max_load_kg,
            utilization=route.load_utilization,
        )
        for route in plan.routes
    ]
    utilizations = [vehicle.utilization for vehicle in vehicles]
    return AlgorithmBenchmark(
        algorithm=plan.algorithm,
        total_distance_m=plan.total_distance_m,
        total_driving_time_s=plan.total_driving_time_s,
        vehicles=vehicles,
        utilization_gap=round(max(utilizations, default=0.0) - min(utilizations, default=0.0), 6),
        unassigned_order_count=len(plan.unassigned_orders),
        violations=validation.violations,
        solve_time_ms=round(solve_time_ms, 3),
        validation_valid=validation.valid,
        solver_status=plan.solver_status,
    )


def _improvement(baseline: float, optimized: float) -> float | None:
    if baseline == 0:
        return None
    return round((baseline - optimized) / baseline * 100, 3)


def run_benchmark(
    dataset: Dataset, matrix: MatrixResult, time_limit_seconds: int = 10
) -> BenchmarkResult:
    baseline_start = perf_counter()
    baseline = build_baseline(dataset, matrix)
    baseline_validation = validate_plan(dataset, baseline, matrix)
    baseline_result = _algorithm_result(
        baseline, baseline_validation, (perf_counter() - baseline_start) * 1000
    )
    optimized_start = perf_counter()
    optimized = build_ortools(dataset, matrix, time_limit_seconds=time_limit_seconds)
    optimized_validation = validate_plan(dataset, optimized, matrix)
    optimized_result = _algorithm_result(
        optimized, optimized_validation, (perf_counter() - optimized_start) * 1000
    )
    return BenchmarkResult(
        matrix_version=matrix.matrix_version,
        provider_mode=matrix.provider_mode,
        order_count=len(dataset.orders),
        vehicle_count=len(dataset.vehicles),
        zone_count=len(dataset.zones),
        baseline=baseline_result,
        optimized=optimized_result,
        improvement_percent={
            "total_distance_m": _improvement(
                baseline_result.total_distance_m, optimized_result.total_distance_m
            ),
            "total_driving_time_s": _improvement(
                baseline_result.total_driving_time_s, optimized_result.total_driving_time_s
            ),
            "utilization_gap": _improvement(
                baseline_result.utilization_gap, optimized_result.utilization_gap
            ),
            "unassigned_order_count": _improvement(
                baseline_result.unassigned_order_count, optimized_result.unassigned_order_count
            ),
        },
    )
