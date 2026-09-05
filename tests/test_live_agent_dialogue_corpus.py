import os
from pathlib import Path

import pytest

from src.agent.runtime import run_dispatch_agent
from src.config import get_settings
from src.services.importer import parse_workbook
from src.services.matrix import SimulatedRouteProvider
from src.services.planner import build_ortools

SAMPLE_WORKBOOK = Path(__file__).parents[1] / "data" / "samples" / "demo-delivery-40-orders.xlsx"

LIVE_CASES = [
    ("你可以協助調度員做哪些事？", "assistant_help"),
    ("今天的 Excel 要有哪些欄位才可以排車？", "assistant_help"),
    ("你如何避免貨物超過車輛載重？", "assistant_help"),
    ("臨時插單會怎麼處理？", "assistant_help"),
    ("目前哪一台車裝得最重？", "highest_load_vehicle"),
    ("請用目前方案說明 ORD-001 為什麼分到這台車。", "explain_assignment"),
    ("ORD-001 有沒有沒排到？請查目前方案。", "explain_unassigned"),
    ("比較最快、均衡載重與穩定時段三個方案。", "compare_strategies"),
    ("如果全部路線晚十分鐘，哪些訂單會有風險？", "simulate_delay"),
    ("那如果延遲二十分鐘呢？", "simulate_delay"),
    ("模擬所有車晚 30 分鐘。", "simulate_delay"),
    ("VEH-003 今天不能出車，先預覽重新安排。", "change_vehicle_availability"),
    ("三號車突然壞掉惹，其他車幫忙重新排看看。", "change_vehicle_availability"),
    ("把 VEH-003 恢復為可用，先讓我看影響。", "change_vehicle_availability"),
    ("把 ORD-001 改成下午配送，先預覽。", "change_order_constraint"),
    ("請把 ORD-001 的優先順序提高，先不要套用。", "change_order_constraint"),
    ("不要動已確認的前五站。", "change_frozen_stops"),
    ("解除 ORD-001 的凍結狀態。", "change_frozen_stops"),
    ("把 ORD-001 改給 VEH-004，先檢查是否可行。", "reassign_order_preview"),
    ("目前是哪個方案版本？", "query_plan_version"),
    ("這個方案我同意了，接下來要怎麼人工確認？", "prepare_confirmation"),
    ("臨時多了一張下午三點前要送的急單，幫我插進去。", "request_missing_fields"),
    (
        "新增急單 TMP-901，Z1、臺北市中正區、青年路服務點，座標 25.0324,121.5199，"
        "下午配送，1 件、2 公斤、包裹 TMP-PKG-901、一般優先，請先預覽。",
        "preview_structured_urgent_insert",
    ),
    ("請匯入這份訂單並建立今天的配送方案。", "plan_dispatch"),
]


@pytest.mark.live
@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("message", "expected_tool"), LIVE_CASES, ids=[f"LIVE-{index:02d}" for index in range(1, 25)]
)
async def test_live_runner_semantically_selects_deterministic_tool(
    message: str, expected_tool: str
) -> None:
    if os.getenv("RUN_LIVE_AGENT_CORPUS") != "1":
        pytest.skip("Set RUN_LIVE_AGENT_CORPUS=1 for the explicit 24-case Live Agent gate")
    if not get_settings().openai_api_key:
        pytest.skip("OPENAI_API_KEY is not configured")
    dataset, report = parse_workbook(SAMPLE_WORKBOOK)
    assert report.is_valid and dataset is not None
    matrix = SimulatedRouteProvider().build(dataset)
    plan = build_ortools(dataset, matrix, time_limit_seconds=2)

    output, context, result = await run_dispatch_agent(
        message,
        dataset,
        matrix,
        plan=plan,
        plan_id="PLAN-LIVE-CORPUS",
        plan_version=1,
    )

    assert context.evidence, "Runner did not invoke a deterministic tool"
    assert context.evidence[-1]["tool"] == expected_tool
    assert output
    assert any(type(item).__name__ == "ToolCallItem" for item in result.new_items)
    assert "dispatch" not in {item["tool"].lower() for item in context.evidence}
