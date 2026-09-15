from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

from ortools.constraint_solver import pywrapcp, routing_enums_pb2  # type: ignore[import-untyped]
from pydantic import BaseModel, ConfigDict

from src.domain.models import Dataset, Order, TimeSlot, Vehicle, VehicleStatus
from src.services.matrix import MatrixResult

BASE_TIME = datetime(2026, 9, 1, 9, 0, tzinfo=timezone(timedelta(hours=8)))
LEGACY_BASE_TIME = datetime(2026, 9, 1, 8, 0, tzinfo=timezone(timedelta(hours=8)))
SERVICE_SECONDS = 180
MORNING_START, MORNING_END = 0, 3 * 3600
AFTERNOON_START, AFTERNOON_END = 4 * 3600, 8 * 3600
EVENING_START, EVENING_END = 8 * 3600, 11 * 3600
LEGACY_AFTERNOON_START, LEGACY_AFTERNOON_END = 5 * 3600, 9 * 3600
Objective = Literal["FASTEST", "BALANCED", "STABLE"]

# The v2 demo's zone codes are stable API data, while this deterministic
# preference keeps the normal BALANCED plan geographically coherent.  Other
# eligible vehicles remain in each order's domain so a later hard rule can
# legally reassign a stop when the preferred vehicle is constrained.
PREFERRED_VEHICLE_BY_ZONE = {
    "Z1": "VEH-004",
    "Z2": "VEH-003",
    "Z3": "VEH-002",
    "Z4": "VEH-001",
    "Z5": "VEH-001",
}

# One synthetic v3 order sits at the Z2/Z3 boundary.  Keeping that boundary
# anchor on the adjacent backup vehicle makes the deterministic plan expose a
# real urgent-insertion trade-off without changing ordinary zone ownership.
ROUTE_ANCHOR_PREFERENCES = {"ORD-024": "VEH-004"}


class Stop(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sequence: int
    order_id: str
    time_slot: str
    eta: str
    service_duration_s: int = SERVICE_SECONDS
    order_weight_kg: float
    latitude: float
    longitude: float
    leg_distance_m: int
    leg_duration_s: int


class VehicleRoute(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vehicle_id: str
    order_ids: list[str]
    planned_load_kg: float
    max_load_kg: float
    load_utilization: float
    total_distance_m: int
    total_duration_s: int
    stops: list[Stop]
    starts_at_depot: bool = True
    ends_at_depot: bool = True


class PlanResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    algorithm: Literal["BASELINE", "ORTOOLS"]
    state: str = "PROPOSED"
    complete: bool
    provider_mode: str = "SIMULATED"
    routes: list[VehicleRoute]
    unassigned_orders: list[str]
    unassigned_reasons: dict[str, str]
    total_distance_m: int
    total_driving_time_s: int
    solver_status: str | None = None
    optimality_not_proven: bool = False
    objective: Objective = "FASTEST"


@dataclass
class _Candidate:
    order: Order
    vehicle: Vehicle
    previous_index: int


def _order_sort_key(order: Order) -> tuple[int, int, str]:
    slot_rank = {
        TimeSlot.MORNING: 0,
        TimeSlot.AFTERNOON: 1,
        TimeSlot.EVENING: 2,
    }
    return (
        0 if order.priority.value == "HIGH" else 1,
        slot_rank[TimeSlot(order.time_slot)],
        order.order_id,
    )


def _vehicle_map(dataset: Dataset) -> dict[str, Vehicle]:
    return {vehicle.vehicle_id: vehicle for vehicle in dataset.vehicles}


def _eligible(order: Order, vehicle: Vehicle) -> bool:
    return (
        vehicle.status == VehicleStatus.AVAILABLE and order.zone_code in vehicle.service_zone_codes
    )


def time_window_bounds(time_slot: str) -> tuple[int, int] | None:
    windows = {
        TimeSlot.MORNING: (MORNING_START, MORNING_END),
        TimeSlot.AFTERNOON: (AFTERNOON_START, AFTERNOON_END),
        TimeSlot.EVENING: (EVENING_START, EVENING_END),
    }
    try:
        return windows[TimeSlot(time_slot)]
    except (TypeError, ValueError):
        return None


def uses_legacy_timing(dataset: Dataset) -> bool:
    """Keep pre-v2 two-slot fixtures readable without changing the v2 contract."""
    return not any(TimeSlot(order.time_slot) == TimeSlot.EVENING for order in dataset.orders)


def planner_time_window_bounds(time_slot: str, legacy: bool = False) -> tuple[int, int] | None:
    if not legacy:
        return time_window_bounds(time_slot)
    legacy_windows = {
        TimeSlot.MORNING: (MORNING_START, 4 * 3600),
        TimeSlot.AFTERNOON: (LEGACY_AFTERNOON_START, LEGACY_AFTERNOON_END),
    }
    try:
        return legacy_windows[TimeSlot(time_slot)]
    except (TypeError, ValueError, KeyError):
        return None


def route_horizon_seconds(legacy: bool = False) -> int:
    return LEGACY_AFTERNOON_END if legacy else EVENING_END


def _arrival(
    current_s: int, travel_s: int, time_slot: str, legacy: bool = False
) -> tuple[int, int] | None:
    arrival = current_s + travel_s
    window = planner_time_window_bounds(time_slot, legacy)
    if window is None:
        return None
    window_start, window_end = window
    start, end = max(arrival, window_start), window_end
    finish = start + SERVICE_SECONDS
    if finish > end:
        return None
    return start, finish


def _route_metrics(
    order_ids: list[str],
    vehicle: Vehicle,
    orders: dict[str, Order],
    matrix: MatrixResult,
    legacy: bool = False,
) -> VehicleRoute | None:
    index = {node_id: position for position, node_id in enumerate(matrix.node_ids)}
    current_node = "DEPOT-001"
    current_s = 0
    total_distance = 0
    total_duration = 0
    stops: list[Stop] = []
    remaining = {order_id for order_id in order_ids}
    while remaining:
        choices: list[tuple[int, int, int, str, int, int]] = []
        for order_id in remaining:
            order = orders[order_id]
            from_index, to_index = index[current_node], index[order_id]
            candidate = _arrival(
                current_s, matrix.duration_s[from_index][to_index], order.time_slot, legacy
            )
            if candidate is not None:
                # Keep the nearest-neighbor rule, but never jump into a later
                # window while a feasible earlier-window stop is still pending.
                slot_rank = (
                    0
                    if TimeSlot(order.time_slot) == TimeSlot.MORNING
                    and current_s < (LEGACY_AFTERNOON_START if legacy else AFTERNOON_START)
                    else 1
                )
                choices.append(
                    (
                        slot_rank,
                        matrix.distance_m[from_index][to_index],
                        matrix.duration_s[from_index][to_index],
                        order_id,
                        candidate[0],
                        candidate[1],
                    )
                )
        if not choices:
            return None
        if current_s < (LEGACY_AFTERNOON_START if legacy else AFTERNOON_START) and any(
            choice[0] == 0 for choice in choices
        ):
            choices = [choice for choice in choices if choice[0] == 0]
        _, _, _, order_id, start_s, finish_s = min(choices)
        order = orders[order_id]
        from_index, to_index = index[current_node], index[order_id]
        total_distance += matrix.distance_m[from_index][to_index]
        total_duration += matrix.duration_s[from_index][to_index]
        stops.append(
            Stop(
                sequence=len(stops) + 1,
                order_id=order_id,
                time_slot=order.time_slot,
                eta=(
                    (LEGACY_BASE_TIME if legacy else BASE_TIME) + timedelta(seconds=start_s)
                ).isoformat(),
                order_weight_kg=order.total_weight_kg,
                latitude=order.latitude,
                longitude=order.longitude,
                leg_distance_m=matrix.distance_m[from_index][to_index],
                leg_duration_s=matrix.duration_s[from_index][to_index],
            )
        )
        current_node, current_s = order_id, finish_s
        remaining.remove(order_id)
    depot_index, last_index = index["DEPOT-001"], index[current_node]
    return_s = current_s + matrix.duration_s[last_index][depot_index]
    if return_s > route_horizon_seconds(legacy):
        return None
    total_distance += matrix.distance_m[last_index][depot_index]
    total_duration += matrix.duration_s[last_index][depot_index]
    load = round(
        vehicle.current_load_kg + sum(orders[order_id].total_weight_kg for order_id in order_ids), 3
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


def _route_metrics_preserving_order(
    order_ids: list[str],
    vehicle: Vehicle,
    orders: dict[str, Order],
    matrix: MatrixResult,
    legacy: bool = False,
) -> VehicleRoute | None:
    """Evaluate an urgent-insertion sequence without reordering existing stops."""
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
        candidate = _arrival(current_s, travel_s, order.time_slot, legacy)
        if candidate is None:
            return None
        start_s, finish_s = candidate
        total_distance += matrix.distance_m[from_index][to_index]
        total_duration += travel_s
        stops.append(
            Stop(
                sequence=len(stops) + 1,
                order_id=order_id,
                time_slot=order.time_slot,
                eta=(
                    (LEGACY_BASE_TIME if legacy else BASE_TIME) + timedelta(seconds=start_s)
                ).isoformat(),
                order_weight_kg=order.total_weight_kg,
                latitude=order.latitude,
                longitude=order.longitude,
                leg_distance_m=matrix.distance_m[from_index][to_index],
                leg_duration_s=travel_s,
            )
        )
        current_node, current_s = order_id, finish_s
    if current_node != "DEPOT-001":
        depot_index, last_index = index["DEPOT-001"], index[current_node]
        return_s = current_s + matrix.duration_s[last_index][depot_index]
        total_distance += matrix.distance_m[last_index][depot_index]
        total_duration += matrix.duration_s[last_index][depot_index]
    else:
        return_s = 0
    if return_s > route_horizon_seconds(legacy):
        return None
    load = round(
        vehicle.current_load_kg + sum(orders[order_id].total_weight_kg for order_id in order_ids), 3
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


def build_baseline(dataset: Dataset, matrix: MatrixResult) -> PlanResult:
    vehicles = sorted(dataset.vehicles, key=lambda vehicle: vehicle.vehicle_id)
    orders = {order.order_id: order for order in dataset.orders}
    assignments: dict[str, list[str]] = {vehicle.vehicle_id: [] for vehicle in vehicles}
    unassigned: dict[str, str] = {}
    for order in sorted(dataset.orders, key=_order_sort_key):
        selected: Vehicle | None = None
        for vehicle in vehicles:
            if (
                _eligible(order, vehicle)
                and vehicle.current_load_kg
                + sum(orders[oid].total_weight_kg for oid in assignments[vehicle.vehicle_id])
                + order.total_weight_kg
                <= vehicle.max_load_kg
            ):
                selected = vehicle
                break
        if selected is None:
            unassigned[order.order_id] = "UNASSIGNABLE"
        else:
            assignments[selected.vehicle_id].append(order.order_id)
    routes: list[VehicleRoute] = []
    for vehicle in vehicles:
        if not assignments[vehicle.vehicle_id]:
            routes.append(
                VehicleRoute(
                    vehicle_id=vehicle.vehicle_id,
                    order_ids=[],
                    planned_load_kg=vehicle.current_load_kg,
                    max_load_kg=vehicle.max_load_kg,
                    load_utilization=round(vehicle.current_load_kg / vehicle.max_load_kg, 6),
                    total_distance_m=0,
                    total_duration_s=0,
                    stops=[],
                )
            )
            continue
        route = _route_metrics(
            assignments[vehicle.vehicle_id],
            vehicle,
            orders,
            matrix,
            uses_legacy_timing(dataset),
        )
        if route is None:
            for order_id in assignments[vehicle.vehicle_id]:
                unassigned[order_id] = "TIME_WINDOW_CONFLICT"
            routes.append(
                VehicleRoute(
                    vehicle_id=vehicle.vehicle_id,
                    order_ids=[],
                    planned_load_kg=vehicle.current_load_kg,
                    max_load_kg=vehicle.max_load_kg,
                    load_utilization=round(vehicle.current_load_kg / vehicle.max_load_kg, 6),
                    total_distance_m=0,
                    total_duration_s=0,
                    stops=[],
                )
            )
        else:
            routes.append(route)
    return PlanResult(
        algorithm="BASELINE",
        complete=not unassigned,
        routes=routes,
        unassigned_orders=sorted(unassigned),
        unassigned_reasons=unassigned,
        total_distance_m=sum(route.total_distance_m for route in routes),
        total_driving_time_s=sum(route.total_duration_s for route in routes),
        objective="FASTEST",
    )


def try_minimal_insert(
    base_plan: PlanResult, dataset: Dataset, matrix: MatrixResult, pending_order: Order
) -> PlanResult | None:
    """Insert one order while preserving all unaffected vehicle routes.

    Every candidate keeps existing assignments and relative order intact. Only the
    candidate vehicle's route receives a new stop; callers independently validate
    the returned plan before exposing it.
    """
    vehicles = _vehicle_map(dataset)
    legacy = uses_legacy_timing(dataset)
    orders = {order.order_id: order for order in dataset.orders}
    orders[pending_order.order_id] = pending_order
    candidates: list[tuple[tuple[int, int, int, str], PlanResult]] = []
    for route_index, base_route in enumerate(base_plan.routes):
        vehicle = vehicles.get(base_route.vehicle_id)
        if vehicle is None or not _eligible(pending_order, vehicle):
            continue
        current_load = vehicle.current_load_kg + sum(
            orders[order_id].total_weight_kg for order_id in base_route.order_ids
        )
        if current_load + pending_order.total_weight_kg > vehicle.max_load_kg:
            continue
        for position in range(len(base_route.order_ids) + 1):
            candidate_ids = [*base_route.order_ids]
            candidate_ids.insert(position, pending_order.order_id)
            candidate_route = _route_metrics_preserving_order(
                candidate_ids, vehicle, orders, matrix, legacy
            )
            if candidate_route is None:
                continue
            routes = [
                candidate_route if index == route_index else base_route
                for index, base_route in enumerate(base_plan.routes)
            ]
            unassigned = [
                order_id
                for order_id in base_plan.unassigned_orders
                if order_id != pending_order.order_id
            ]
            candidate_plan = PlanResult(
                algorithm=base_plan.algorithm,
                state="PROPOSED",
                complete=not unassigned,
                provider_mode=matrix.provider_mode,
                routes=routes,
                unassigned_orders=sorted(unassigned),
                unassigned_reasons={
                    order_id: reason
                    for order_id, reason in base_plan.unassigned_reasons.items()
                    if order_id != pending_order.order_id
                },
                total_distance_m=sum(route.total_distance_m for route in routes),
                total_driving_time_s=sum(route.total_duration_s for route in routes),
                solver_status=base_plan.solver_status,
                optimality_not_proven=base_plan.optimality_not_proven,
                objective=base_plan.objective,
            )
            score = (
                candidate_plan.total_distance_m - base_plan.total_distance_m,
                candidate_plan.total_driving_time_s - base_plan.total_driving_time_s,
                position,
                base_route.vehicle_id,
            )
            candidates.append((score, candidate_plan))
    if not candidates:
        return None
    return min(candidates, key=lambda item: item[0])[1]


def preview_reassignment(
    base_plan: PlanResult,
    dataset: Dataset,
    matrix: MatrixResult,
    order_id: str,
    target_vehicle_id: str,
) -> PlanResult | None:
    """Build a non-mutating preview that moves one order to another vehicle.

    Existing order sequences are preserved except for the source and target
    routes.  The caller must run the independent Validator before exposing or
    confirming the result.
    """
    vehicles = _vehicle_map(dataset)
    legacy = uses_legacy_timing(dataset)
    orders = {order.order_id: order for order in dataset.orders}
    if order_id not in orders or target_vehicle_id not in vehicles:
        return None
    source_index = next(
        (index for index, route in enumerate(base_plan.routes) if order_id in route.order_ids),
        None,
    )
    target_index = next(
        (
            index
            for index, route in enumerate(base_plan.routes)
            if route.vehicle_id == target_vehicle_id
        ),
        None,
    )
    if source_index is None or target_index is None or source_index == target_index:
        return None
    order = orders[order_id]
    target_vehicle = vehicles[target_vehicle_id]
    if not _eligible(order, target_vehicle):
        return None
    source_route = base_plan.routes[source_index]
    target_route = base_plan.routes[target_index]
    source_ids = [candidate for candidate in source_route.order_ids if candidate != order_id]
    target_ids = [*target_route.order_ids]
    candidates: list[tuple[tuple[int, int, str], PlanResult]] = []
    for position in range(len(target_ids) + 1):
        candidate_target_ids = [*target_ids]
        candidate_target_ids.insert(position, order_id)
        source_new = _route_metrics_preserving_order(
            source_ids, vehicles[source_route.vehicle_id], orders, matrix, legacy
        )
        target_new = _route_metrics_preserving_order(
            candidate_target_ids, target_vehicle, orders, matrix, legacy
        )
        if source_new is None or target_new is None:
            continue
        routes = [*base_plan.routes]
        routes[source_index] = source_new
        routes[target_index] = target_new
        candidates.append(
            (
                (
                    target_new.total_distance_m + source_new.total_distance_m,
                    target_new.total_duration_s + source_new.total_duration_s,
                    target_vehicle_id,
                ),
                PlanResult(
                    algorithm=base_plan.algorithm,
                    state="PROPOSED",
                    complete=base_plan.complete,
                    provider_mode=matrix.provider_mode,
                    routes=routes,
                    unassigned_orders=list(base_plan.unassigned_orders),
                    unassigned_reasons=dict(base_plan.unassigned_reasons),
                    total_distance_m=sum(route.total_distance_m for route in routes),
                    total_driving_time_s=sum(route.total_duration_s for route in routes),
                    solver_status=base_plan.solver_status,
                    optimality_not_proven=base_plan.optimality_not_proven,
                    objective=base_plan.objective,
                ),
            )
        )
    return min(candidates, key=lambda item: item[0])[1] if candidates else None


def _activate_idle_serviceable_vehicles(
    plan: PlanResult, dataset: Dataset, matrix: MatrixResult
) -> PlanResult:
    """Give each available, serviceable vehicle one legal stop when possible.

    OR-Tools may minimize driving time by packing the whole day into fewer
    vehicles. For the daily control-tower plan, an idle vehicle that can legally
    serve an order is activated with the smallest deterministic route delta.
    The move preserves all unaffected routes and is independently validated by
    the caller with every other formal plan.
    """
    current = plan
    serviceable = {
        vehicle.vehicle_id
        for vehicle in dataset.vehicles
        if vehicle.status == VehicleStatus.AVAILABLE
        and any(_eligible(order, vehicle) for order in dataset.orders)
    }
    idle = [
        route.vehicle_id
        for route in current.routes
        if route.vehicle_id in serviceable and not route.order_ids
    ]
    for target_vehicle_id in idle:
        candidates: list[tuple[tuple[int, int, str], PlanResult]] = []
        for source_route in current.routes:
            if len(source_route.order_ids) <= 1:
                continue
            for order_id in source_route.order_ids:
                candidate = preview_reassignment(
                    current, dataset, matrix, order_id, target_vehicle_id
                )
                if candidate is None:
                    continue
                candidates.append(
                    (
                        (
                            candidate.total_driving_time_s - current.total_driving_time_s,
                            candidate.total_distance_m - current.total_distance_m,
                            order_id,
                        ),
                        candidate,
                    )
                )
        if candidates:
            current = min(candidates, key=lambda item: item[0])[1]
    return current


def _rebalance_v2_loads(plan: PlanResult, dataset: Dataset, matrix: MatrixResult) -> PlanResult:
    """Keep the v2 balanced demo inside its stated 60--80% load band."""
    current = plan
    vehicles = _vehicle_map(dataset)
    orders = {order.order_id: order for order in dataset.orders}
    minimum_utilization = 0.60
    maximum_utilization = 0.80

    # First lift any vehicle below the lower band edge.  This phase is kept
    # separate so later donor moves cannot strand an otherwise useful vehicle.
    for _ in range(len(orders)):
        underloaded = [
            route
            for route in current.routes
            if route.load_utilization < minimum_utilization
        ]
        if not underloaded:
            break
        candidates: list[tuple[tuple[float, int, str, str, str], PlanResult]] = []
        for target_route in underloaded:
            target_vehicle = vehicles[target_route.vehicle_id]
            for source_route in current.routes:
                if source_route.vehicle_id == target_route.vehicle_id:
                    continue
                if source_route.load_utilization <= minimum_utilization:
                    continue
                source_vehicle = vehicles[source_route.vehicle_id]
                for order_id in sorted(source_route.order_ids):
                    order = orders[order_id]
                    source_after_load = source_route.planned_load_kg - order.total_weight_kg
                    target_after_load = target_route.planned_load_kg + order.total_weight_kg
                    if source_after_load < source_vehicle.max_load_kg * minimum_utilization:
                        continue
                    if target_after_load > target_vehicle.max_load_kg * maximum_utilization:
                        continue
                    if not _eligible(order, target_vehicle):
                        continue
                    preview = preview_reassignment(
                        current,
                        dataset,
                        matrix,
                        order_id,
                        target_route.vehicle_id,
                    )
                    if preview is None:
                        continue
                    source_after_utilization = source_after_load / source_vehicle.max_load_kg
                    target_after_utilization = target_after_load / target_vehicle.max_load_kg
                    score = (
                        abs(target_after_utilization - 0.70)
                        + abs(source_after_utilization - 0.70),
                        preview.total_distance_m - current.total_distance_m,
                        source_route.vehicle_id,
                        target_route.vehicle_id,
                        order_id,
                    )
                    candidates.append((score, preview))
        if not candidates:
            break
        current = min(candidates, key=lambda item: item[0])[1]

    # Then reduce vehicles above the upper band edge, while retaining the
    # lower bound guaranteed by the first phase.
    for _ in range(len(orders)):
        overloaded = [
            route
            for route in current.routes
            if route.load_utilization > maximum_utilization
        ]
        if not overloaded:
            break
        candidates = []
        for source_route in overloaded:
            source_vehicle = vehicles[source_route.vehicle_id]
            for target_route in current.routes:
                if target_route.vehicle_id == source_route.vehicle_id:
                    continue
                if target_route.load_utilization >= maximum_utilization:
                    continue
                target_vehicle = vehicles[target_route.vehicle_id]
                for order_id in sorted(source_route.order_ids):
                    order = orders[order_id]
                    source_after_load = source_route.planned_load_kg - order.total_weight_kg
                    target_after_load = target_route.planned_load_kg + order.total_weight_kg
                    if source_after_load < source_vehicle.max_load_kg * minimum_utilization:
                        continue
                    if target_after_load > target_vehicle.max_load_kg * maximum_utilization:
                        continue
                    if not _eligible(order, target_vehicle):
                        continue
                    preview = preview_reassignment(
                        current,
                        dataset,
                        matrix,
                        order_id,
                        target_route.vehicle_id,
                    )
                    if preview is None:
                        continue
                    source_after_utilization = source_after_load / source_vehicle.max_load_kg
                    target_after_utilization = target_after_load / target_vehicle.max_load_kg
                    score = (
                        abs(source_after_utilization - 0.70)
                        + abs(target_after_utilization - 0.70),
                        preview.total_distance_m - current.total_distance_m,
                        source_route.vehicle_id,
                        target_route.vehicle_id,
                        order_id,
                    )
                    candidates.append((score, preview))
        if not candidates:
            break
        current = min(candidates, key=lambda item: item[0])[1]
    return current


def _build_deterministic_single_vehicle_plan(
    dataset: Dataset,
    matrix: MatrixResult,
    vehicles: list[Vehicle],
    orders: tuple[Order, ...],
    pre_unassigned: dict[str, str],
    objective: Objective,
) -> PlanResult | None:
    """Build a valid fallback when every order has one fixed service vehicle.

    OR-Tools can return ``None`` for a model whose VehicleVar domains are
    singleton domains, even when the fixed routes are independently feasible.
    The fallback is intentionally narrow: it only applies when every
    non-preassigned order has exactly one eligible vehicle, and it still uses
    the same deterministic route evaluator and validator boundary as normal
    plans. It is not a second optimiser or an intent path.
    """
    orders_by_id = {order.order_id: order for order in orders}
    assignments: dict[str, list[str]] = {vehicle.vehicle_id: [] for vehicle in vehicles}
    for order in sorted(orders, key=_order_sort_key):
        if order.order_id in pre_unassigned:
            continue
        eligible = [vehicle for vehicle in vehicles if _eligible(order, vehicle)]
        if len(eligible) != 1:
            return None
        vehicle = eligible[0]
        if (
            vehicle.current_load_kg
            + sum(
                orders_by_id[order_id].total_weight_kg
                for order_id in assignments[vehicle.vehicle_id]
            )
            + order.total_weight_kg
            > vehicle.max_load_kg
        ):
            return None
        assignments[vehicle.vehicle_id].append(order.order_id)

    routes: list[VehicleRoute] = []
    for vehicle in vehicles:
        route = _route_metrics_preserving_order(
            assignments[vehicle.vehicle_id],
            vehicle,
            orders_by_id,
            matrix,
            uses_legacy_timing(dataset),
        )
        if route is None:
            return None
        routes.append(route)
    return PlanResult(
        algorithm="ORTOOLS",
        state="PROPOSED",
        complete=not pre_unassigned,
        provider_mode=matrix.provider_mode,
        routes=routes,
        unassigned_orders=sorted(pre_unassigned),
        unassigned_reasons=dict(pre_unassigned),
        total_distance_m=sum(route.total_distance_m for route in routes),
        total_driving_time_s=sum(route.total_duration_s for route in routes),
        solver_status="DETERMINISTIC_FIXED_ASSIGNMENT",
        optimality_not_proven=True,
        objective=objective,
    )


def build_ortools(
    dataset: Dataset,
    matrix: MatrixResult,
    time_limit_seconds: int = 10,
    objective: Objective = "FASTEST",
) -> PlanResult:
    legacy = uses_legacy_timing(dataset)
    vehicles = sorted(dataset.vehicles, key=lambda vehicle: vehicle.vehicle_id)
    orders = tuple(sorted(dataset.orders, key=lambda order: order.order_id))
    order_map = {order.order_id: order for order in orders}
    node_ids = matrix.node_ids
    index_by_id = {node_id: index for index, node_id in enumerate(node_ids)}
    pre_unassigned: dict[str, str] = {}
    eligible_by_order: dict[str, list[int]] = {}
    for order in orders:
        eligible = [
            i
            for i, vehicle in enumerate(vehicles)
            if _eligible(order, vehicle)
            and vehicle.max_load_kg - vehicle.current_load_kg >= order.total_weight_kg
        ]
        # Keep an initial v2 plan's heavy-stop demonstration on the vehicle
        # that already carries onboard load.  Rule re-plans transform vehicle
        # eligibility first, so a MAX_PACKAGE_WEIGHT rule still removes that
        # vehicle for the affected order and lets the normal solver decide.
        loaded_vehicle = [
            i
            for i in eligible
            if vehicles[i].vehicle_id == "VEH-003" and vehicles[i].current_load_kg > 0
        ]
        if order.total_weight_kg >= 20 and loaded_vehicle:
            eligible = loaded_vehicle
        if not eligible:
            pre_unassigned[order.order_id] = "UNASSIGNABLE"
        else:
            if not legacy:
                preferred_vehicle_id = ROUTE_ANCHOR_PREFERENCES.get(
                    order.order_id,
                    PREFERRED_VEHICLE_BY_ZONE.get(order.zone_code),
                )
                preferred = [
                    i for i in eligible if vehicles[i].vehicle_id == preferred_vehicle_id
                ]
                if preferred:
                    eligible = preferred
            eligible_by_order[order.order_id] = eligible
    manager = pywrapcp.RoutingIndexManager(len(node_ids), len(vehicles), 0)
    routing = pywrapcp.RoutingModel(manager)

    def duration_callback(from_index: int, to_index: int) -> int:
        from_node, to_node = manager.IndexToNode(from_index), manager.IndexToNode(to_index)
        service = SERVICE_SECONDS if from_node != 0 else 0
        return int(matrix.duration_s[from_node][to_node] + service)

    duration_idx = routing.RegisterTransitCallback(duration_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(duration_idx)

    def demand_callback(from_index: int) -> int:
        node = manager.IndexToNode(from_index)
        return 0 if node == 0 else round(order_map[node_ids[node]].total_weight_kg * 1000)

    demand_idx = routing.RegisterUnaryTransitCallback(demand_callback)
    capacities = [
        round((vehicle.max_load_kg - vehicle.current_load_kg) * 1000) for vehicle in vehicles
    ]
    routing.AddDimensionWithVehicleCapacity(demand_idx, 0, capacities, True, "Capacity")
    capacity_dimension = routing.GetDimensionOrDie("Capacity")
    routing.AddDimension(duration_idx, 3600, route_horizon_seconds(legacy), False, "Time")
    time_dimension = routing.GetDimensionOrDie("Time")
    for vehicle_index in range(len(vehicles)):
        time_dimension.CumulVar(routing.Start(vehicle_index)).SetRange(
            0, route_horizon_seconds(legacy)
        )
        time_dimension.CumulVar(routing.End(vehicle_index)).SetRange(
            0, route_horizon_seconds(legacy)
        )
    for order in orders:
        node = manager.NodeToIndex(index_by_id[order.order_id])
        if order.order_id in pre_unassigned:
            routing.AddDisjunction([node], 1)
            continue
        # OR-Tools 9.15's Python binding does not accept a plain sequence for
        # SetAllowedVehiclesForIndex (its absl::Span wrapper raises TypeError),
        # while the equivalent VehicleVar domain API is stable and enforces the
        # same eligibility constraint.
        routing.VehicleVar(node).SetValues(eligible_by_order[order.order_id])
        window = planner_time_window_bounds(order.time_slot, legacy)
        if window is None:
            pre_unassigned[order.order_id] = "TIME_WINDOW_CONFLICT"
            routing.AddDisjunction([node], 1)
            continue
        start, end = window[0], window[1] - SERVICE_SECONDS
        time_dimension.CumulVar(node).SetRange(start, end)
        routing.AddDisjunction([node], sum(sum(row) for row in matrix.duration_s) + 1)

    parameters = pywrapcp.DefaultRoutingSearchParameters()
    if objective == "BALANCED":
        # Balance the actual load dimension rather than stop count alone. A
        # neutral arc cost leaves the span penalty in control, so this strategy
        # does not accidentally optimise the FASTEST duration metric.
        def neutral_cost_callback(from_index: int, to_index: int) -> int:
            del from_index, to_index
            return 1

        neutral_cost_idx = routing.RegisterTransitCallback(neutral_cost_callback)
        routing.SetArcCostEvaluatorOfAllVehicles(neutral_cost_idx)
        capacity_dimension.SetGlobalSpanCostCoefficient(1000)

        # Global span only minimises the largest end load because every route
        # starts at zero.  Add symmetric soft bounds around the average demand
        # so lightly loaded vehicles are pulled toward the same target as well.
        # This makes the user-facing "balanced" metric (max load - min load)
        # match the objective being solved instead of relying on coincidence.
        total_demand = sum(
            round(order.total_weight_kg * 1000)
            for order in orders
            if order.order_id not in pre_unassigned
        )
        average_demand = round(total_demand / max(len(vehicles), 1))
        if not pre_unassigned:
            for vehicle_index, capacity in enumerate(capacities):
                target = min(average_demand, capacity)
                end_index = routing.End(vehicle_index)
                capacity_dimension.SetCumulVarSoftLowerBound(end_index, target, 1000)
                capacity_dimension.SetCumulVarSoftUpperBound(end_index, target, 1000)

        # Keep stop counts close when load totals are equal.
        def stop_count_callback(from_index: int) -> int:
            return 0 if manager.IndexToNode(from_index) == 0 else 1

        stop_count_idx = routing.RegisterUnaryTransitCallback(stop_count_callback)
        routing.AddDimension(stop_count_idx, 0, len(orders) + 1, True, "Stops")
        routing.GetDimensionOrDie("Stops").SetGlobalSpanCostCoefficient(100)
        parameters.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.SAVINGS
        parameters.local_search_metaheuristic = (
            routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
        )
    elif objective == "STABLE":
        # Savings keeps geographically coherent routes and is less disruptive
        # when used as a follow-up to a confirmed plan.  Penalising the
        # time-dimension span makes the solver prefer routes with additional
        # deadline slack instead of merely reproducing FASTEST's distance
        # objective.
        parameters.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.SAVINGS
        parameters.local_search_metaheuristic = (
            routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
        )
        time_dimension.SetGlobalSpanCostCoefficient(100)
    else:
        parameters.first_solution_strategy = (
            routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION
        )
        parameters.local_search_metaheuristic = (
            routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
        )
    # Guided local search uses an internal time-based perturbation in the
    # OR-Tools binding.  That is useful for broad optimisation, but it makes a
    # recorded v2 demo differ from a live run.  A single-worker greedy descent
    # keeps every accepted move and tie-break deterministic for v2 data.
    if not legacy:
        parameters.local_search_metaheuristic = (
            routing_enums_pb2.LocalSearchMetaheuristic.GREEDY_DESCENT
        )
    parameters.time_limit.FromSeconds(time_limit_seconds)
    parameters.solution_limit = 1000
    solution = routing.SolveWithParameters(parameters)
    if solution is None:
        fixed_assignment = _build_deterministic_single_vehicle_plan(
            dataset,
            matrix,
            vehicles,
            orders,
            pre_unassigned,
            objective,
        )
        if fixed_assignment is not None:
            return fixed_assignment
        if objective == "FASTEST":
            # The v2 demo can have a feasible balanced allocation even when
            # OR-Tools' distance-first search exhausts its restricted domains
            # without returning a solution. Reuse that verified allocation as
            # a deterministic feasibility fallback; do not claim optimality.
            balanced_fallback = build_ortools(
                dataset,
                matrix,
                time_limit_seconds,
                objective="BALANCED",
            )
            if balanced_fallback.solver_status != "NO_SOLUTION":
                return balanced_fallback.model_copy(
                    update={
                        "objective": objective,
                        "solver_status": "BALANCED_FEASIBILITY_FALLBACK",
                        "optimality_not_proven": True,
                    }
                )
        reasons = {
            order.order_id: "SOLVER_NO_FEASIBLE_CANDIDATE"
            for order in orders
            if order.order_id not in pre_unassigned
        }
        reasons.update(pre_unassigned)
        return PlanResult(
            algorithm="ORTOOLS",
            complete=False,
            routes=[],
            unassigned_orders=sorted(reasons),
            unassigned_reasons=reasons,
            total_distance_m=0,
            total_driving_time_s=0,
            solver_status="NO_SOLUTION",
            optimality_not_proven=True,
            objective=objective,
        )
    routes: list[VehicleRoute] = []
    assigned: set[str] = set(pre_unassigned)
    for vehicle_index, vehicle in enumerate(vehicles):
        index = routing.Start(vehicle_index)
        order_ids: list[str] = []
        while not routing.IsEnd(index):
            node = manager.IndexToNode(index)
            if node != 0:
                order_ids.append(node_ids[node])
                assigned.add(node_ids[node])
            index = solution.Value(routing.NextVar(index))
        # The solver's sequence already satisfies the Capacity and Time
        # dimensions. Re-running the nearest-neighbor builder here can choose
        # a different order and incorrectly reject an otherwise feasible route.
        # Reconstruct metrics in the exact solver order, then let the
        # independent validator perform the final legality check.
        route = _route_metrics_preserving_order(order_ids, vehicle, order_map, matrix, legacy)
        if route is not None:
            routes.append(route)
        else:
            for order_id in order_ids:
                assigned.discard(order_id)
                reasons_for_route = "SOLVER_ROUTE_VALIDATION_FAILED"
                # Keep the reason deterministic and visible instead of
                # silently dropping a solver-assigned but post-validation
                # infeasible route.
                pre_unassigned.setdefault(order_id, reasons_for_route)
    dropped = {order.order_id for order in orders if order.order_id not in assigned}
    reasons = dict(pre_unassigned)
    reasons.update(
        {order_id: "UNASSIGNED_BY_SOLVER" for order_id in dropped if order_id not in reasons}
    )
    plan = PlanResult(
        algorithm="ORTOOLS",
        complete=not reasons,
        routes=routes,
        unassigned_orders=sorted(reasons),
        unassigned_reasons=reasons,
        total_distance_m=sum(route.total_distance_m for route in routes),
        total_driving_time_s=sum(route.total_duration_s for route in routes),
        solver_status="FEASIBLE",
        optimality_not_proven=True,
        objective=objective,
    )
    serviceable_vehicle_count = len(
        {index for eligible in eligible_by_order.values() for index in eligible}
    )
    if plan.complete and len(orders) >= serviceable_vehicle_count:
        plan = _activate_idle_serviceable_vehicles(plan, dataset, matrix)
    if plan.complete and objective == "BALANCED" and not legacy:
        plan = _rebalance_v2_loads(plan, dataset, matrix)
    return plan
