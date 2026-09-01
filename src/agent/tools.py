from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from src.domain.models import Dataset
from src.services.planner import PlanResult


class AssignmentEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    order_id: str
    vehicle_id: str | None
    assigned: bool
    zone_eligible: bool | None
    order_weight_kg: float
    planned_load_kg: float | None
    max_load_kg: float | None
    load_utilization: float | None
    provider_mode: str
    reason: str | None = None


def explain_assignment(
    dataset: Dataset, plan: PlanResult, order_id: str, provider_mode: str
) -> AssignmentEvidence:
    orders = {order.order_id: order for order in dataset.orders}
    order = orders.get(order_id)
    if order is None:
        raise ValueError("UNKNOWN_ORDER")
    for route in plan.routes:
        if order_id in route.order_ids:
            vehicle = next(
                vehicle for vehicle in dataset.vehicles if vehicle.vehicle_id == route.vehicle_id
            )
            return AssignmentEvidence(
                order_id=order_id,
                vehicle_id=route.vehicle_id,
                assigned=True,
                zone_eligible=order.zone_code in vehicle.service_zone_codes,
                order_weight_kg=order.total_weight_kg,
                planned_load_kg=route.planned_load_kg,
                max_load_kg=route.max_load_kg,
                load_utilization=route.load_utilization,
                provider_mode=provider_mode,
            )
    return AssignmentEvidence(
        order_id=order_id,
        vehicle_id=None,
        assigned=False,
        zone_eligible=None,
        order_weight_kg=order.total_weight_kg,
        planned_load_kg=None,
        max_load_kg=None,
        load_utilization=None,
        provider_mode=provider_mode,
        reason=plan.unassigned_reasons.get(order_id, "UNASSIGNED"),
    )
