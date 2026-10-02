import json
from pathlib import Path

import pytest
from agents.tool_context import ToolContext

from src.agent import runtime
from src.services.dispatch_rules import DispatchRuleTrial
from src.services.importer import parse_workbook
from src.services.matrix import SimulatedRouteProvider
from src.services.planner import build_baseline


@pytest.mark.asyncio
@pytest.mark.parametrize("reassigned_count", [3, 0])
async def test_rule_preview_distinguishes_affected_orders_from_vehicle_changes(
    monkeypatch: pytest.MonkeyPatch, reassigned_count: int
) -> None:
    workbook = Path(__file__).parents[1] / "data" / "samples" / "demo-50-tight.xlsx"
    dataset, report = parse_workbook(workbook)
    assert dataset is not None and report.is_valid
    matrix = SimulatedRouteProvider().build(dataset)
    plan = build_baseline(dataset, matrix)
    affected_ids = [f"ORD-{index:03d}" for index in range(1, 20)]
    trial = DispatchRuleTrial(
        status="FEASIBLE",
        plan=plan.model_copy(update={"unassigned_orders": ["ORD-050"]}),
        validator={"valid": True},
        diff={
            "reassigned_orders": [
                {
                    "order_id": order_id,
                    "from_vehicle_id": "VEH-002",
                    "to_vehicle_id": "VEH-003",
                }
                for order_id in affected_ids[:reassigned_count]
            ],
            "total_distance_delta_m": 0,
            "total_duration_delta_s": 0,
        },
        affected_order_ids=affected_ids,
        conflicts=[],
    )
    monkeypatch.setattr(runtime, "preview_dispatch_rule_trial", lambda *args, **kwargs: trial)
    monkeypatch.setattr(runtime, "list_dispatch_rules", lambda **kwargs: [])
    context = runtime.DispatchAgentContext(
        dataset=dataset,
        matrix=matrix,
        plan=plan,
        current_user_message="第二車今天單件不能超過20公斤",
    )
    request = runtime.DispatchRuleInput(
        subject_id="VEH-002",
        subject_reference_kind="VEHICLE_ID",
        rule_type="MAX_PACKAGE_WEIGHT",
        value=20.0,
        value_source="EXPLICIT",
        duration="TODAY",
    )

    arguments = json.dumps({"request": request.model_dump()})
    result = json.loads(
        await runtime.preview_dispatch_rule.on_invoke_tool(
            ToolContext(
                context=context,
                tool_name="preview_dispatch_rule",
                tool_call_id="call-rule-preview-message",
                tool_arguments=arguments,
            ),
            arguments,
        )
    )

    assert "19 張受到影響" in result["message"]
    assert f"{reassigned_count} 張需要換車" in result["message"]
    assert "19 張要改派" not in result["message"]
    assert "1 張排不進去" in result["message"]
    assert result["trial"]["affected_order_count"] == 19
    assert result["option"]["trial"]["affected_order_ids"] == affected_ids
    assert len(result["diff"]["reassigned_orders"]) == reassigned_count
