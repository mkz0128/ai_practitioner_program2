import pytest
from agents.testing import ScriptedModel, assistant_message, function_call

from src.agent.runtime import run_dispatch_agent
from src.domain.models import Dataset
from src.services.matrix import SimulatedRouteProvider


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("tool_name", "arguments"),
    [
        ("plan_dispatch", {"objective": "FASTEST"}),
        ("compare_strategies", {"request": {"select_strategy": None}}),
        ("simulate_delay", {"request": {"delay_minutes": 10}}),
        ("highest_load_vehicle", {}),
        (
            "change_vehicle_availability",
            {"request": {"vehicle_id": "VEH-003", "status": "UNAVAILABLE"}},
        ),
        (
            "change_order_constraint",
            {"request": {"order_id": "ORD-001", "time_slot": "PM", "priority": None}},
        ),
        (
            "change_frozen_stops",
            {"request": {"action": "FREEZE", "order_ids": [], "stop_count": 5}},
        ),
        (
            "reassign_order_preview",
            {"request": {"order_id": "ORD-001", "target_vehicle_id": "VEH-004"}},
        ),
    ],
)
async def test_planning_tools_fail_closed_before_ortools_when_dataset_is_empty(
    tool_name: str, arguments: dict[str, object]
) -> None:
    dataset = Dataset(orders=(), packages=(), vehicles=(), zones=())
    matrix = SimulatedRouteProvider().build(dataset)
    model = ScriptedModel(
        [
            [function_call(tool_name, arguments, call_id=f"call-{tool_name}")],
            [assistant_message("請先附加訂單資料。")],
        ]
    )

    _, context, _ = await run_dispatch_agent(
        "尚未匯入資料時提出需要排程的要求。", dataset, matrix, model=model
    )

    model.assert_complete()
    assert context.plan is None
    assert context.evidence[-1]["tool"] == tool_name
    assert context.evidence[-1]["status"] == "DATASET_REQUIRED"
    assert context.evidence[-1]["requires_human_confirmation"] is False
