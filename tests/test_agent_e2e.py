import os
from pathlib import Path

import pytest

from src.agent.runtime import run_dispatch_agent
from src.config import get_settings
from src.services.importer import parse_workbook
from src.services.matrix import SimulatedRouteProvider

SAMPLE_WORKBOOK = Path(__file__).parents[1] / "data" / "samples" / "demo-delivery-40-orders.xlsx"


@pytest.mark.live
@pytest.mark.asyncio
async def test_agents_sdk_daily_dispatch_calls_deterministic_planning_tool() -> None:
    if not os.getenv("RUN_LIVE_AGENT_E2E"):
        pytest.skip("Set RUN_LIVE_AGENT_E2E=1 for the explicit Agents SDK E2E gate")
    settings = get_settings()
    if not settings.openai_api_key:
        pytest.skip("OPENAI_API_KEY is not configured")
    dataset, report = parse_workbook(SAMPLE_WORKBOOK)
    assert report.is_valid and dataset is not None
    matrix = SimulatedRouteProvider().build(dataset)

    final_output, context, result = await run_dispatch_agent(
        "請建立今天的配送方案，使用 ORTOOLS；只能根據工具驗證結果回答。",  # noqa: RUF001
        dataset,
        matrix,
    )

    assert context.evidence
    assert context.evidence[0]["tool"] == "plan_dispatch"
    assert context.evidence[0]["validator"]["valid"] is True
    assert context.evidence[0]["provider_mode"] == "SIMULATED"
    assert str(context.evidence[0]["total_distance_m"]) in final_output
    assert any(type(item).__name__ == "ToolCallItem" for item in result.new_items)
