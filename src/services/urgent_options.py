from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from itertools import combinations
from typing import Any, Literal

from src.domain.models import Dataset, Order
from src.services.dispatch_rules import DispatchRule, _rule_conflicts
from src.services.matrix import MatrixResult
from src.services.plan_diff import compute_plan_diff
from src.services.planner import (
    PlanResult,
    _route_metrics_preserving_order,
    try_minimal_insert,
    uses_legacy_timing,
)
from src.services.validator import PlanValidation, validate_plan

OptionMode = Literal["INSERTION", "ROUTE_REORDER"]
MIN_MEANINGFUL_DISTANCE_GAP_M = 3_000


@dataclass(frozen=True)
class UrgentOption:
    option_id: str
    title: str
    rationale: str
    mode: OptionMode
    plan: PlanResult
    validation: PlanValidation
    diff: dict[str, Any]
    vehicle_id: str
    insertion_sequence: int


def _copy_plan_with_routes(
    base_plan: PlanResult,
    routes: list[Any],
    matrix: MatrixResult,
) -> PlanResult:
    unassigned_orders = list(base_plan.unassigned_orders)
    return base_plan.model_copy(
        update={
            "state": "PROPOSED",
            "provider_mode": matrix.provider_mode,
            "routes": routes,
            "complete": not unassigned_orders,
            "total_distance_m": sum(route.total_distance_m for route in routes),
            "total_driving_time_s": sum(route.total_duration_s for route in routes),
        }
    )


def _is_non_negative_insertion(diff: dict[str, Any]) -> bool:
    """Reject a broken comparison baseline instead of showing negative cost."""
    distance_delta = float(diff["total_distance_delta_m"])
    duration_delta = float(diff["total_duration_delta_s"])
    return distance_delta >= 0 and duration_delta >= 0


def _single_insertions(
    base_plan: PlanResult,
    dataset: Dataset,
    matrix: MatrixResult,
    pending_order: Order,
) -> list[tuple[tuple[Any, ...], PlanResult]]:
    """Enumerate every legal vehicle/position insertion for one order."""
    vehicles = {vehicle.vehicle_id: vehicle for vehicle in dataset.vehicles}
    orders = {order.order_id: order for order in dataset.orders}
    orders[pending_order.order_id] = pending_order
    legacy = uses_legacy_timing(dataset)
    candidates: list[tuple[tuple[Any, ...], PlanResult]] = []
    for route_index, base_route in enumerate(base_plan.routes):
        vehicle = vehicles.get(base_route.vehicle_id)
        if vehicle is None:
            continue
        if vehicle.status.value != "AVAILABLE":
            continue
        if pending_order.zone_code not in vehicle.service_zone_codes:
            continue
        if base_route.planned_load_kg + pending_order.total_weight_kg > vehicle.max_load_kg:
            continue
        for position in range(len(base_route.order_ids) + 1):
            candidate_ids = [*base_route.order_ids]
            candidate_ids.insert(position, pending_order.order_id)
            candidate_route = _route_metrics_preserving_order(
                candidate_ids,
                vehicle,
                orders,
                matrix,
                legacy,
            )
            if candidate_route is None:
                continue
            routes = [
                candidate_route if index == route_index else route
                for index, route in enumerate(base_plan.routes)
            ]
            candidate = _copy_plan_with_routes(base_plan, routes, matrix)
            diff = compute_plan_diff(base_plan, candidate)
            if not _is_non_negative_insertion(diff):
                continue
            candidates.append(
                (
                    (
                        diff["total_distance_delta_m"],
                        diff["total_duration_delta_s"],
                        vehicle.vehicle_id,
                        position,
                    ),
                    candidate,
                )
            )
    return sorted(candidates, key=lambda item: item[0])


def _local_reassign_insertions(
    base_plan: PlanResult,
    dataset: Dataset,
    matrix: MatrixResult,
    pending_order: Order,
) -> list[tuple[tuple[Any, ...], PlanResult]]:
    """Try bounded local handoffs before inserting the urgent order.

    This is not a global replan.  At most three existing orders move from the
    target vehicle to one compatible vehicle, then the urgent order is placed
    on the target route.  The deterministic validator and reassignment guard
    remain the final authority.
    """
    vehicles = {vehicle.vehicle_id: vehicle for vehicle in dataset.vehicles}
    orders = {order.order_id: order for order in dataset.orders}
    orders[pending_order.order_id] = pending_order
    legacy = uses_legacy_timing(dataset)
    candidates: list[tuple[tuple[Any, ...], PlanResult]] = []
    for target_index, target_route in enumerate(base_plan.routes):
        target_vehicle = vehicles.get(target_route.vehicle_id)
        if target_vehicle is None or target_vehicle.status.value != "AVAILABLE":
            continue
        if pending_order.zone_code not in target_vehicle.service_zone_codes:
            continue
        deficit_kg = (
            target_route.planned_load_kg
            + pending_order.total_weight_kg
            - target_vehicle.max_load_kg
        )
        if deficit_kg <= 0:
            continue
        movable_orders = [
            orders[order_id]
            for order_id in target_route.order_ids
            if order_id in orders
        ]
        for destination_index, destination_route in enumerate(base_plan.routes):
            if destination_index == target_index:
                continue
            destination_vehicle = vehicles.get(destination_route.vehicle_id)
            if destination_vehicle is None or destination_vehicle.status.value != "AVAILABLE":
                continue
            compatible = [
                order
                for order in movable_orders
                if order.zone_code in destination_vehicle.service_zone_codes
            ]
            combinations_to_try = [
                combo
                for size in range(1, min(3, len(compatible)) + 1)
                for combo in combinations(compatible, size)
                if sum(order.total_weight_kg for order in combo) >= deficit_kg
                and destination_route.planned_load_kg
                + sum(order.total_weight_kg for order in combo)
                <= destination_vehicle.max_load_kg
            ]
            combinations_to_try.sort(
                key=lambda combo: (
                    len(combo),
                    abs(sum(order.total_weight_kg for order in combo) - deficit_kg),
                    tuple(order.order_id for order in combo),
                )
            )
            for moved_orders in combinations_to_try[:32]:
                moved_ids = {order.order_id for order in moved_orders}
                remaining_target_ids = [
                    order_id
                    for order_id in target_route.order_ids
                    if order_id not in moved_ids
                ]
                moved_ids_in_source_order = [
                    order_id
                    for order_id in target_route.order_ids
                    if order_id in moved_ids
                ]
                for target_position in range(len(remaining_target_ids) + 1):
                    target_ids = list(remaining_target_ids)
                    target_ids.insert(target_position, pending_order.order_id)
                    target_candidate = _route_metrics_preserving_order(
                        target_ids,
                        target_vehicle,
                        orders,
                        matrix,
                        legacy,
                    )
                    if target_candidate is None:
                        continue
                    if target_candidate.planned_load_kg > target_vehicle.max_load_kg:
                        continue
                    for destination_position in range(len(destination_route.order_ids) + 1):
                        destination_ids = list(destination_route.order_ids)
                        destination_ids[destination_position:destination_position] = (
                            moved_ids_in_source_order
                        )
                        destination_candidate = _route_metrics_preserving_order(
                            destination_ids,
                            destination_vehicle,
                            orders,
                            matrix,
                            legacy,
                        )
                        if destination_candidate is None:
                            continue
                        if destination_candidate.planned_load_kg > destination_vehicle.max_load_kg:
                            continue
                        routes = [
                            (
                                target_candidate
                                if index == target_index
                                else destination_candidate
                                if index == destination_index
                                else route
                            )
                            for index, route in enumerate(base_plan.routes)
                        ]
                        candidate = _copy_plan_with_routes(base_plan, routes, matrix)
                        diff = compute_plan_diff(base_plan, candidate)
                        if not _is_non_negative_insertion(diff):
                            continue
                        if len(diff["reassigned_orders"]) > 3:
                            continue
                        candidates.append(
                            (
                                (
                                    diff["total_distance_delta_m"],
                                    diff["total_duration_delta_s"],
                                    target_vehicle.vehicle_id,
                                    target_position,
                                    destination_vehicle.vehicle_id,
                                    tuple(moved_ids_in_source_order),
                                    destination_position,
                                ),
                                candidate,
                            )
                        )
    return sorted(candidates, key=lambda item: item[0])


def _plan_signature(plan: PlanResult) -> tuple[tuple[str, ...], ...]:
    return tuple(tuple(route.order_ids) for route in plan.routes)


def _candidate_inserted_vehicle_key(
    plan: PlanResult, incoming_order_ids: list[str]
) -> tuple[tuple[str, str | None], ...]:
    assignments = {
        stop.order_id: route.vehicle_id
        for route in plan.routes
        for stop in route.stops
    }
    return tuple((order_id, assignments.get(order_id)) for order_id in incoming_order_ids)


def _candidate_score(base_plan: PlanResult, candidate: PlanResult) -> tuple[Any, ...]:
    diff = compute_plan_diff(base_plan, candidate)
    return (
        diff["total_distance_delta_m"],
        diff["total_duration_delta_s"],
        _plan_signature(candidate),
    )


def count_reordered_orders(
    base_plan: PlanResult, candidate: PlanResult, incoming_order_ids: set[str]
) -> int:
    """Count existing orders whose relative route position actually changed."""
    base_by_vehicle = {
        route.vehicle_id: [
            order_id for order_id in route.order_ids if order_id not in incoming_order_ids
        ]
        for route in base_plan.routes
    }
    candidate_by_vehicle = {
        route.vehicle_id: [
            order_id for order_id in route.order_ids if order_id not in incoming_order_ids
        ]
        for route in candidate.routes
    }
    changed: set[str] = set()
    for vehicle_id in set(base_by_vehicle) | set(candidate_by_vehicle):
        base_order_ids = base_by_vehicle.get(vehicle_id, [])
        candidate_order_ids = candidate_by_vehicle.get(vehicle_id, [])
        base_positions = {order_id: index for index, order_id in enumerate(base_order_ids)}
        candidate_positions = {
            order_id: index for index, order_id in enumerate(candidate_order_ids)
        }
        for order_id in set(base_positions) & set(candidate_positions):
            if base_positions[order_id] != candidate_positions[order_id]:
                changed.add(order_id)
    return len(changed)


def _option_cost_vector(
    base_plan: PlanResult,
    option: UrgentOption,
    incoming_order_ids: set[str],
) -> tuple[float, float, int, int, float]:
    """Return deterministic dimensions used to remove dominated cards."""
    inserted_order_id = next(iter(sorted(incoming_order_ids)))
    inserted_stop = next(
        stop
        for route in option.plan.routes
        for stop in route.stops
        if stop.order_id == inserted_order_id
    )
    return (
        float(option.diff["total_distance_delta_m"]),
        float(option.diff["total_duration_delta_s"]),
        len(option.diff["reassigned_orders"]),
        count_reordered_orders(base_plan, option.plan, incoming_order_ids),
        datetime.fromisoformat(inserted_stop.eta).timestamp(),
    )


def _filter_dominated_options(
    base_plan: PlanResult,
    options: list[UrgentOption],
    incoming_order_ids: set[str],
) -> list[UrgentOption]:
    """Keep only cards with a real trade-off in at least one cost dimension."""
    vectors = [
        _option_cost_vector(base_plan, option, incoming_order_ids) for option in options
    ]
    selected: list[UrgentOption] = []
    for index, option in enumerate(options):
        candidate = vectors[index]
        dominated = False
        for other_index, other in enumerate(vectors):
            if index == other_index:
                continue
            no_worse = all(
                other_value <= candidate_value
                for other_value, candidate_value in zip(other, candidate, strict=True)
            )
            strictly_better = any(
                other_value < candidate_value
                for other_value, candidate_value in zip(other, candidate, strict=True)
            )
            same_cost_earlier = other == candidate and other_index < index
            if no_worse and (strictly_better or same_cost_earlier):
                dominated = True
                break
        if not dominated:
            selected.append(option)
    return selected


def _enumerate_batch_insertions(
    base_plan: PlanResult,
    dataset: Dataset,
    matrix: MatrixResult,
    incoming_orders: list[Order],
) -> list[PlanResult]:
    """Enumerate a bounded, deterministic set of complete batch insertions."""
    states = [base_plan]
    for order in incoming_orders:
        next_states: list[PlanResult] = []
        for state in states:
            next_states.extend(
                candidate
                for _score, candidate in _single_insertions(state, dataset, matrix, order)
            )
        unique: dict[tuple[tuple[str, ...], ...], PlanResult] = {}
        for candidate in sorted(next_states, key=lambda item: _candidate_score(base_plan, item)):
            unique.setdefault(_plan_signature(candidate), candidate)
        # A batch can have many route/position combinations. Keep enough
        # deterministic alternatives for the three cards without exploding the
        # search space for the 40-order demo.
        states = list(unique.values())[:16]
        if not states:
            break
    return states


def _partial_batch_insert(
    base_plan: PlanResult,
    dataset: Dataset,
    matrix: MatrixResult,
    incoming_orders: list[Order],
) -> PlanResult:
    """Insert every order that fits, retaining a legal partial plan for D."""
    current = base_plan
    for order in incoming_orders:
        candidate = try_minimal_insert(current, dataset, matrix, order)
        if candidate is not None:
            current = candidate
    return current


def _reordered_route_candidate(
    base_plan: PlanResult,
    dataset: Dataset,
    matrix: MatrixResult,
    inserted_plan: PlanResult,
    incoming_order_ids: set[str],
) -> list[tuple[str, PlanResult]]:
    """Reorder one affected vehicle while leaving every other vehicle intact."""
    vehicles = {vehicle.vehicle_id: vehicle for vehicle in dataset.vehicles}
    orders = {order.order_id: order for order in dataset.orders}
    legacy = uses_legacy_timing(dataset)
    candidates: list[tuple[str, PlanResult]] = []
    for route_index, route in enumerate(inserted_plan.routes):
        route_incoming_ids = sorted(incoming_order_ids.intersection(route.order_ids))
        if not route_incoming_ids:
            continue
        vehicle = vehicles.get(route.vehicle_id)
        if vehicle is None:
            continue
        route_candidates: list[tuple[tuple[Any, ...], PlanResult]] = []
        for source in range(len(route.order_ids)):
            for target in range(len(route.order_ids)):
                if source == target:
                    continue
                reordered_ids = list(route.order_ids)
                moved_order_id = reordered_ids.pop(source)
                reordered_ids.insert(target, moved_order_id)
                reordered = _route_metrics_preserving_order(
                    reordered_ids,
                    vehicle,
                    orders,
                    matrix,
                    legacy,
                )
                if reordered is None or reordered.order_ids == route.order_ids:
                    continue
                routes = [
                    reordered if index == route_index else existing
                    for index, existing in enumerate(inserted_plan.routes)
                ]
                candidate = _copy_plan_with_routes(inserted_plan, routes, matrix)
                diff = compute_plan_diff(base_plan, candidate)
                if not _is_non_negative_insertion(diff):
                    continue
                if len(diff["reassigned_orders"]) > 3:
                    continue
                if count_reordered_orders(base_plan, candidate, incoming_order_ids) > 3:
                    continue
                route_candidates.append(
                    (
                        (
                            diff["total_distance_delta_m"],
                            diff["total_duration_delta_s"],
                            route.vehicle_id,
                            0,
                            source,
                            target,
                        ),
                        candidate,
                    )
                )
        # A useful route-reorder trade-off may require moving the urgent stop
        # earlier and then restoring one existing stop's order.  Enumerate only
        # this bounded two-step local rearrangement; it is still one vehicle
        # route and the same three-order change guard applies.
        urgent_source_positions = [
            index
            for index, order_id in enumerate(route.order_ids)
            if order_id in incoming_order_ids
        ]
        for urgent_source in urgent_source_positions:
            for urgent_target in range(len(route.order_ids)):
                if urgent_source == urgent_target:
                    continue
                after_urgent = list(route.order_ids)
                moved_urgent = after_urgent.pop(urgent_source)
                after_urgent.insert(urgent_target, moved_urgent)
                for source in range(len(after_urgent)):
                    if after_urgent[source] in incoming_order_ids:
                        continue
                    for target in range(len(after_urgent)):
                        if source == target:
                            continue
                        reordered_ids = list(after_urgent)
                        moved_order_id = reordered_ids.pop(source)
                        reordered_ids.insert(target, moved_order_id)
                        reordered = _route_metrics_preserving_order(
                            reordered_ids,
                            vehicle,
                            orders,
                            matrix,
                            legacy,
                        )
                        if reordered is None or reordered.order_ids == route.order_ids:
                            continue
                        routes = [
                            reordered if index == route_index else existing
                            for index, existing in enumerate(inserted_plan.routes)
                        ]
                        candidate = _copy_plan_with_routes(inserted_plan, routes, matrix)
                        diff = compute_plan_diff(base_plan, candidate)
                        if not _is_non_negative_insertion(diff):
                            continue
                        if len(diff["reassigned_orders"]) > 3:
                            continue
                        if count_reordered_orders(base_plan, candidate, incoming_order_ids) > 3:
                            continue
                        route_candidates.append(
                            (
                                (
                                    diff["total_distance_delta_m"],
                                    diff["total_duration_delta_s"],
                                    route.vehicle_id,
                                    1,
                                    urgent_source,
                                    urgent_target,
                                    source,
                                    target,
                                ),
                                candidate,
                            )
                        )
        if route_candidates:
            insertion_delta_m = compute_plan_diff(base_plan, inserted_plan)[
                "total_distance_delta_m"
            ]
            inserted_order_id = route_incoming_ids[0]
            insertion_eta = next(
                datetime.fromisoformat(stop.eta)
                for stop in inserted_plan.routes[route_index].stops
                if stop.order_id == inserted_order_id
            )
            meaningfully_different = [
                item
                for item in route_candidates
                if item[0][0] >= insertion_delta_m + MIN_MEANINGFUL_DISTANCE_GAP_M
            ]
            earlier_meaningful = [
                item
                for item in meaningfully_different
                if datetime.fromisoformat(
                    next(
                        stop.eta
                        for stop in item[1].routes[route_index].stops
                        if stop.order_id == inserted_order_id
                    )
                )
                < insertion_eta
            ]
            selected_route_candidates = (
                earlier_meaningful or meaningfully_different or route_candidates
            )
            candidates.append(
                (
                    route.vehicle_id,
                    min(
                        selected_route_candidates,
                        key=lambda item: (
                            datetime.fromisoformat(
                                next(
                                    stop.eta
                                    for stop in item[1].routes[route_index].stops
                                    if stop.order_id == inserted_order_id
                                )
                            ),
                            item[0],
                        ),
                    )[1],
                )
            )
    return candidates


def _fully_assignable(
    plan: PlanResult,
    base_plan: PlanResult,
    incoming_order_ids: set[str],
    validation: PlanValidation,
) -> bool:
    diff = compute_plan_diff(base_plan, plan)
    return (
        validation.valid
        and not incoming_order_ids.intersection(plan.unassigned_orders)
        and len(diff["reassigned_orders"]) <= 3
    )


def build_partial_urgent_plan(
    base_plan: PlanResult,
    dataset: Dataset,
    matrix: MatrixResult,
    incoming_order_ids: list[str],
) -> PlanResult:
    """Public deterministic partial result used by the non-selectable D card."""
    orders = {order.order_id: order for order in dataset.orders}
    return _partial_batch_insert(
        base_plan,
        dataset,
        matrix,
        [orders[order_id] for order_id in incoming_order_ids],
    )


def build_urgent_options(
    base_plan: PlanResult,
    dataset: Dataset,
    matrix: MatrixResult,
    time_limit_seconds: int,
    incoming_order_ids: list[str],
    stage: Literal["PRE_LOAD", "LOADED", "DISPATCHED"] = "PRE_LOAD",
    active_rules: list[DispatchRule] | None = None,
) -> list[UrgentOption]:
    """Build cards for placements of the same urgent batch, never full re-plans."""
    del time_limit_seconds
    orders = {order.order_id: order for order in dataset.orders}
    incoming_orders = [orders[order_id] for order_id in incoming_order_ids]
    incoming_set = set(incoming_order_ids)
    inserted_plans = _enumerate_batch_insertions(
        base_plan, dataset, matrix, incoming_orders
    )
    feasible_plans: list[PlanResult] = []
    for candidate in inserted_plans:
        validation = validate_plan(dataset, candidate, matrix)
        diff = compute_plan_diff(base_plan, candidate)
        if len(diff["reassigned_orders"]) > 3:
            continue
        if _fully_assignable(candidate, base_plan, incoming_set, validation):
            feasible_plans.append(candidate)
    feasible_plans.sort(key=lambda candidate: _candidate_score(base_plan, candidate))
    if stage in {"LOADED", "DISPATCHED"}:
        # Once loading starts, offer only the least-cost legal insertion.  All
        # existing assignments remain frozen; the richer placement comparison
        # is only meaningful before loading.
        feasible_plans = feasible_plans[:1]

    local_plans: list[PlanResult] = []
    if stage == "PRE_LOAD" and len(incoming_orders) == 1 and active_rules is not None:
        # A direct insertion can be blocked by capacity even when a bounded
        # handoff of existing light orders is legal.  Keep this as a local
        # alternative, never a global replan, and let the deterministic rule
        # checker reject candidates that would violate an active driver rule.
        for _score, candidate in _local_reassign_insertions(
            base_plan, dataset, matrix, incoming_orders[0]
        ):
            validation = validate_plan(dataset, candidate, matrix)
            if not _fully_assignable(candidate, base_plan, incoming_set, validation):
                continue
            if active_rules and _rule_conflicts(candidate, dataset, active_rules):
                continue
            local_plans.append(candidate)

    options: list[UrgentOption] = []
    selected_assignment_keys: set[tuple[tuple[str, str | None], ...]] = set()
    all_feasible_plans = [*feasible_plans, *local_plans]
    for candidate in all_feasible_plans:
        assignment_key = _candidate_inserted_vehicle_key(candidate, incoming_order_ids)
        if assignment_key in selected_assignment_keys:
            continue
        selected_assignment_keys.add(assignment_key)
        first_order_id = incoming_order_ids[0]
        first_stop = next(
            stop
            for route in candidate.routes
            for stop in route.stops
            if stop.order_id == first_order_id
        )
        vehicle_id = next(
            route.vehicle_id
            for route in candidate.routes
            if first_order_id in route.order_ids
        )
        if candidate in local_plans:
            label = "局部調整後的可行位置"
        else:
            label = "最佳車輛最佳位置" if not options else "次佳車輛最佳位置"
        options.append(
            UrgentOption(
                option_id=f"INSERT-{vehicle_id}-{first_stop.sequence}-{len(options) + 1}",
                title=label,
                rationale=(
                    f"把 {first_order_id} 插入 {vehicle_id} 第 {first_stop.sequence} 站；"
                    + (
                        "先局部移動少量既有訂單，再把急單放入；總改動不超過三張。"
                        if candidate in local_plans
                        else "其他車輛維持原指派。"
                    )
                ),
                mode="INSERTION",
                plan=candidate,
                validation=validate_plan(dataset, candidate, matrix),
                diff=compute_plan_diff(base_plan, candidate),
                vehicle_id=vehicle_id,
                insertion_sequence=first_stop.sequence,
            )
        )

    if stage == "PRE_LOAD" and feasible_plans:
        for vehicle_id, candidate in _reordered_route_candidate(
            base_plan,
            dataset,
            matrix,
            feasible_plans[0],
            incoming_set,
        ):
            validation = validate_plan(dataset, candidate, matrix)
            if not _fully_assignable(candidate, base_plan, incoming_set, validation):
                continue
            insertion_sequence = next(
                stop.sequence
                for route in candidate.routes
                for stop in route.stops
                if stop.order_id == incoming_order_ids[0]
            )
            if any(
                option.mode == "ROUTE_REORDER" and option.vehicle_id == vehicle_id
                for option in options
            ):
                continue
            options.append(
                UrgentOption(
                    option_id=f"REORDER-{vehicle_id}-{len(options) + 1}",
                    title=f"只重排 {vehicle_id} 該車順序",
                    rationale=(
                        f"只重排 {vehicle_id} 的站點順序，不更換既有訂單車輛；"
                        "其他車線維持原安排。"
                    ),
                    mode="ROUTE_REORDER",
                    plan=candidate,
                    validation=validation,
                    diff=compute_plan_diff(base_plan, candidate),
                    vehicle_id=vehicle_id,
                    insertion_sequence=insertion_sequence,
                )
            )
            break
    return _filter_dominated_options(base_plan, options, incoming_set)[:3]
