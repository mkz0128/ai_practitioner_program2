from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from src.domain.models import Dataset
from src.services.matrix import MatrixResult, SimulatedRouteProvider
from src.services.planner import (
    AFTERNOON_START,
    EVENING_START,
    PlanResult,
    VehicleRoute,
    _arrival,
    _route_metrics_preserving_order,
    uses_legacy_timing,
)

SolveStage = Literal["PRE_LOAD", "LOADED", "DISPATCHED"]

TIMELINE_START_MINUTES = 0
TIMELINE_END_MINUTES = 11 * 60
ROUTE_BASE_TIME = datetime(2026, 9, 1, 9, 0, tzinfo=timezone(timedelta(hours=8)))


def stage_for_state(state: str) -> SolveStage:
    if state == "LOADED":
        return "LOADED"
    if state == "DISPATCHED":
        return "DISPATCHED"
    return "PRE_LOAD"


def clamp_timeline_minutes(value: int | None) -> int:
    if value is None:
        return TIMELINE_START_MINUTES
    return max(TIMELINE_START_MINUTES, min(TIMELINE_END_MINUTES, value))


def _timeline_clock(timeline_minutes: int) -> datetime:
    return ROUTE_BASE_TIME + timedelta(minutes=timeline_minutes)


def route_progress(plan: PlanResult, timeline_minutes: int | None = None) -> list[dict[str, Any]]:
    """Derive route progress from deterministic ETA values and a demo clock.

    The clock is deliberately a UI-controlled simulation input. No GPS, socket,
    provider timestamp, or model-generated number participates in this result.
    """
    clock = _timeline_clock(clamp_timeline_minutes(timeline_minutes))
    progress: list[dict[str, Any]] = []
    for route in plan.routes:
        completed: list[str] = []
        current: str | None = None
        stop_statuses: list[dict[str, Any]] = []
        for stop in route.stops:
            eta = datetime.fromisoformat(stop.eta)
            if eta <= clock:
                status = "COMPLETED"
                completed.append(stop.order_id)
            elif current is None:
                status = "CURRENT"
                current = stop.order_id
            else:
                status = "UPCOMING"
            stop_statuses.append(
                {
                    "order_id": stop.order_id,
                    "sequence": stop.sequence,
                    "status": status,
                    "eta": stop.eta,
                }
            )
        current_position = completed[-1] if completed else "DEPOT-001"
        progress.append(
            {
                "vehicle_id": route.vehicle_id,
                "completed_stops": completed,
                "completed_count": len(completed),
                "current_stop_id": current,
                "current_position": current_position,
                "stop_statuses": stop_statuses,
            }
        )
    return progress


def frozen_assignments(plan: PlanResult, stage: SolveStage) -> list[dict[str, str]]:
    if stage == "PRE_LOAD":
        return []
    return [
        {"order_id": order_id, "vehicle_id": route.vehicle_id}
        for route in plan.routes
        for order_id in route.order_ids
    ]


def rebuild_fixed_assignment_plan(
    base_plan: PlanResult,
    dataset: Dataset,
    matrix: MatrixResult,
    *,
    frozen_stop_ids: tuple[str, ...] = (),
) -> PlanResult | None:
    """Recalculate metrics while keeping vehicle assignment and frozen prefix.

    This is a narrow scope adapter around the existing planner route metric
    function. It does not create another solver and never moves an order to a
    different vehicle.
    """
    vehicles = {vehicle.vehicle_id: vehicle for vehicle in dataset.vehicles}
    orders = {order.order_id: order for order in dataset.orders}
    routes: list[VehicleRoute] = []
    for base_route in base_plan.routes:
        vehicle = vehicles.get(base_route.vehicle_id)
        if vehicle is None:
            return None
        route_ids = list(base_route.order_ids)
        route = _route_metrics_preserving_order(
            route_ids,
            vehicle,
            orders,
            matrix,
            legacy=not any(item.time_slot == "EVENING" for item in dataset.orders),
        )
        if route is None:
            return None
        routes.append(route)
    return base_plan.model_copy(
        update={
            "routes": routes,
            "total_distance_m": sum(route.total_distance_m for route in routes),
            "total_driving_time_s": sum(route.total_duration_s for route in routes),
        }
    )


def prioritize_remaining_order(
    base_plan: PlanResult,
    dataset: Dataset,
    matrix: MatrixResult,
    order_id: str,
    frozen_stop_ids: tuple[str, ...] = (),
    timeline_minutes: int | None = None,
) -> PlanResult | None:
    """Re-solve one vehicle's remaining sequence from its current position.

    Vehicle assignment and the completed prefix stay fixed.  The remaining
    stops are selected in deterministic nearest-feasible order, with the
    requested order first when it is legal at the current simulated clock.
    The resulting full sequence is then evaluated by the existing planner
    route calculator so the candidate remains independently verifiable.
    """
    frozen = set(frozen_stop_ids)
    target_route_index = next(
        (index for index, route in enumerate(base_plan.routes) if order_id in route.order_ids),
        None,
    )
    if target_route_index is None or order_id in frozen:
        return None
    target_route = base_plan.routes[target_route_index]
    prefix = []
    for candidate in target_route.order_ids:
        if candidate in frozen:
            prefix.append(candidate)
        else:
            break
    if any(candidate in frozen for candidate in target_route.order_ids[len(prefix) :]):
        return None

    orders = {order.order_id: order for order in dataset.orders}
    matrix_index = {node_id: position for position, node_id in enumerate(matrix.node_ids)}
    legacy = uses_legacy_timing(dataset)
    current_node = prefix[-1] if prefix else "DEPOT-001"
    current_s = max(0, timeline_minutes or 0) * 60
    remaining = [candidate for candidate in target_route.order_ids if candidate not in frozen]
    reordered: list[str] = []
    while remaining:
        choices: list[tuple[int, int, int, int, str, int]] = []
        for candidate in remaining:
            if candidate not in orders or current_node not in matrix_index:
                continue
            from_index = matrix_index[current_node]
            to_index = matrix_index[candidate]
            travel_s = matrix.duration_s[from_index][to_index]
            arrival = _arrival(current_s, travel_s, orders[candidate].time_slot, legacy)
            if arrival is None:
                continue
            if current_s < AFTERNOON_START:
                current_slot = "MORNING"
            elif current_s < EVENING_START:
                current_slot = "AFTERNOON"
            else:
                current_slot = "EVENING"
            slot_is_current_window = orders[candidate].time_slot == current_slot
            slot_rank = 0 if slot_is_current_window else 1
            target_rank = 0 if candidate == order_id and not reordered else 1
            choices.append(
                (
                    slot_rank,
                    target_rank,
                    matrix.distance_m[from_index][to_index],
                    arrival[0],
                    candidate,
                    arrival[1],
                )
            )
        if not choices:
            # Legacy two-slot fixtures predate the v2 route clock.  F5's
            # dispatched path always supplies a timeline and must fail closed
            # when the remaining route cannot be rebuilt.  For the legacy
            # pre-dispatch compatibility path, keep the already validated
            # route available as the read-only preview baseline.
            if timeline_minutes is None and legacy:
                return base_plan
            return None
        _, _, _, _, selected, finish_s = min(choices)
        reordered.append(selected)
        remaining.remove(selected)
        current_node = selected
        current_s = finish_s

    candidate_order_ids = [*prefix, *reordered]
    route_ids_by_vehicle = {
        route.vehicle_id: list(route.order_ids) for route in base_plan.routes
    }
    route_ids_by_vehicle[target_route.vehicle_id] = candidate_order_ids
    candidate_base = base_plan.model_copy(
        update={
            "routes": [
                route.model_copy(update={"order_ids": route_ids_by_vehicle[route.vehicle_id]})
                for route in base_plan.routes
            ]
        }
    )
    rebuilt = rebuild_fixed_assignment_plan(
        candidate_base,
        dataset,
        matrix,
        frozen_stop_ids=frozen_stop_ids,
    )
    if rebuilt is None and timeline_minutes is None and legacy:
        return base_plan
    return rebuilt


def scope_payload(
    plan: PlanResult,
    state: str,
    timeline_minutes: int | None = None,
) -> dict[str, Any]:
    stage = stage_for_state(state)
    progress = route_progress(plan, timeline_minutes) if stage == "DISPATCHED" else []
    return {
        "stage": stage,
        "frozen_vehicle_assignments": frozen_assignments(plan, stage),
        "frozen_stops": [
            item["order_id"]
            for route in progress
            for item in route["stop_statuses"]
            if item["status"] == "COMPLETED"
        ],
        "route_start": {
            "per_vehicle": {
                route["vehicle_id"]: route["current_position"] for route in progress
            }
            if progress
            else {route.vehicle_id: "DEPOT-001" for route in plan.routes}
        },
        "route_end": "DEPOT-001",
        "timeline_minutes": (
            clamp_timeline_minutes(timeline_minutes) if stage == "DISPATCHED" else None
        ),
        "timeline_start_minutes": TIMELINE_START_MINUTES,
        "timeline_end_minutes": TIMELINE_END_MINUTES,
    }


def depot_coordinates() -> tuple[float, float]:
    return SimulatedRouteProvider.depot_latitude, SimulatedRouteProvider.depot_longitude
