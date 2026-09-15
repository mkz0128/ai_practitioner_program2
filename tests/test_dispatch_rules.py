from datetime import UTC, datetime
from pathlib import Path

import pytest

from src.services import dispatch_rules
from src.services.dispatch_rules import (
    DispatchRule,
    DispatchRuleDraft,
    deactivate_dispatch_rule,
    expires_at_for_duration,
    list_dispatch_rules,
    preview_dispatch_rule,
    rule_summary,
    save_dispatch_rule,
)
from src.services.importer import parse_workbook
from src.services.matrix import SimulatedRouteProvider
from src.services.planner import build_ortools

SAMPLES = Path(__file__).parents[1] / "data" / "samples"


@pytest.fixture
def rule_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "dispatch-rules.json"
    monkeypatch.setattr(dispatch_rules, "_RULES_PATH", path)
    return path


def _fixture(name: str = "demo-50-relaxed.xlsx"):
    dataset, report = parse_workbook(SAMPLES / name)
    assert report.is_valid and dataset is not None
    matrix = SimulatedRouteProvider().build(dataset)
    plan = build_ortools(dataset, matrix, 10, objective="BALANCED")
    return dataset, matrix, plan


def _rule(rule_id: str = "RULE-001", **updates: object) -> DispatchRule:
    values: dict[str, object] = {
        "rule_id": rule_id,
        "subject_type": "VEHICLE",
        "subject_id": "VEH-003",
        "rule_type": "MAX_ROUTE_DISTANCE",
        "value": 30.0,
        "source_utterance": "三號車單趟不要超過 30 公里",
        "created_at": "2026-09-10T00:00:00+00:00",
    }
    values.update(updates)
    return DispatchRule.model_validate(values)


def test_rule_is_saved_with_source_and_can_be_deactivated(rule_store: Path) -> None:
    rule = _rule()
    save_dispatch_rule(rule)
    assert rule_store.exists()
    assert list_dispatch_rules(include_inactive=False) == [rule]
    assert rule_summary(rule) == "VEH-003 單趟距離 ≤ 30 km"

    deactivated = deactivate_dispatch_rule(rule.rule_id)
    assert deactivated is not None
    assert deactivated.active is False
    assert list_dispatch_rules(include_inactive=False) == []
    assert list_dispatch_rules(include_inactive=True)[0].source_utterance == rule.source_utterance


def test_temporary_rule_has_deterministic_expiry_boundary() -> None:
    now = datetime(2026, 9, 10, 4, 5, tzinfo=UTC)
    assert expires_at_for_duration("PERMANENT", now) is None
    assert expires_at_for_duration("TODAY", now) == "2026-09-10T23:59:59+00:00"
    assert expires_at_for_duration("THIS_WEEK", now) == "2026-09-13T23:59:59+00:00"


def test_route_distance_trial_keeps_subject_vehicle_within_limit() -> None:
    dataset, matrix, base_plan = _fixture()
    trial = preview_dispatch_rule(
        dataset,
        matrix,
        base_plan,
        DispatchRuleDraft(
            subject_id="VEH-003",
            rule_type="MAX_ROUTE_DISTANCE",
            value=30.0,
        ),
        "三號車單趟不要超過 30 公里",
        10,
        [],
    )
    route = next(item for item in trial.plan.routes if item.vehicle_id == "VEH-003")
    assert trial.status == "FEASIBLE"
    assert route.total_distance_m <= 30_000


def test_tight_rule_reallocation_keeps_baseline_unassigned_order() -> None:
    dataset, matrix, base_plan = _fixture("demo-50-tight.xlsx")
    trial = preview_dispatch_rule(
        dataset,
        matrix,
        base_plan,
        DispatchRuleDraft(
            subject_id="VEH-003",
            rule_type="MAX_PACKAGE_WEIGHT",
            value=5.0,
        ),
        "VEH-003 單件不超過 5 公斤",
        10,
        [],
    )
    assert trial.status == "FEASIBLE"
    assert trial.conflicts == []
    assert trial.plan.unassigned_orders == ["ORD-050"]


def test_tight_weight_rule_moves_three_medium_orders_without_new_unassigned_orders() -> None:
    dataset, matrix, base_plan = _fixture("demo-50-tight.xlsx")
    medium_order_ids = {"ORD-014", "ORD-027", "ORD-033"}
    assert {
        order.order_id
        for route in base_plan.routes
        if route.vehicle_id == "VEH-002"
        for order in dataset.orders
        if order.order_id in route.order_ids and order.total_weight_kg > 20.0
    } == medium_order_ids

    trial = preview_dispatch_rule(
        dataset,
        matrix,
        base_plan,
        DispatchRuleDraft(
            subject_id="VEH-002",
            rule_type="MAX_PACKAGE_WEIGHT",
            value=20.0,
        ),
        "老王腰傷，重的別給他",
        10,
        [],
    )

    assert trial.status == "FEASIBLE"
    assert trial.plan.unassigned_orders == ["ORD-050"]
    vehicle_three = next(
        route for route in trial.plan.routes if route.vehicle_id == "VEH-002"
    )
    assert all(
        order_id not in vehicle_three.order_ids
        for order_id in medium_order_ids
    )
