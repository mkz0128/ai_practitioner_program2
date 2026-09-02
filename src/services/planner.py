from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

from ortools.constraint_solver import pywrapcp, routing_enums_pb2  # type: ignore[import-untyped]
from pydantic import BaseModel, ConfigDict

from src.domain.models import Dataset, Order, Vehicle, VehicleStatus
from src.services.matrix import MatrixResult

BASE_TIME = datetime(2026, 9, 1, 8, 0, tzinfo=timezone(timedelta(hours=8)))
SERVICE_SECONDS = 180
AM_START, AM_END = 0, 4 * 3600
PM_START, PM_END = 5 * 3600, 9 * 3600


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


@dataclass
class _Candidate:
    order: Order
    vehicle: Vehicle
    previous_index: int


def _order_sort_key(order: Order) -> tuple[int, int, str]:
    return (
        0 if order.priority.value == "HIGH" else 1,
        0 if order.time_slot == "AM" else 1,
        order.order_id,
    )


def _vehicle_map(dataset: Dataset) -> dict[str, Vehicle]:
    return {vehicle.vehicle_id: vehicle for vehicle in dataset.vehicles}


def _eligible(order: Order, vehicle: Vehicle) -> bool:
    return (
        vehicle.status == VehicleStatus.AVAILABLE and order.zone_code in vehicle.service_zone_codes
    )


def _arrival(current_s: int, travel_s: int, time_slot: str) -> tuple[int, int] | None:
    arrival = current_s + travel_s
    if time_slot == "AM":
        start, end = max(arrival, AM_START), AM_END
    else:
        start, end = max(arrival, PM_START), PM_END
    finish = start + SERVICE_SECONDS
    if finish > end:
        return None
    return start, finish


def _route_metrics(
    order_ids: list[str], vehicle: Vehicle, orders: dict[str, Order], matrix: MatrixResult
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
                current_s, matrix.duration_s[from_index][to_index], order.time_slot
            )
            if candidate is not None:
                # Keep the nearest-neighbor rule, but never jump into the PM
                # window while a feasible AM stop is still pending.
                slot_rank = 0 if order.time_slot == "AM" and current_s < PM_START else 1
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
        if current_s < PM_START and any(choice[0] == 0 for choice in choices):
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
                eta=(BASE_TIME + timedelta(seconds=start_s)).isoformat(),
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
    if return_s > PM_END:
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
        route = _route_metrics(assignments[vehicle.vehicle_id], vehicle, orders, matrix)
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
    )


def build_ortools(
    dataset: Dataset, matrix: MatrixResult, time_limit_seconds: int = 10
) -> PlanResult:
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
        if not eligible:
            pre_unassigned[order.order_id] = "UNASSIGNABLE"
        else:
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
    routing.AddDimension(duration_idx, 3600, PM_END, False, "Time")
    time_dimension = routing.GetDimensionOrDie("Time")
    for vehicle_index in range(len(vehicles)):
        time_dimension.CumulVar(routing.Start(vehicle_index)).SetRange(0, PM_END)
        time_dimension.CumulVar(routing.End(vehicle_index)).SetRange(0, PM_END)
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
        start, end = (
            (AM_START, AM_END - SERVICE_SECONDS)
            if order.time_slot == "AM"
            else (PM_START, PM_END - SERVICE_SECONDS)
        )
        time_dimension.CumulVar(node).SetRange(start, end)
        routing.AddDisjunction([node], sum(sum(row) for row in matrix.duration_s) + 1)
    parameters = pywrapcp.DefaultRoutingSearchParameters()
    parameters.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION
    )
    parameters.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    parameters.time_limit.FromSeconds(time_limit_seconds)
    parameters.solution_limit = 1000
    solution = routing.SolveWithParameters(parameters)
    if solution is None:
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
        route = _route_metrics(order_ids, vehicle, order_map, matrix)
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
    return PlanResult(
        algorithm="ORTOOLS",
        complete=not reasons,
        routes=routes,
        unassigned_orders=sorted(reasons),
        unassigned_reasons=reasons,
        total_distance_m=sum(route.total_distance_m for route in routes),
        total_driving_time_s=sum(route.total_duration_s for route in routes),
        solver_status="FEASIBLE",
        optimality_not_proven=True,
    )
