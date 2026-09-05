"""Deterministic delivery delay-risk calculations."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from src.domain.models import Dataset
from src.services.planner import SERVICE_SECONDS, PlanResult

RISK_THRESHOLDS_MINUTES = {"GREEN": 30, "YELLOW": 10}


def _minutes_until_deadline(eta: str, time_slot: str, service_seconds: int) -> float:
    parsed = datetime.fromisoformat(eta)
    deadline = parsed.replace(hour=12, minute=0, second=0, microsecond=0)
    if time_slot == "PM":
        deadline = parsed.replace(hour=17, minute=0, second=0, microsecond=0)
    # A stop is only complete after its deterministic service duration.  The
    # remaining margin therefore includes both travel arrival and service time
    # instead of overstating slack by three minutes.
    return (deadline - parsed).total_seconds() / 60 - service_seconds / 60


def risk_level(slack_minutes: float) -> str:
    if slack_minutes >= RISK_THRESHOLDS_MINUTES["GREEN"]:
        return "GREEN"
    if slack_minutes >= RISK_THRESHOLDS_MINUTES["YELLOW"]:
        return "YELLOW"
    return "RED"


def calculate_plan_risks(dataset: Dataset, plan: PlanResult) -> list[dict[str, Any]]:
    """Return route-stop risks using only plan ETA and hard windows.

    No probability is invented.  The output is a deterministic slack value and
    the effect of adding 10/20/30 minutes to the route.
    """
    orders = {order.order_id: order for order in dataset.orders}
    results: list[dict[str, Any]] = []
    for route in plan.routes:
        for stop in route.stops:
            order = orders.get(stop.order_id)
            if order is None:
                continue
            slack = _minutes_until_deadline(stop.eta, order.time_slot, SERVICE_SECONDS)
            simulations = {
                str(delay): {
                    "late": slack < delay,
                    "slack_minutes": round(slack - delay, 2),
                    "risk_level": risk_level(slack - delay),
                }
                for delay in (10, 20, 30)
            }
            results.append(
                {
                    "order_id": stop.order_id,
                    "vehicle_id": route.vehicle_id,
                    "sequence": stop.sequence,
                    "eta": stop.eta,
                    "deadline": (
                        f"{stop.eta[:10]}T12:00:00+08:00"
                        if order.time_slot == "AM"
                        else f"{stop.eta[:10]}T17:00:00+08:00"
                    ),
                    "time_slot": order.time_slot,
                    "service_duration_s": SERVICE_SECONDS,
                    "leg_duration_s": stop.leg_duration_s,
                    "slack_minutes": round(slack, 2),
                    "risk_level": risk_level(slack),
                    "delay_simulations": simulations,
                }
            )
    return results


def summarize_delay(
    plan: PlanResult, risks: list[dict[str, Any]], delay_minutes: int
) -> dict[str, Any]:
    affected = [item["order_id"] for item in risks if item["slack_minutes"] < delay_minutes]
    return {
        "delay_minutes": delay_minutes,
        "affected_orders": affected,
        "affected_order_count": len(affected),
        "plan_total_duration_s": plan.total_driving_time_s,
        "risk_basis": "deterministic ETA slack against hard time-window deadline",
    }
