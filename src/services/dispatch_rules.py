from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import RLock
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from src.domain.models import Dataset, Order, TimeSlot, VehicleStatus
from src.services.display import slot_label, vehicle_label
from src.services.matrix import MatrixResult
from src.services.plan_diff import compute_plan_diff
from src.services.planner import PlanResult, build_ortools, preview_reassignment
from src.services.validator import validate_plan

RuleSubjectType = Literal["VEHICLE", "ZONE"]
DispatchRuleType = Literal[
    "MAX_PACKAGE_WEIGHT",
    "MAX_ROUTE_DISTANCE",
    "MAX_STOPS",
    "EXCLUDED_ZONE",
    "ALLOWED_TIME_WINDOW",
    "LATEST_RETURN_TIME",
]
RuleDuration = Literal["PERMANENT", "THIS_WEEK", "TODAY"]


class DispatchRule(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    rule_id: str = Field(min_length=1)
    subject_type: RuleSubjectType
    subject_id: str = Field(min_length=1)
    rule_type: DispatchRuleType
    value: float | str
    source_utterance: str = Field(min_length=1)
    created_at: str
    active: bool = True
    expires_at: str | None = None


class DispatchRuleDraft(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    subject_type: RuleSubjectType = "VEHICLE"
    subject_id: str | None = None
    rule_type: DispatchRuleType | None = None
    value: float | str | None = None
    duration: RuleDuration = "PERMANENT"


class RuleConflict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    rule_id: str
    rule_type: DispatchRuleType
    subject_id: str
    order_ids: list[str]
    reason: str


class DispatchRuleTrial(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    status: Literal["FEASIBLE", "CONFLICT"]
    plan: PlanResult
    validator: dict[str, Any]
    diff: dict[str, Any]
    affected_order_ids: list[str]
    conflicts: list[RuleConflict]


_RULES_PATH = Path(__file__).resolve().parents[2] / "data" / "runtime" / "dispatch-rules.json"
_RULES_LOCK = RLock()


def _read_rules() -> list[DispatchRule]:
    if not _RULES_PATH.exists():
        return []
    try:
        raw = json.loads(_RULES_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return []
    if not isinstance(raw, list):
        return []
    rules: list[DispatchRule] = []
    for item in raw:
        if isinstance(item, dict):
            try:
                rules.append(DispatchRule.model_validate(item))
            except ValueError:
                continue
    return rules


def _write_rules(rules: list[DispatchRule]) -> None:
    _RULES_PATH.parent.mkdir(parents=True, exist_ok=True)
    _RULES_PATH.write_text(
        json.dumps([rule.model_dump(mode="json") for rule in rules], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def list_dispatch_rules(*, include_inactive: bool = True) -> list[DispatchRule]:
    with _RULES_LOCK:
        rules = _read_rules()
    if include_inactive:
        return rules
    now = datetime.now(UTC)
    return [
        rule
        for rule in rules
        if rule.active and (rule.expires_at is None or _parse_datetime(rule.expires_at) > now)
    ]


def save_dispatch_rule(rule: DispatchRule) -> DispatchRule:
    with _RULES_LOCK:
        rules = [item for item in _read_rules() if item.rule_id != rule.rule_id]
        rules.append(rule)
        rules.sort(key=lambda item: (item.created_at, item.rule_id))
        _write_rules(rules)
    return rule


def deactivate_dispatch_rule(rule_id: str) -> DispatchRule | None:
    with _RULES_LOCK:
        rules = _read_rules()
        for index, rule in enumerate(rules):
            if rule.rule_id == rule_id:
                updated = rule.model_copy(update={"active": False})
                rules[index] = updated
                _write_rules(rules)
                return updated
    return None


def reset_dispatch_rules() -> int:
    """Clear active and inactive rules used by the local demo runtime."""
    with _RULES_LOCK:
        rules = _read_rules()
        _write_rules([])
    return len(rules)


def expires_at_for_duration(duration: RuleDuration, now: datetime | None = None) -> str | None:
    if duration == "PERMANENT":
        return None
    reference = now or datetime.now(UTC)
    if duration == "TODAY":
        end = reference.replace(hour=23, minute=59, second=59, microsecond=0)
    else:
        days_until_sunday = (6 - reference.weekday()) % 7
        end = (reference + timedelta(days=days_until_sunday)).replace(
            hour=23, minute=59, second=59, microsecond=0
        )
    return end.isoformat()


def _parse_datetime(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return datetime.min.replace(tzinfo=UTC)
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)


def _active_rules(rules: list[DispatchRule]) -> list[DispatchRule]:
    now = datetime.now(UTC)
    return [
        rule
        for rule in rules
        if rule.active and (rule.expires_at is None or _parse_datetime(rule.expires_at) > now)
    ]


def _clock_minutes(value: object) -> int | None:
    """Parse the strict HH:MM rule value without interpreting user language."""
    if not isinstance(value, str):
        return None
    parts = value.strip().split(":")
    if len(parts) != 2:
        return None
    try:
        hour, minute = int(parts[0]), int(parts[1])
    except ValueError:
        return None
    if not 0 <= hour <= 23 or not 0 <= minute <= 59:
        return None
    return hour * 60 + minute


def _stop_clock_minutes(value: str) -> int | None:
    try:
        return _clock_minutes(datetime.fromisoformat(value).strftime("%H:%M"))
    except ValueError:
        return None


def _rule_allows_order(rule: DispatchRule, vehicle_id: str, order: Order) -> bool:
    if rule.subject_type != "VEHICLE" or rule.subject_id != vehicle_id:
        return True
    if rule.rule_type == "MAX_PACKAGE_WEIGHT":
        return isinstance(rule.value, (float, int)) and order.total_weight_kg <= float(rule.value)
    if rule.rule_type == "EXCLUDED_ZONE":
        return order.zone_code != str(rule.value)
    if rule.rule_type == "ALLOWED_TIME_WINDOW":
        return TimeSlot(order.time_slot).value == str(rule.value)
    if rule.rule_type == "LATEST_RETURN_TIME":
        # The route-level ETA check below is authoritative. This branch keeps
        # the order eligibility predicate conservative for malformed values.
        return _clock_minutes(rule.value) is not None
    return True


def _solver_dataset(
    dataset: Dataset, rules: list[DispatchRule], matrix: MatrixResult
) -> Dataset:
    vehicles = tuple(sorted(dataset.vehicles, key=lambda item: item.vehicle_id))
    orders = tuple(sorted(dataset.orders, key=lambda item: item.order_id))
    service_zones: dict[str, list[str]] = {vehicle.vehicle_id: [] for vehicle in vehicles}
    transformed_orders = []
    matrix_index = {node_id: index for index, node_id in enumerate(matrix.node_ids)}
    for order in orders:
        token = f"RULE_ORDER_{order.order_id}"
        transformed_orders.append(order.model_copy(update={"zone_code": token}))
        for vehicle in vehicles:
            route_distance_allowed = True
            order_index = matrix_index.get(order.order_id)
            if order_index is not None:
                direct_distance_m = matrix.distance_m[0][order_index] + matrix.distance_m[
                    order_index
                ][0]
                for rule in rules:
                    if (
                        rule.subject_type == "VEHICLE"
                        and rule.subject_id == vehicle.vehicle_id
                        and rule.rule_type == "MAX_ROUTE_DISTANCE"
                        and isinstance(rule.value, (float, int))
                        and direct_distance_m > float(rule.value) * 1000
                    ):
                        route_distance_allowed = False
                        break
            eligible = (
                vehicle.status == VehicleStatus.AVAILABLE
                and order.zone_code in vehicle.service_zone_codes
                and route_distance_allowed
                and all(_rule_allows_order(rule, vehicle.vehicle_id, order) for rule in rules)
            )
            if eligible:
                service_zones[vehicle.vehicle_id].append(token)
    transformed_vehicles = tuple(
        vehicle.model_copy(update={"service_zone_codes": tuple(service_zones[vehicle.vehicle_id])})
        for vehicle in vehicles
    )
    return dataset.model_copy(
        update={"orders": tuple(transformed_orders), "vehicles": transformed_vehicles}
    )


def _rule_conflicts(
    plan: PlanResult, dataset: Dataset, rules: list[DispatchRule]
) -> list[RuleConflict]:
    orders = {order.order_id: order for order in dataset.orders}
    conflicts: list[RuleConflict] = []
    for rule in rules:
        affected: list[str] = []
        for route in plan.routes:
            if rule.subject_type != "VEHICLE" or route.vehicle_id != rule.subject_id:
                continue
            if rule.rule_type == "MAX_ROUTE_DISTANCE" and isinstance(rule.value, (float, int)):
                if route.total_distance_m > float(rule.value) * 1000:
                    affected.extend(route.order_ids)
            elif rule.rule_type == "MAX_STOPS" and isinstance(rule.value, (float, int)):
                if len(route.order_ids) > int(float(rule.value)):
                    affected.extend(route.order_ids[int(float(rule.value)) :])
            elif rule.rule_type == "MAX_PACKAGE_WEIGHT":
                affected.extend(
                    order_id
                    for order_id in route.order_ids
                    if order_id in orders
                    and isinstance(rule.value, (float, int))
                    and orders[order_id].total_weight_kg > float(rule.value)
                )
            elif rule.rule_type == "EXCLUDED_ZONE":
                affected.extend(
                    order_id
                    for order_id in route.order_ids
                    if order_id in orders and orders[order_id].zone_code == str(rule.value)
                )
            elif rule.rule_type == "ALLOWED_TIME_WINDOW":
                affected.extend(
                    order_id
                    for order_id in route.order_ids
                    if order_id in orders
                    and TimeSlot(orders[order_id].time_slot).value != str(rule.value)
                )
            elif rule.rule_type == "LATEST_RETURN_TIME":
                limit = _clock_minutes(rule.value)
                if limit is not None:
                    affected.extend(
                        stop.order_id
                        for stop in route.stops
                        if (_stop_clock_minutes(stop.eta) or 0) > limit
                    )
        if affected:
            conflicts.append(
                RuleConflict(
                    rule_id=rule.rule_id,
                    rule_type=rule.rule_type,
                    subject_id=rule.subject_id,
                    order_ids=sorted(set(affected)),
                    reason=_conflict_reason(rule),
                )
            )
    return conflicts


def _route_stop_count(plan: PlanResult, vehicle_id: str | None) -> int:
    return next(
        (len(route.order_ids) for route in plan.routes if route.vehicle_id == vehicle_id),
        0,
    )


def _rule_empties_subject(
    base_plan: PlanResult, candidate_plan: PlanResult, rule: DispatchRule
) -> bool:
    """Is the limit so tight that the vehicle keeps nothing at all?

    The solver can satisfy any vehicle limit by moving every order off that
    vehicle, so a limit no package or leg can meet came back 「可試算」 with a
    large reassignment count instead of the three-way conflict choice. A limit
    that leaves the vehicle with zero stops is not a limit on how it works; it
    takes the vehicle off the road, which is ``change_vehicle_availability``.
    That boundary needs no threshold on how many orders moved.
    """
    if rule.subject_type != "VEHICLE":
        return False
    before = _route_stop_count(base_plan, rule.subject_id)
    return before > 0 and _route_stop_count(candidate_plan, rule.subject_id) == 0


def _conflict_reason(rule: DispatchRule) -> str:
    labels = {
        "MAX_PACKAGE_WEIGHT": "單件重量超過規則上限",
        "MAX_ROUTE_DISTANCE": "單趟距離超過規則上限",
        "MAX_STOPS": "站數超過規則上限",
        "EXCLUDED_ZONE": "訂單區域被車輛排除",
        "ALLOWED_TIME_WINDOW": "訂單時段不在車輛允許時段",
        "LATEST_RETURN_TIME": "最後送達時間超過最晚收工時間",
    }
    return labels[rule.rule_type]


def _rule_violation_count(conflicts: list[RuleConflict]) -> int:
    return sum(len(conflict.order_ids) for conflict in conflicts)


def _enforce_route_limits(
    plan: PlanResult, dataset: Dataset, matrix: MatrixResult, rules: list[DispatchRule]
) -> PlanResult:
    current = plan
    for _ in range(len(dataset.orders) + 1):
        conflicts = [
            conflict
            for conflict in _rule_conflicts(current, dataset, rules)
            if conflict.rule_type in {"MAX_ROUTE_DISTANCE", "MAX_STOPS"}
        ]
        if not conflicts:
            return current
        candidates: list[tuple[tuple[float, int, int, str, str], PlanResult]] = []
        for conflict in conflicts:
            route = next(
                (item for item in current.routes if item.vehicle_id == conflict.subject_id),
                None,
            )
            if route is None:
                continue
            for order_id in conflict.order_ids:
                for target in current.routes:
                    if target.vehicle_id == route.vehicle_id:
                        continue
                    candidate = preview_reassignment(
                        current, dataset, matrix, order_id, target.vehicle_id
                    )
                    if candidate is None:
                        continue
                    validation = validate_plan(dataset, candidate, matrix)
                    if not validation.valid:
                        continue
                    route_overflow = 0.0
                    for candidate_conflict in conflicts:
                        candidate_route = next(
                            (
                                item
                                for item in candidate.routes
                                if item.vehicle_id == candidate_conflict.subject_id
                            ),
                            None,
                        )
                        if candidate_route is None:
                            continue
                        if candidate_conflict.rule_type == "MAX_ROUTE_DISTANCE":
                            limit_m = next(
                                (
                                    float(item.value) * 1000
                                    for item in rules
                                    if item.rule_id == candidate_conflict.rule_id
                                    and isinstance(item.value, (float, int))
                                ),
                                0.0,
                            )
                            route_overflow += max(
                                0.0, candidate_route.total_distance_m - limit_m
                            )
                        elif candidate_conflict.rule_type == "MAX_STOPS":
                            limit_stops = next(
                                (
                                    int(float(item.value))
                                    for item in rules
                                    if item.rule_id == candidate_conflict.rule_id
                                    and isinstance(item.value, (float, int))
                                ),
                                0,
                            )
                            route_overflow += max(
                                0, len(candidate_route.order_ids) - limit_stops
                            )
                    score = (
                        route_overflow,
                        candidate.total_distance_m,
                        candidate.total_driving_time_s,
                        order_id,
                        target.vehicle_id,
                    )
                    candidates.append((score, candidate))
        if not candidates:
            return current
        current = min(candidates, key=lambda item: item[0])[1]
    return current


def _apply_package_weight_reassignments(
    plan: PlanResult,
    dataset: Dataset,
    matrix: MatrixResult,
    rules: list[DispatchRule],
) -> PlanResult:
    """Move weight-rule conflicts one order at a time when a global solve stalls.

    A package-weight rule is a local vehicle constraint. Keeping the existing
    routes as the baseline makes a rule trial useful even when OR-Tools cannot
    find a full replacement in its time budget, and keeps the resulting diff
    limited to orders affected by the rule.
    """
    current = plan
    repair_moves = 0
    for _ in range(len(dataset.orders) + 1):
        conflicts = [
            conflict
            for conflict in _rule_conflicts(current, dataset, rules)
            if conflict.rule_type == "MAX_PACKAGE_WEIGHT"
        ]
        if not conflicts:
            return current
        for conflict in conflicts:
            source = next(
                (route for route in current.routes if route.vehicle_id == conflict.subject_id),
                None,
            )
            if source is None:
                continue
            for order_id in conflict.order_ids:
                direct_candidates: list[
                    tuple[tuple[float, float, str], PlanResult]
                ] = []
                for target in current.routes:
                    if target.vehicle_id == source.vehicle_id:
                        continue
                    candidate = preview_reassignment(
                        current, dataset, matrix, order_id, target.vehicle_id
                    )
                    if candidate is None or not validate_plan(dataset, candidate, matrix).valid:
                        continue
                    direct_candidates.append(
                        (
                            (
                                candidate.total_distance_m - current.total_distance_m,
                                candidate.total_driving_time_s - current.total_driving_time_s,
                                target.vehicle_id,
                            ),
                            candidate,
                        )
                    )
                if direct_candidates:
                    current = min(direct_candidates, key=lambda item: item[0])[1]
                    break

                # A legal target can be full even though the rule change is
                # feasible. Free capacity by moving one of that target's
                # existing stops to another legal vehicle, then retry the
                # affected order. The bounded loop keeps this deterministic
                # and prevents the old insertion-style infinite retry.
                paired_candidates: list[
                    tuple[tuple[float, float, str, str, str], PlanResult]
                ] = []
                target_candidates: list[
                    tuple[tuple[float, float, float, float, str, str], PlanResult]
                ] = []
                eligible_target_ids = {
                    target.vehicle_id
                    for target in current.routes
                    if target.vehicle_id != source.vehicle_id
                    and preview_reassignment(
                        current, dataset, matrix, order_id, target.vehicle_id
                    )
                    is not None
                }
                for target in current.routes:
                    if target.vehicle_id not in eligible_target_ids:
                        continue
                    for blocker_id in target.order_ids:
                        blocker = next(
                            item for item in dataset.orders if item.order_id == blocker_id
                        )
                        for destination in current.routes:
                            if destination.vehicle_id in {
                                source.vehicle_id,
                                target.vehicle_id,
                            }:
                                continue
                            candidate = preview_reassignment(
                                current,
                                dataset,
                                matrix,
                                blocker_id,
                                destination.vehicle_id,
                            )
                            if candidate is None or not validate_plan(
                                dataset, candidate, matrix
                            ).valid:
                                continue
                            follow_up = preview_reassignment(
                                candidate,
                                dataset,
                                matrix,
                                order_id,
                                target.vehicle_id,
                            )
                            if follow_up is not None and validate_plan(
                                dataset, follow_up, matrix
                            ).valid:
                                paired_candidates.append(
                                    (
                                        (
                                            follow_up.total_distance_m
                                            - current.total_distance_m,
                                            follow_up.total_driving_time_s
                                            - current.total_driving_time_s,
                                            target.vehicle_id,
                                            blocker_id,
                                            destination.vehicle_id,
                                        ),
                                        follow_up,
                                    )
                                )
                            target_load = next(
                                item
                                for item in candidate.routes
                                if item.vehicle_id == target.vehicle_id
                            ).planned_load_kg
                            target_candidates.append(
                                (
                                    (
                                        target_load,
                                        candidate.total_distance_m - current.total_distance_m,
                                        candidate.total_driving_time_s
                                        - current.total_driving_time_s,
                                        -blocker.total_weight_kg,
                                        blocker_id,
                                        destination.vehicle_id,
                                    ),
                                    candidate,
                                )
                            )
                if paired_candidates:
                    current = min(paired_candidates, key=lambda item: item[0])[1]
                    repair_moves += 2
                    if repair_moves >= len(dataset.orders):
                        return current
                    break
                if not target_candidates:
                    continue
                current = min(target_candidates, key=lambda item: item[0])[1]
                repair_moves += 1
                if repair_moves >= len(dataset.orders):
                    return current
                break
            else:
                continue
            break
    return current


def build_plan_with_rules(
    dataset: Dataset,
    matrix: MatrixResult,
    time_limit_seconds: int,
    objective: Literal["FASTEST", "BALANCED", "STABLE"],
    rules: list[DispatchRule],
) -> PlanResult:
    active = _active_rules(rules)
    if not active:
        return build_ortools(dataset, matrix, time_limit_seconds, objective=objective)
    # A hard driver rule must take precedence over the soft balance objective.
    # The existing OR-Tools builder can otherwise reject an otherwise legal
    # partial assignment while trying to satisfy its balance soft bounds.
    solve_objective: Literal["FASTEST", "BALANCED", "STABLE"] = "FASTEST"
    plan = build_ortools(
        _solver_dataset(dataset, active, matrix),
        matrix,
        time_limit_seconds,
        objective=solve_objective,
    )
    has_package_weight_rule = any(
        rule.rule_type == "MAX_PACKAGE_WEIGHT" for rule in active
    )
    if has_package_weight_rule:
        baseline = build_ortools(dataset, matrix, time_limit_seconds, objective=objective)
        repaired = _apply_package_weight_reassignments(
            baseline, dataset, matrix, active
        )
        if not _rule_conflicts(repaired, dataset, active) or plan.solver_status == "NO_SOLUTION":
            plan = repaired
    plan = _enforce_route_limits(plan, dataset, matrix, active)
    conflicts = _rule_conflicts(plan, dataset, active)
    if conflicts:
        reasons = dict(plan.unassigned_reasons)
        for conflict in conflicts:
            for order_id in conflict.order_ids:
                reasons[order_id] = f"DISPATCH_RULE:{conflict.rule_id}"
        plan = plan.model_copy(update={"unassigned_reasons": reasons})
    return plan


def preview_dispatch_rule(
    dataset: Dataset,
    matrix: MatrixResult,
    base_plan: PlanResult,
    draft: DispatchRuleDraft,
    source_utterance: str,
    time_limit_seconds: int,
    existing_rules: list[DispatchRule],
) -> DispatchRuleTrial:
    if draft.rule_type is None or draft.subject_id is None or draft.value is None:
        raise ValueError("RULE_FIELDS_MISSING")
    rule = DispatchRule(
        rule_id="RULE-CANDIDATE",
        subject_type=draft.subject_type,
        subject_id=draft.subject_id,
        rule_type=draft.rule_type,
        value=draft.value,
        source_utterance=source_utterance,
        created_at=datetime.now(UTC).isoformat(),
        expires_at=expires_at_for_duration(draft.duration),
    )
    candidate_plan = build_plan_with_rules(
        dataset,
        matrix,
        time_limit_seconds,
        objective=base_plan.objective,
        rules=[*existing_rules, rule],
    )
    validation = validate_plan(dataset, candidate_plan, matrix)
    conflicts = _rule_conflicts(candidate_plan, dataset, [rule])
    baseline_unassigned = set(base_plan.unassigned_orders)
    newly_unassigned = set(candidate_plan.unassigned_orders) - baseline_unassigned
    candidate_is_infeasible = (
        conflicts
        or not validation.valid
        or bool(newly_unassigned)
        or _rule_empties_subject(base_plan, candidate_plan, rule)
    )
    if candidate_is_infeasible and not conflicts:
        conflicts = _rule_conflicts(base_plan, dataset, [rule])
    diff = compute_plan_diff(base_plan, candidate_plan)
    changed_sequences = {
        item["order_id"] for item in diff["sequence_changes"]
    }
    affected = sorted(
        changed_sequences
        | {item["order_id"] for item in diff["reassigned_orders"]}
        | {order_id for conflict in conflicts for order_id in conflict.order_ids}
    )
    return DispatchRuleTrial(
        status=(
            "CONFLICT"
            if candidate_is_infeasible
            else "FEASIBLE"
        ),
        plan=candidate_plan,
        validator=validation.model_dump(mode="json"),
        diff=diff,
        affected_order_ids=affected,
        conflicts=conflicts,
    )


def rule_summary(rule: DispatchRule) -> str:
    value = f"{rule.value:g}" if isinstance(rule.value, (int, float)) else str(rule.value)
    # ALLOWED_TIME_WINDOW carries the raw slot enum, which would otherwise
    # leave MORNING sitting inside an otherwise Chinese sentence.
    if rule.rule_type == "ALLOWED_TIME_WINDOW":
        value = "、".join(slot_label(part) for part in value.split(","))
    labels = {
        "MAX_PACKAGE_WEIGHT": "單件重量",
        "MAX_ROUTE_DISTANCE": "單趟距離",
        "MAX_STOPS": "站數",
        "EXCLUDED_ZONE": "排除區域",
        "ALLOWED_TIME_WINDOW": "允許時段",
        "LATEST_RETURN_TIME": "最晚收工",
    }
    suffix = {
        "MAX_PACKAGE_WEIGHT": " kg",
        "MAX_ROUTE_DISTANCE": " km",
        "MAX_STOPS": " 站",
    }.get(rule.rule_type, "")
    subject = vehicle_label(rule.subject_id) if rule.subject_type == "VEHICLE" else rule.subject_id
    if rule.rule_type in {
        "MAX_PACKAGE_WEIGHT",
        "MAX_ROUTE_DISTANCE",
        "MAX_STOPS",
        "LATEST_RETURN_TIME",
    }:
        return f"{subject} {labels[rule.rule_type]} ≤ {value}{suffix}"
    return f"{subject} {labels[rule.rule_type]}：{value}"
