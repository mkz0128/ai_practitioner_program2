import os
from pathlib import Path

import httpx
import pytest

from src.agent.runtime import run_dispatch_agent
from src.api.main import app, store
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
        "請建立今天的配送方案，使用 ORTOOLS；只能根據工具驗證結果回答。",
        dataset,
        matrix,
    )

    assert context.evidence
    assert context.evidence[0]["tool"] == "plan_dispatch"
    assert context.evidence[0]["validator"]["valid"] is True
    assert context.evidence[0]["provider_mode"] == "SIMULATED"
    # Agent 可使用人類可讀的千分位格式; 驗證仍比對同一個 evidence 數值。
    normalized_output = final_output.replace(",", "")
    assert str(context.evidence[0]["total_distance_m"]) in normalized_output
    assert any(type(item).__name__ == "ToolCallItem" for item in result.new_items)


@pytest.mark.live
@pytest.mark.asyncio
async def test_http_agent_chat_persists_runner_selected_plan() -> None:
    if not os.getenv("RUN_LIVE_AGENT_HTTP_E2E"):
        pytest.skip("Set RUN_LIVE_AGENT_HTTP_E2E=1 for the HTTP Agents SDK gate")
    settings = get_settings()
    if not settings.openai_api_key:
        pytest.skip("OPENAI_API_KEY is not configured")
    store.datasets.clear()
    store.plans.clear()
    store.current_versions.clear()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        with SAMPLE_WORKBOOK.open("rb") as workbook:
            imported = await client.post(
                "/api/v1/datasets/import-excel",
                files={
                    "file": (
                        SAMPLE_WORKBOOK.name,
                        workbook,
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    )
                },
            )
        assert imported.status_code == 201, imported.text
        response = await client.post(
            "/api/v1/agent/chat",
            json={
                "session_id": "LIVE-HTTP-AGENT",
                "message": "請建立今天的 ORTOOLS 配送方案，僅根據工具證據回答。",
                "context": {"dataset_id": imported.json()["dataset_id"]},
            },
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["plan_id"]
    assert body["plan_version"] == 1
    assert any(item["tool"] == "plan_dispatch" for item in body["evidence"])
