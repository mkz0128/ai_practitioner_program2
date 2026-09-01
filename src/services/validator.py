from pydantic import BaseModel, ConfigDict

from src.domain.models import Dataset, VehicleStatus
from src.services.matrix import MatrixResult
from src.services.planner import AM_END, PM_END, SERVICE_SECONDS, PlanResult


class PlanValidation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    valid: bool
    violations: dict[str, int]
    errors: list[str]


def validate_plan(dataset: Dataset, plan: PlanResult, matrix: MatrixResult) -> PlanValidation:
    orders = {order.order_id: order for order in dataset.orders}
    vehicles = {vehicle.vehicle_id: vehicle for vehicle in dataset.vehicles}
    matrix_index = {node_id: index for index, node_id in enumerate(matrix.node_ids)}
    seen: list[str] = []
    errors: list[str] = []
    violations = {"overload": 0, "cross_zone": 0, "duplicate": 0, "time_window": 0}
    for route in plan.routes:
        vehicle = vehicles.get(route.vehicle_id)
        if vehicle is None or vehicle.status != VehicleStatus.AVAILABLE:
            errors.append(f"invalid_vehicle:{route.vehicle_id}")
            continue
        route_stop_ids = [stop.order_id for stop in route.stops]
        if route.order_ids != route_stop_ids:
            errors.append(f"route_stop_order_mismatch:{route.vehicle_id}")
        expected_load = vehicle.current_load_kg + sum(
            orders[order_id].total_weight_kg for order_id in route_stop_ids if order_id in orders
        )
        if abs(route.planned_load_kg - expected_load) > 1e-6:
            errors.append(f"load_total_mismatch:{route.vehicle_id}")
        if route.planned_load_kg > vehicle.max_load_kg + 1e-6:
            violations["overload"] += 1
        previous = "DEPOT-001"
        current_s = 0
        route_distance = 0
        route_duration = 0
        for stop in route.stops:
            if stop.order_id not in orders:
                errors.append(f"unknown_order:{stop.order_id}")
                continue
            if stop.order_id in seen:
                violations["duplicate"] += 1
            seen.append(stop.order_id)
            if orders[stop.order_id].zone_code not in vehicle.service_zone_codes:
                violations["cross_zone"] += 1
            order = orders[stop.order_id]
            if stop.time_slot not in {"AM", "PM"}:
                violations["time_window"] += 1
            if previous not in matrix_index or stop.order_id not in matrix_index:
                errors.append(f"missing_matrix_node:{stop.order_id}")
                continue
            from_index = matrix_index[previous]
            to_index = matrix_index[stop.order_id]
            leg_duration = matrix.duration_s[from_index][to_index]
            arrival = current_s + leg_duration
            window_start, window_end = (
                (0, AM_END) if order.time_slot == "AM" else (5 * 3600, PM_END)
            )
            service_start = max(arrival, window_start)
            service_finish = service_start + SERVICE_SECONDS
            if service_finish > window_end:
                violations["time_window"] += 1
            current_s = service_finish
            route_distance += matrix.distance_m[from_index][to_index]
            route_duration += leg_duration
            previous = stop.order_id
        if previous not in matrix_index:
            errors.append(f"missing_matrix_node:{previous}")
        else:
            depot_index = matrix_index["DEPOT-001"]
            last_index = matrix_index[previous]
            return_duration = matrix.duration_s[last_index][depot_index]
            if current_s + return_duration > PM_END:
                violations["time_window"] += 1
            route_distance += matrix.distance_m[last_index][depot_index]
            route_duration += return_duration
        if route.total_distance_m != route_distance:
            errors.append(f"distance_total_mismatch:{route.vehicle_id}")
        if route.total_duration_s != route_duration:
            errors.append(f"duration_total_mismatch:{route.vehicle_id}")
    assigned = set(seen)
    unassigned = set(plan.unassigned_orders)
    if assigned & unassigned:
        errors.append("assigned_and_unassigned_overlap")
    if assigned | unassigned != set(orders):
        errors.append("order_reconciliation_mismatch")
    if len(seen) != len(set(seen)):
        violations["duplicate"] += 1
    if any(value > 0 for value in violations.values()) or errors:
        return PlanValidation(valid=False, violations=violations, errors=errors)
    return PlanValidation(valid=True, violations=violations, errors=[])
