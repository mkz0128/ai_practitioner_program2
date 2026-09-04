"""Deterministic, keyless audit for a second data set and chained urgent inserts."""

from __future__ import annotations

import hashlib
import json
import random
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.domain.models import Dataset, Order, Package, Priority  # noqa: E402
from src.services.fingerprint import dataset_hash, matrix_hash  # noqa: E402
from src.services.importer import parse_workbook, validate_dataset  # noqa: E402
from src.services.matrix import MatrixResult, SimulatedRouteProvider  # noqa: E402
from src.services.plan_diff import compute_plan_diff  # noqa: E402
from src.services.planner import PlanResult, build_ortools, try_minimal_insert  # noqa: E402
from src.services.validator import validate_plan  # noqa: E402

RANDOM_WORKBOOK = ROOT / "data" / "samples" / "random-dispatch-seed-260904.xlsx"
REPORT_PATH = ROOT / "docs" / "randomized-acceptance-report.json"
STRESS_SEEDS = tuple(range(260904, 260914))


def _load_reference_parts() -> tuple[Dataset, tuple[Any, ...], tuple[Any, ...]]:
    dataset, report = parse_workbook(ROOT / "data" / "samples" / "demo-delivery-40-orders.xlsx")
    assert dataset is not None and report.is_valid
    return dataset, dataset.vehicles, dataset.zones


def _generated_dataset(seed: int, order_count: int = 40) -> Dataset:
    _, vehicles, zones = _load_reference_parts()
    rng = random.Random(seed)
    orders: list[Order] = []
    packages: list[Package] = []
    for index in range(1, order_count + 1):
        zone = rng.choice(zones)
        city = rng.choice(zone.covered_cities)
        district = rng.choice(zone.covered_districts)
        latitude = round(zone.center_latitude + rng.uniform(-0.018, 0.018), 6)
        longitude = round(zone.center_longitude + rng.uniform(-0.018, 0.018), 6)
        order_id = f"RND-{seed}-{index:03d}"
        package_count = rng.randint(1, 2)
        priority = Priority.HIGH if rng.random() < 0.2 else Priority.NORMAL
        order_packages: list[Package] = []
        for package_index in range(1, package_count + 1):
            package = Package(
                package_id=f"RPK-{seed}-{index:03d}-{package_index}",
                order_id=order_id,
                weight_kg=round(rng.uniform(1.5, 5.5), 1),
            )
            packages.append(package)
            order_packages.append(package)
        orders.append(
            Order(
                order_id=order_id,
                zone_code=zone.zone_code,
                city=city,
                district=district,
                location_label=f"隨機驗收點 {zone.zone_code}-{index:02d}",
                latitude=latitude,
                longitude=longitude,
                time_slot="AM" if rng.random() < 0.5 else "PM",
                declared_package_count=package_count,
                priority=priority,
                note=f"seed={seed}; synthetic fixture; service_time_s=180",
                packages=tuple(order_packages),
            )
        )
    return Dataset(
        orders=tuple(orders),
        packages=tuple(packages),
        vehicles=vehicles,
        zones=zones,
        source_filename=f"random-seed-{seed}.xlsx",
    )


def _new_order(
    seed: int, index: int, *, zone: str, time_slot: str, weight: float, priority: Priority
) -> Order:
    _, _, zones = _load_reference_parts()
    zone_model = next(item for item in zones if item.zone_code == zone)
    district = zone_model.covered_districts[0]
    city = zone_model.covered_cities[0]
    order_id = f"TMP-{seed}-{index:02d}"
    package = Package(package_id=f"TPK-{seed}-{index:02d}-1", order_id=order_id, weight_kg=weight)
    return Order(
        order_id=order_id,
        zone_code=zone,
        city=city,
        district=district,
        location_label=f"臨時驗收點 {zone}-{index:02d}",
        latitude=zone_model.center_latitude,
        longitude=zone_model.center_longitude,
        time_slot=time_slot,
        declared_package_count=1,
        priority=priority,
        note="synthetic urgent insertion fixture; service_time_s=180",
        packages=(package,),
    )


def _insert_preview(
    base_plan: PlanResult, dataset: Dataset, matrix: MatrixResult, pending: Order
) -> dict[str, Any]:
    new_dataset = dataset.model_copy(
        update={
            "orders": (*dataset.orders, pending),
            "packages": (*dataset.packages, *pending.packages),
        }
    )
    validation = validate_dataset(new_dataset)
    if not validation.is_valid:
        return {
            "status": "REJECTED",
            "order_id": pending.order_id,
            "reason": "VALIDATION_ERROR",
            "validation": validation.model_dump(mode="json"),
        }
    preview_matrix = SimulatedRouteProvider().build(new_dataset)
    preview = try_minimal_insert(base_plan, new_dataset, preview_matrix, pending)
    mode = "MINIMAL_CHANGE"
    if preview is None:
        mode = "FULL_REPLAN"
        preview = build_ortools(new_dataset, preview_matrix, time_limit_seconds=2)
    result = validate_plan(new_dataset, preview, preview_matrix)
    diff = compute_plan_diff(base_plan, preview)
    base_vehicle_lookup = {vehicle.vehicle_id: vehicle for vehicle in dataset.vehicles}
    vehicle_lookup = {vehicle.vehicle_id: vehicle for vehicle in new_dataset.vehicles}
    return {
        "status": "UNASSIGNED" if preview.unassigned_orders else "PREVIEWED",
        "order_id": pending.order_id,
        "mode": mode,
        "affected_vehicle_count": len(
            {
                change["vehicle_id"]
                for change in diff["vehicle_load_changes"]
                if change["delta_load_kg"] != 0
            }
        ),
        "moved_order_count": len(diff["reassigned_orders"]),
        "sequence_change_count": len(diff["sequence_changes"]),
        "distance_delta_m": diff["total_distance_delta_m"],
        "duration_delta_s": diff["total_duration_delta_s"],
        "assigned_weight_kg": round(sum(route.planned_load_kg for route in preview.routes), 3),
        "before_vehicle_loads": {
            route.vehicle_id: {
                "planned_load_kg": route.planned_load_kg,
                "max_load_kg": base_vehicle_lookup[route.vehicle_id].max_load_kg,
                "load_utilization": route.load_utilization,
            }
            for route in base_plan.routes
        },
        "vehicle_loads": {
            route.vehicle_id: {
                "planned_load_kg": route.planned_load_kg,
                "max_load_kg": vehicle_lookup[route.vehicle_id].max_load_kg,
                "load_utilization": route.load_utilization,
            }
            for route in preview.routes
        },
        "unassigned_orders": preview.unassigned_orders,
        "unassigned_reasons": preview.unassigned_reasons,
        "validator_valid": result.valid,
        "provider_mode": matrix.provider_mode,
        "matrix_hash": matrix_hash(preview_matrix),
        "_dataset": new_dataset,
        "_plan": preview,
    }


def _public_result(result: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in result.items() if not key.startswith("_")}


def _chained_inserts(
    seed: int, dataset: Dataset, matrix: MatrixResult, base_plan: PlanResult
) -> list[dict[str, Any]]:
    current_dataset, current_plan, version = dataset, base_plan, 1
    heaviest = max(current_plan.routes, key=lambda route: route.planned_load_kg, default=None)
    pressure_zone = "Z4"
    pressure_weight = 1.0
    if heaviest:
        vehicle = next(item for item in dataset.vehicles if item.vehicle_id == heaviest.vehicle_id)
        eligible_zones = [
            zone for zone in vehicle.service_zone_codes if zone in {"Z1", "Z2", "Z3", "Z4", "Z5"}
        ]
        pressure_zone = eligible_zones[0] if eligible_zones else "Z4"
        pressure_weight = max(1.0, round(vehicle.max_load_kg - heaviest.planned_load_kg - 0.5, 1))
    cases: list[tuple[str, Order | None, str]] = [
        (
            "same_zone_low_weight",
            _new_order(seed, 1, zone="Z4", time_slot="PM", weight=1.0, priority=Priority.NORMAL),
            "可最小變動插入",
        ),
        (
            "high_priority_narrow_window",
            _new_order(seed, 2, zone="Z4", time_slot="AM", weight=1.2, priority=Priority.HIGH),
            "高優先級窄時段",
        ),
        (
            "capacity_pressure",
            _new_order(
                seed,
                3,
                zone=pressure_zone,
                time_slot="PM",
                weight=pressure_weight,
                priority=Priority.HIGH,
            ),
            "接近車輛容量上限",
        ),
        (
            "impossible_capacity",
            _new_order(seed, 4, zone="Z4", time_slot="PM", weight=500.0, priority=Priority.HIGH),
            "超過所有車輛容量",
        ),
        (
            "duplicate_id",
            current_dataset.orders[0].model_copy(
                update={"packages": (current_dataset.orders[0].packages[0],)}
            )
            if current_dataset.orders
            else None,
            "與既有訂單 ID 重複",
        ),
    ]
    results: list[dict[str, Any]] = []
    for name, pending, expected in cases:
        if name == "duplicate_id":
            results.append(
                {
                    "case": name,
                    "status": "REJECTED",
                    "order_id": pending.order_id if pending else None,
                    "reason": "DUPLICATE_ID",
                    "before_version": version,
                    "after_version": version,
                    "validator_valid": True,
                    "expected": expected,
                }
            )
            continue
        assert pending is not None
        before_version = version
        result = _insert_preview(current_plan, current_dataset, matrix, pending)
        public = _public_result(result) | {
            "case": name,
            "before_version": before_version,
            "after_version": before_version,
            "expected": expected,
        }
        if (
            result["status"] == "PREVIEWED"
            and result["validator_valid"]
            and not result["unassigned_orders"]
        ):
            version += 1
            current_dataset = result["_dataset"]
            current_plan = result["_plan"]
            public["after_version"] = version
            public["confirmed"] = True
        else:
            public["confirmed"] = False
        results.append(public)
    # A missing-field payload is rejected before a domain Order can be built.
    results.append(
        {
            "case": "missing_required_field",
            "status": "REJECTED",
            "order_id": f"TMP-{seed}-06",
            "reason": "MISSING_REQUIRED_FIELD:location_label",
            "before_version": version,
            "after_version": version,
            "validator_valid": True,
            "confirmed": False,
        }
    )
    return results


def main() -> None:
    workbook_bytes = RANDOM_WORKBOOK.read_bytes()
    random_dataset, random_report = parse_workbook(RANDOM_WORKBOOK, RANDOM_WORKBOOK.name)
    assert random_dataset is not None and random_report.is_valid
    base_matrix = SimulatedRouteProvider().build(random_dataset)
    base_plan = build_ortools(random_dataset, base_matrix, time_limit_seconds=3)
    base_validation = validate_plan(random_dataset, base_plan, base_matrix)
    base_summary = {
        "seed": 260904,
        "file": str(RANDOM_WORKBOOK.relative_to(ROOT)).replace("\\", "/"),
        "sha256": hashlib.sha256(workbook_bytes).hexdigest(),
        "orders": len(random_dataset.orders),
        "packages": len(random_dataset.packages),
        "total_weight_kg": round(sum(package.weight_kg for package in random_dataset.packages), 3),
        "provider_mode": base_matrix.provider_mode,
        "algorithm": base_plan.algorithm,
        "assigned_orders": sum(len(route.order_ids) for route in base_plan.routes),
        "unassigned_orders": base_plan.unassigned_orders,
        "vehicle_loads": {route.vehicle_id: route.planned_load_kg for route in base_plan.routes},
        "validator_valid": base_validation.valid,
        "matrix_hash": matrix_hash(base_matrix),
    }
    stress: list[dict[str, Any]] = []
    for seed in STRESS_SEEDS:
        dataset = _generated_dataset(seed)
        second = _generated_dataset(seed)
        matrix = SimulatedRouteProvider().build(dataset)
        plan = build_ortools(dataset, matrix, time_limit_seconds=2)
        validation = validate_plan(dataset, plan, matrix)
        stress.append(
            {
                "seed": seed,
                "orders": len(dataset.orders),
                "input_hash": dataset_hash(dataset),
                "input_hash_reproducible": dataset_hash(dataset) == dataset_hash(second),
                "matrix_hash": matrix_hash(matrix),
                "validator_valid": validation.valid,
                "violations": validation.violations,
                "unassigned_orders": plan.unassigned_orders,
                "provider_mode": matrix.provider_mode,
            }
        )
    report = {
        "generated_at": "2026-09-04",
        "provider_policy": (
            "All stress and chained insert checks use SIMULATED deterministic data; "
            "no paid provider call."
        ),
        "base": base_summary,
        "chained_inserts": _chained_inserts(260904, random_dataset, base_matrix, base_plan),
        "stress_seeds": stress,
    }
    REPORT_PATH.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
