from __future__ import annotations

from datetime import timedelta
from math import ceil
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from src.domain.models import Dataset
from src.services.dispatch_parameters import DEFAULT_SERVICE_MINUTES
from src.services.planner import PlanResult
from src.services.solve_scope import ROUTE_BASE_TIME, route_progress

DEVIATION_START_MINUTES = 60


class VehicleDeviation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    vehicle_id: str
    delay_minutes: int = Field(ge=0)
    expected_completed_count: int = Field(ge=0)
    actual_completed_count: int = Field(ge=0)
    message: str
    recorded: bool = True


class ZoneDeviation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    zone_code: str
    extra_service_minutes_per_stop: int = Field(ge=0)
    baseline_service_minutes: int = Field(ge=1)
    suggested_service_minutes: int = Field(ge=1)
    reason: str
    message: str
    recorded: bool = True


def _empty_deviation_payload(timeline_minutes: int | None) -> dict[str, Any]:
    return {
        "source": "TIMELINE_SIMULATION",
        "timeline_minutes": timeline_minutes,
        "recorded_at": None,
        "has_deviations": False,
        "vehicle_deviations": [],
        "zone_deviations": [],
        "suggestions": [],
    }


def _vehicle_lag_minutes(plan: PlanResult, dataset: Dataset) -> dict[str, int]:
    """Derive each route's simulated delay from data, never from an ID.

    A non-zero vehicle starting load represents deterministic handling work in
    the demo clock.  If a dataset has no starting loads, route travel burden is
    used as the reproducible fallback so the same calculation still works for
    legacy workbooks.
    """
    vehicle_loads = {vehicle.vehicle_id: vehicle.current_load_kg for vehicle in dataset.vehicles}
    measured = {
        route.vehicle_id: max(0, round(vehicle_loads.get(route.vehicle_id, 0.0)))
        for route in plan.routes
        if route.order_ids and vehicle_loads.get(route.vehicle_id, 0.0) > 0
    }
    if measured:
        return measured

    averages = {
        route.vehicle_id: route.total_duration_s / len(route.order_ids)
        for route in plan.routes
        if route.order_ids
    }
    if not averages:
        return {}
    fastest = min(averages.values())
    return {
        vehicle_id: max(0, round((average - fastest) / 60))
        for vehicle_id, average in averages.items()
    }


def _hardest_zone(plan: PlanResult, dataset: Dataset) -> tuple[str, int] | None:
    """Find the zone with the largest average planned travel burden.

    The suggested extra service minutes are the ceiling of average leg
    distance in one-kilometre blocks.  Both the zone and the value therefore
    follow the supplied plan rather than a demo-specific constant.
    """
    orders = {order.order_id: order for order in dataset.orders}
    stats: dict[str, list[int]] = {}
    for route in plan.routes:
        for stop in route.stops:
            order = orders.get(stop.order_id)
            if order is None:
                continue
            values = stats.setdefault(order.zone_code, [0, 0])
            values[0] += 1
            values[1] += stop.leg_distance_m
    if not stats:
        return None
    zone_code, (stop_count, distance_m) = max(
        stats.items(), key=lambda item: (item[1][1] / item[1][0], item[0])
    )
    extra_minutes = max(1, ceil(distance_m / stop_count / 1000))
    return zone_code, extra_minutes


def compute_dispatch_deviations(
    plan: PlanResult,
    dataset: Dataset,
    timeline_minutes: int | None,
) -> dict[str, Any]:
    """Calculate the two demo deviations from the deterministic F5 timeline.

    The timeline is the only "actual" input.  No driver report, GPS position,
    provider timestamp, or language-model number is accepted here.
    """
    if timeline_minutes is None or timeline_minutes < DEVIATION_START_MINUTES:
        return _empty_deviation_payload(timeline_minutes)

    progress = route_progress(plan, timeline_minutes)
    lag_by_vehicle = _vehicle_lag_minutes(plan, dataset)
    expected_by_vehicle = {item["vehicle_id"]: item for item in progress}
    candidate_vehicle_deviations: list[VehicleDeviation] = []
    for vehicle_id, delay_minutes in lag_by_vehicle.items():
        expected = expected_by_vehicle.get(vehicle_id)
        if expected is None or expected["completed_count"] < 1 or delay_minutes <= 0:
            continue
        actual_progress = route_progress(plan, max(0, timeline_minutes - delay_minutes))
        actual = next(
            (item for item in actual_progress if item["vehicle_id"] == vehicle_id), None
        )
        if actual is None:
            continue
        candidate_vehicle_deviations.append(
            VehicleDeviation(
                vehicle_id=vehicle_id,
                delay_minutes=delay_minutes,
                expected_completed_count=expected["completed_count"],
                actual_completed_count=actual["completed_count"],
                message=(
                    f"{vehicle_id} 今天實際比預估慢 {delay_minutes} 分鐘。"
                    "已記錄。"
                ),
            )
        )
    if not candidate_vehicle_deviations:
        return _empty_deviation_payload(timeline_minutes)
    candidate_vehicle_deviations.sort(
        key=lambda item: (-item.delay_minutes, item.vehicle_id)
    )
    hardest_zone = _hardest_zone(plan, dataset)
    if hardest_zone is None:
        return _empty_deviation_payload(timeline_minutes)
    zone_code, extra_service_minutes = hardest_zone
    baseline_service_minutes = DEFAULT_SERVICE_MINUTES
    suggested_service_minutes = baseline_service_minutes + extra_service_minutes
    zone_deviation = ZoneDeviation(
        zone_code=zone_code,
        extra_service_minutes_per_stop=extra_service_minutes,
        baseline_service_minutes=baseline_service_minutes,
        suggested_service_minutes=suggested_service_minutes,
        reason="每站平均行駛負擔最高",
        message=(
            f"{zone_code} 區每站停留時間平均比預估多 "
            f"{extra_service_minutes} 分鐘（每站平均行駛負擔最高）。已記錄。"
        ),
    )
    recorded_at = ROUTE_BASE_TIME + timedelta(minutes=timeline_minutes)
    return {
        "source": "TIMELINE_SIMULATION",
        "timeline_minutes": timeline_minutes,
        "recorded_at": recorded_at.isoformat(),
        "has_deviations": True,
        "vehicle_deviations": [
            item.model_dump(mode="json") for item in candidate_vehicle_deviations
        ],
        "zone_deviations": [zone_deviation.model_dump(mode="json")],
        "suggestions": [
            {
                "suggestion_id": f"SUGGEST-{zone_code}-SERVICE-TIME",
                "kind": "SERVICE_TIME_BY_ZONE",
                "zone_code": zone_code,
                "from_service_minutes": baseline_service_minutes,
                "to_service_minutes": suggested_service_minutes,
                "message": (
                    f"建議將 {zone_code} 的服務時間由 {baseline_service_minutes} 分鐘"
                    f"調整為 {suggested_service_minutes} 分鐘。"
                ),
                "requires_human_confirmation": True,
            }
        ],
        "dataset_order_count": len(dataset.orders),
    }
