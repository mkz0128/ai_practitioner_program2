from __future__ import annotations

import json

import pytest
from agents.testing import ScriptedModel, assistant_message

from src.agent.urgent_workflow import (
    UrgentAction,
    UrgentOrderDraft,
    UrgentUnderstanding,
    advance_urgent_workflow,
    new_urgent_workflow,
    understand_urgent_message,
)
from src.services.demo_orders import get_demo_urgent_order


def _complete(order_id: str = "TMP-101", *, weight: float = 2.5) -> UrgentOrderDraft:
    return UrgentOrderDraft(
        order_id=order_id,
        zone_code="Z1",
        city="新北市",
        district="板橋區",
        location_label="測試配送點",
        latitude=25.0114,
        longitude=121.4618,
        time_slot="PM",
        declared_package_count=1,
        package_weight_kg=weight,
        priority="HIGH",
    )


def _step(state, *, action: UrgentAction, orders=(), references=()):
    return advance_urgent_workflow(
        state,
        UrgentUnderstanding(
            is_urgent_insertion=True,
            action=action,
            orders=list(orders),
            referenced_order_ids=list(references),
        ),
        fixture_lookup=get_demo_urgent_order,
        existing_order_ids={"ORD-001", "ORD-002"},
    )


def test_vague_urgent_request_lists_all_required_fields_without_preview() -> None:
    result = _step(new_urgent_workflow(), action="ADD_OR_UPDATE", orders=[UrgentOrderDraft()])
    assert result.state.stage == "COLLECTING"
    assert result.should_preview is False
    assert result.missing_by_order[0].missing_fields == [
        "order_id",
        "location",
        "zone_code",
        "package_weight_kg",
        "declared_package_count",
        "time_slot",
        "priority",
    ]


def test_complete_order_stops_at_review_summary() -> None:
    result = _step(new_urgent_workflow(), action="ADD_OR_UPDATE", orders=[_complete()])
    assert result.state.stage == "REVIEW_READY"
    assert result.should_preview is False
    assert [order.order_id for order in result.complete_orders] == ["TMP-101"]


def test_missing_weight_and_time_are_reported_together() -> None:
    order = _complete().model_copy(update={"package_weight_kg": None, "time_slot": None})
    result = _step(new_urgent_workflow(), action="ADD_OR_UPDATE", orders=[order])
    assert result.state.stage == "COLLECTING"
    assert result.missing_by_order[0].missing_fields == ["package_weight_kg", "time_slot"]


def test_multiple_complete_orders_share_one_review() -> None:
    result = _step(
        new_urgent_workflow(),
        action="ADD_OR_UPDATE",
        orders=[_complete("TMP-101"), _complete("TMP-102")],
    )
    assert result.state.stage == "REVIEW_READY"
    assert [order.order_id for order in result.complete_orders] == ["TMP-101", "TMP-102"]


def test_partial_batch_reports_missing_fields_per_order_and_blocks_all_preview() -> None:
    incomplete = _complete("TMP-102").model_copy(update={"zone_code": None})
    result = _step(
        new_urgent_workflow(),
        action="ADD_OR_UPDATE",
        orders=[_complete("TMP-101"), incomplete],
    )
    assert result.should_preview is False
    assert result.state.stage == "COLLECTING"
    assert [(item.order_ref, item.missing_fields) for item in result.missing_by_order] == [
        ("TMP-102", ["zone_code"])
    ]


def test_known_fixture_id_is_resolved_before_review() -> None:
    result = _step(new_urgent_workflow(), action="ADD_OR_UPDATE", references=["ORD-041"])
    assert result.state.stage == "REVIEW_READY"
    assert result.complete_orders[0].order_id == "ORD-041"


def test_known_fixture_id_inside_structured_order_is_resolved_before_review() -> None:
    """The model may place a plain ID in orders instead of referenced_order_ids."""
    understanding = UrgentUnderstanding(
        is_urgent_insertion=True,
        action="ADD_OR_UPDATE",
        orders=[UrgentOrderDraft(order_id="ORD-041")],
    )
    result = advance_urgent_workflow(
        new_urgent_workflow(),
        understanding,
        fixture_lookup=get_demo_urgent_order,
        existing_order_ids=set(),
    )

    assert result.state.stage == "REVIEW_READY"
    assert result.complete_orders[0].order_id == "ORD-041"
    assert result.missing_by_order == []
    assert result.complete_orders[0].package_weight_kg == 2.0


def test_unknown_id_requires_only_delivery_fields_not_unrelated_data() -> None:
    result = _step(new_urgent_workflow(), action="ADD_OR_UPDATE", references=["TMP-999"])
    assert result.state.stage == "COLLECTING"
    missing = result.missing_by_order[0]
    assert missing.order_ref == "TMP-999"
    assert "order_id" not in missing.missing_fields
    assert "phone" not in missing.missing_fields
    assert "volume" not in missing.missing_fields


def test_duplicate_ids_are_rejected_before_preview() -> None:
    result = _step(
        new_urgent_workflow(),
        action="ADD_OR_UPDATE",
        orders=[_complete("TMP-101"), _complete("TMP-101")],
    )
    assert result.should_preview is False
    assert result.duplicate_order_ids == ["TMP-101"]


def test_existing_dataset_order_id_is_rejected_before_preview() -> None:
    result = _step(new_urgent_workflow(), action="ADD_OR_UPDATE", orders=[_complete("ORD-001")])
    assert result.should_preview is False
    assert result.duplicate_order_ids == ["ORD-001"]


def test_preview_confirmation_is_a_deterministic_transition() -> None:
    reviewed = _step(new_urgent_workflow(), action="ADD_OR_UPDATE", orders=[_complete()])
    result = _step(reviewed.state, action="PREVIEW")
    assert result.should_preview is True
    assert result.state.stage == "PREVIEW_REQUESTED"
    assert [order.order_id for order in result.complete_orders] == ["TMP-101"]


def test_cancel_discards_draft_without_preview() -> None:
    reviewed = _step(new_urgent_workflow(), action="ADD_OR_UPDATE", orders=[_complete()])
    result = _step(reviewed.state, action="CANCEL")
    assert result.state.stage == "CANCELLED"
    assert result.should_preview is False
    assert result.complete_orders == []


def test_modify_keeps_workflow_in_review_and_never_previews_implicitly() -> None:
    reviewed = _step(new_urgent_workflow(), action="ADD_OR_UPDATE", orders=[_complete()])
    modified = _complete().model_copy(update={"priority": "NORMAL"})
    result = _step(reviewed.state, action="MODIFY", orders=[modified])
    assert result.state.stage == "REVIEW_READY"
    assert result.should_preview is False
    assert result.complete_orders[0].priority == "NORMAL"


def test_followup_fields_without_repeating_id_merge_into_single_pending_order() -> None:
    collecting = _step(
        new_urgent_workflow(),
        action="ADD_OR_UPDATE",
        orders=[UrgentOrderDraft(order_id="TMP-101")],
    )
    result = _step(
        collecting.state,
        action="ADD_OR_UPDATE",
        orders=[_complete().model_copy(update={"order_id": None})],
    )
    assert result.state.stage == "REVIEW_READY"
    assert result.complete_orders[0].order_id == "TMP-101"


def test_followup_with_new_id_fills_existing_anonymous_draft_instead_of_adding_one() -> None:
    collecting = _step(
        new_urgent_workflow(),
        action="ADD_OR_UPDATE",
        orders=[UrgentOrderDraft()],
    )
    result = _step(
        collecting.state,
        action="ADD_OR_UPDATE",
        orders=[_complete().model_copy(update={"order_id": "URG-DEMO-901"})],
    )
    assert result.state.stage == "REVIEW_READY"
    assert [item.order_id for item in result.complete_orders] == ["URG-DEMO-901"]


def test_same_id_in_structured_order_and_reference_is_not_a_duplicate() -> None:
    collecting = _step(
        new_urgent_workflow(),
        action="ADD_OR_UPDATE",
        orders=[UrgentOrderDraft()],
    )
    understanding = UrgentUnderstanding(
        is_urgent_insertion=True,
        action="ADD_OR_UPDATE",
        orders=[_complete().model_copy(update={"order_id": "URG-DEMO-901"})],
        referenced_order_ids=["URG-DEMO-901"],
    )
    result = advance_urgent_workflow(
        collecting.state,
        understanding,
        fixture_lookup=lambda _order_id: None,
        existing_order_ids=set(),
    )
    assert result.state.stage == "REVIEW_READY"
    assert [item.order_id for item in result.complete_orders] == ["URG-DEMO-901"]


def test_prompt_injection_action_cannot_skip_review_or_human_confirmation() -> None:
    result = _step(new_urgent_workflow(), action="BYPASS_CONFIRMATION", orders=[_complete()])
    assert result.should_preview is False
    assert result.blocked_reason == "CONFIRMATION_BYPASS_BLOCKED"
    assert result.state.stage == "BLOCKED"


@pytest.mark.asyncio
async def test_agents_sdk_structured_output_only_understands_and_does_not_preview() -> None:
    payload = UrgentUnderstanding(
        is_urgent_insertion=True,
        action="ADD_OR_UPDATE",
        orders=[_complete()],
    )
    model = ScriptedModel(
        [[assistant_message(json.dumps(payload.model_dump(mode="json"), ensure_ascii=False))]]
    )
    understanding, result = await understand_urgent_message(
        "請加一張臨時配送單",
        new_urgent_workflow(),
        model=model,
    )
    model.assert_complete()
    assert understanding == payload
    assert type(result).__name__ == "RunResult"
