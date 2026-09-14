from typing import Any

from src.domain.models import Order, TimeSlot, Vehicle
from src.services.planner import Stop, VehicleRoute


def recommendation_reason(
    route: VehicleRoute,
    stop: Stop,
    vehicle: Vehicle,
    order: Order,
    previous_node_id: str,
    cumulative_load_kg: float,
    provider_mode: str,
    validator_valid: bool,
    algorithm: str,
    capacity_avoidance: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a deterministic, evidence-only reason for an assigned stop.

    This function deliberately receives all numeric evidence from the validated
    plan/dataset/matrix.  It never asks an LLM to infer or calculate values.
    """
    utilization = round(cumulative_load_kg / vehicle.max_load_kg, 6)
    zone_eligible = order.zone_code in vehicle.service_zone_codes
    time_window_legal = stop.time_slot in {
        TimeSlot.MORNING,
        TimeSlot.AFTERNOON,
        TimeSlot.EVENING,
    } and validator_valid
    sequence_basis = (
        "First-Fit eligible vehicle + Nearest Neighbor (fixed simulated matrix)"
        if algorithm == "BASELINE"
        else "OR-Tools CVRPTW sequence (fixed simulated matrix)"
    )
    capacity_note = ""
    if capacity_avoidance:
        capacity_note = (
            f"原本會超過 {capacity_avoidance['source_vehicle_id']} 車的 "
            f"{capacity_avoidance['source_vehicle_max_load_kg']:g} kg 上限，"
            f"改派 {capacity_avoidance['assigned_vehicle_id']} 車。"
        )
    return {
        "summary": (
            f"{vehicle.vehicle_id} 可服務 {order.zone_code}; 訂單 {order.order_id} "
            f"重量 {order.total_weight_kg:g} kg; 分配後載重 {cumulative_load_kg:g} kg "
            f"(使用率 {utilization:.1%}); {stop.time_slot} 時段合法;"
            f"依第 {stop.sequence} 站及固定矩陣距離/順序安排。 {capacity_note}"
        ),
        "evidence": {
            "order_id": order.order_id,
            "vehicle_id": vehicle.vehicle_id,
            "zone_code": order.zone_code,
            "vehicle_zone_eligible": zone_eligible,
            "order_weight_kg": order.total_weight_kg,
            "post_assignment_load_kg": cumulative_load_kg,
            "vehicle_max_load_kg": vehicle.max_load_kg,
            "post_assignment_utilization": utilization,
            "time_slot": stop.time_slot,
            "time_window_legal": time_window_legal,
            "previous_node_id": previous_node_id,
            "sequence": stop.sequence,
            "leg_distance_m": stop.leg_distance_m,
            "leg_duration_s": stop.leg_duration_s,
            "distance_basis": "fixed_simulated_matrix",
            "sequence_basis": sequence_basis,
            "route_provider_mode": provider_mode,
            "validator_valid": validator_valid,
            "capacity_avoidance": capacity_avoidance,
        },
    }
