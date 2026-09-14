from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path
from threading import RLock
from typing import Any

from src.domain.models import Dataset, Order, Vehicle
from src.services.matrix import MatrixResult
from src.services.planner import (
    BASE_TIME,
    LEGACY_BASE_TIME,
    PlanResult,
    Stop,
    VehicleRoute,
    planner_time_window_bounds,
    route_horizon_seconds,
    uses_legacy_timing,
)

DEFAULT_SERVICE_MINUTES = 3
MIN_SERVICE_MINUTES = 1
MAX_SERVICE_MINUTES = 15
_PARAMETERS_PATH = (
    Path(__file__).resolve().parents[2] / "data" / "runtime" / "dispatch-parameters.json"
)
_PARAMETERS_LOCK = RLock()


def _read_overrides() -> dict[str, int]:
    if not _PARAMETERS_PATH.exists():
        return {}
    try:
        raw = json.loads(_PARAMETERS_PATH.read_text(encoding="utf-8"))
    except (OSError, TypeError, ValueError):
        return {}
    if not isinstance(raw, dict):
        return {}
    overrides: dict[str, int] = {}
    for zone_code, value in raw.items():
        if (
            isinstance(zone_code, str)
            and isinstance(value, int)
            and not isinstance(value, bool)
            and MIN_SERVICE_MINUTES <= value <= MAX_SERVICE_MINUTES
        ):
            overrides[zone_code] = value
    return overrides


def _write_overrides(overrides: dict[str, int]) -> None:
    _PARAMETERS_PATH.parent.mkdir(parents=True, exist_ok=True)
    _PARAMETERS_PATH.write_text(
        json.dumps(dict(sorted(overrides.items())), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def service_minutes_for_zone(zone_code: str) -> int:
    with _PARAMETERS_LOCK:
        return _read_overrides().get(zone_code, DEFAULT_SERVICE_MINUTES)


def parameter_state() -> dict[str, Any]:
    with _PARAMETERS_LOCK:
        overrides = _read_overrides()
    return {
        "default_service_minutes": DEFAULT_SERVICE_MINUTES,
        "service_minutes_by_zone": dict(sorted(overrides.items())),
    }


def reset_service_parameters() -> dict[str, Any]:
    """Clear all confirmed zone service-time overrides for a fresh session."""
    with _PARAMETERS_LOCK:
        _write_overrides({})
    return parameter_state()


def confirm_service_parameter(
    zone_code: str,
    from_service_minutes: int,
    to_service_minutes: int,
) -> dict[str, Any]:
    if not zone_code:
        raise ValueError("ZONE_REQUIRED")
    if not MIN_SERVICE_MINUTES <= from_service_minutes <= MAX_SERVICE_MINUTES:
        raise ValueError("SERVICE_MINUTES_OUT_OF_RANGE")
    if not MIN_SERVICE_MINUTES <= to_service_minutes <= MAX_SERVICE_MINUTES:
        raise ValueError("SERVICE_MINUTES_OUT_OF_RANGE")
    with _PARAMETERS_LOCK:
        overrides = _read_overrides()
        current = overrides.get(zone_code, DEFAULT_SERVICE_MINUTES)
        if current != from_service_minutes:
            raise ValueError("PARAMETER_VERSION_CONFLICT")
        if to_service_minutes == DEFAULT_SERVICE_MINUTES:
            overrides.pop(zone_code, None)
        else:
            overrides[zone_code] = to_service_minutes
        _write_overrides(overrides)
    state = parameter_state()
    return {
        **state,
        "zone_code": zone_code,
        "from_service_minutes": from_service_minutes,
        "to_service_minutes": to_service_minutes,
        "requires_replan": True,
    }


def _parameterized_route(
    order_ids: list[str],
    vehicle: Vehicle,
    orders: dict[str, Order],
    matrix: MatrixResult,
    service_by_zone: dict[str, int],
    legacy: bool,
) -> VehicleRoute | None:
    index = {node_id: position for position, node_id in enumerate(matrix.node_ids)}
    current_node = "DEPOT-001"
    current_s = 0
    total_distance = 0
    total_duration = 0
    stops: list[Stop] = []
    for order_id in order_ids:
        order = orders[order_id]
        from_index, to_index = index[current_node], index[order_id]
        travel_s = matrix.duration_s[from_index][to_index]
        window = planner_time_window_bounds(order.time_slot, legacy)
        if window is None:
            return None
        service_s = service_by_zone.get(order.zone_code, DEFAULT_SERVICE_MINUTES) * 60
        service_start = max(current_s + travel_s, window[0])
        service_finish = service_start + service_s
        if service_finish > window[1]:
            return None
        total_distance += matrix.distance_m[from_index][to_index]
        total_duration += travel_s
        stops.append(
            Stop(
                sequence=len(stops) + 1,
                order_id=order_id,
                time_slot=order.time_slot,
                eta=(
                    (LEGACY_BASE_TIME if legacy else BASE_TIME)
                    + timedelta(seconds=service_start)
                ).isoformat(),
                service_duration_s=service_s,
                order_weight_kg=order.total_weight_kg,
                latitude=order.latitude,
                longitude=order.longitude,
                leg_distance_m=matrix.distance_m[from_index][to_index],
                leg_duration_s=travel_s,
            )
        )
        current_node, current_s = order_id, service_finish
    if current_node == "DEPOT-001":
        return_s = 0
    else:
        depot_index, last_index = index["DEPOT-001"], index[current_node]
        return_s = current_s + matrix.duration_s[last_index][depot_index]
        total_distance += matrix.distance_m[last_index][depot_index]
        total_duration += matrix.duration_s[last_index][depot_index]
    if return_s > route_horizon_seconds(legacy):
        return None
    load = round(
        vehicle.current_load_kg + sum(orders[order_id].total_weight_kg for order_id in order_ids),
        3,
    )
    return VehicleRoute(
        vehicle_id=vehicle.vehicle_id,
        order_ids=[stop.order_id for stop in stops],
        planned_load_kg=load,
        max_load_kg=vehicle.max_load_kg,
        load_utilization=round(load / vehicle.max_load_kg, 6),
        total_distance_m=total_distance,
        total_duration_s=total_duration,
        stops=stops,
    )


def apply_service_time_parameters(
    plan: PlanResult, dataset: Dataset, matrix: MatrixResult
) -> PlanResult:
    """Recalculate the existing deterministic assignment with confirmed service times."""
    state = parameter_state()
    overrides = state["service_minutes_by_zone"]
    if not overrides:
        return plan
    vehicles = {vehicle.vehicle_id: vehicle for vehicle in dataset.vehicles}
    orders = {order.order_id: order for order in dataset.orders}
    legacy = uses_legacy_timing(dataset)
    routes: list[VehicleRoute] = []
    extra_unassigned: dict[str, str] = {}
    for base_route in plan.routes:
        vehicle = vehicles.get(base_route.vehicle_id)
        if vehicle is None:
            continue
        selected_route: VehicleRoute | None = None
        selected_count = 0
        for count in range(len(base_route.order_ids), -1, -1):
            candidate = _parameterized_route(
                base_route.order_ids[:count],
                vehicle,
                orders,
                matrix,
                overrides,
                legacy,
            )
            if candidate is not None:
                selected_route = candidate
                selected_count = count
                break
        if selected_route is None:
            continue
        routes.append(selected_route)
        for order_id in base_route.order_ids[selected_count:]:
            extra_unassigned[order_id] = "SERVICE_TIME_PARAMETER_CONFLICT"
    reasons = dict(plan.unassigned_reasons)
    reasons.update(extra_unassigned)
    unassigned = sorted(set(plan.unassigned_orders) | set(extra_unassigned))
    return plan.model_copy(
        update={
            "state": plan.state,
            "complete": not unassigned,
            "routes": routes,
            "unassigned_orders": unassigned,
            "unassigned_reasons": reasons,
            "total_distance_m": sum(route.total_distance_m for route in routes),
            "total_driving_time_s": sum(route.total_duration_s for route in routes),
            "solver_status": "PARAMETERIZED_REPLAN",
        }
    )
