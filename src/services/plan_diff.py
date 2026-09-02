from typing import Any

from src.services.planner import PlanResult


def compute_plan_diff(before: PlanResult, after: PlanResult) -> dict[str, Any]:
    """Compare two deterministic plans without relying on model-generated text."""
    before_assignment = {
        order_id: route.vehicle_id
        for route in before.routes
        for order_id in route.order_ids
    }
    after_assignment = {
        order_id: route.vehicle_id
        for route in after.routes
        for order_id in route.order_ids
    }
    before_sequence = {
        stop.order_id: (route.vehicle_id, stop.sequence)
        for route in before.routes
        for stop in route.stops
    }
    after_sequence = {
        stop.order_id: (route.vehicle_id, stop.sequence)
        for route in after.routes
        for stop in route.stops
    }
    reassigned_orders = [
        {
            "order_id": order_id,
            "from_vehicle_id": before_assignment[order_id],
            "to_vehicle_id": after_assignment[order_id],
        }
        for order_id in sorted(set(before_assignment) & set(after_assignment))
        if before_assignment[order_id] != after_assignment[order_id]
    ]
    sequence_changes = []
    for order_id in sorted(set(before_sequence) | set(after_sequence)):
        previous = before_sequence.get(order_id)
        current = after_sequence.get(order_id)
        if previous != current:
            sequence_changes.append(
                {
                    "order_id": order_id,
                    "from_vehicle_id": previous[0] if previous else None,
                    "to_vehicle_id": current[0] if current else None,
                    "from_sequence": previous[1] if previous else None,
                    "to_sequence": current[1] if current else None,
                }
            )

    before_routes = {route.vehicle_id: route for route in before.routes}
    after_routes = {route.vehicle_id: route for route in after.routes}
    vehicle_load_changes = []
    for vehicle_id in sorted(set(before_routes) | set(after_routes)):
        before_route = before_routes.get(vehicle_id)
        after_route = after_routes.get(vehicle_id)
        before_load = before_route.planned_load_kg if before_route else 0.0
        after_load = after_route.planned_load_kg if after_route else 0.0
        before_utilization = before_route.load_utilization if before_route else 0.0
        after_utilization = after_route.load_utilization if after_route else 0.0
        vehicle_load_changes.append(
            {
                "vehicle_id": vehicle_id,
                "before_load_kg": before_load,
                "after_load_kg": after_load,
                "delta_load_kg": round(after_load - before_load, 3),
                "before_utilization": before_utilization,
                "after_utilization": after_utilization,
                "delta_utilization": round(after_utilization - before_utilization, 6),
            }
        )
    return {
        "reassigned_orders": reassigned_orders,
        "sequence_changes": sequence_changes,
        "vehicle_load_changes": vehicle_load_changes,
        "total_distance_delta_m": after.total_distance_m - before.total_distance_m,
        "total_duration_delta_s": after.total_driving_time_s - before.total_driving_time_s,
    }
