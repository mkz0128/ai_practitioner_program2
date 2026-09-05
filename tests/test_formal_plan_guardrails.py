from pathlib import Path

import pytest
from agents.testing import ScriptedModel, assistant_message, function_call
from fastapi.testclient import TestClient

from src.agent.runtime import run_dispatch_agent
from src.api.main import app, store
from src.services.importer import parse_workbook
from src.services.matrix import SimulatedRouteProvider

SAMPLE_WORKBOOK = Path(__file__).parents[1] / "data" / "samples" / "demo-delivery-40-orders.xlsx"
client = TestClient(app)


def _import_demo() -> str:
    store.datasets.clear()
    store.plans.clear()
    store.current_versions.clear()
    with SAMPLE_WORKBOOK.open("rb") as workbook:
        response = client.post(
            "/api/v1/datasets/import-excel",
            files={
                "file": (
                    SAMPLE_WORKBOOK.name,
                    workbook,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
    assert response.status_code == 201, response.text
    return response.json()["dataset_id"]


@pytest.mark.asyncio
async def test_agent_formal_plan_tool_cannot_choose_baseline() -> None:
    dataset, report = parse_workbook(SAMPLE_WORKBOOK)
    assert report.is_valid and dataset is not None
    matrix = SimulatedRouteProvider().build(dataset)
    model = ScriptedModel(
        [
            [function_call("plan_dispatch", {"objective": "FASTEST"}, call_id="formal")],
            [assistant_message("已依工具結果建立正式方案。")],
        ]
    )

    _, context, _ = await run_dispatch_agent(
        "請建立今天的正式配送方案。", dataset, matrix, model=model
    )

    model.assert_complete()
    evidence = context.evidence[-1]
    assert evidence["algorithm"] == "ORTOOLS"
    assert evidence["complete"] is True
    assert evidence["assigned_order_count"] == 40
    assert evidence["unassigned_orders"] == []


def test_plan_payload_separates_completeness_rules_and_confirmability() -> None:
    dataset_id = _import_demo()
    response = client.post(
        "/api/v1/plans",
        json={
            "dataset_id": dataset_id,
            "algorithm": "BASELINE",
            "route_provider_preference": "SIMULATED",
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()

    assert body["completeness"]["is_complete"] is False
    assert body["completeness"]["assigned_order_count"] == 38
    assert body["completeness"]["total_order_count"] == 40
    assert body["rule_check"]["passed"] is True
    assert body["confirmability"]["can_confirm"] is False
    assert "UNASSIGNED_ORDERS" in body["confirmability"]["blockers"]
    unused = next(vehicle for vehicle in body["vehicles"] if vehicle["vehicle_id"] == "VEH-004")
    assert unused["unused_reason"]


def test_complete_ortools_plan_is_confirmable_as_formal_plan() -> None:
    dataset_id = _import_demo()
    response = client.post(
        "/api/v1/plans",
        json={
            "dataset_id": dataset_id,
            "algorithm": "ORTOOLS",
            "route_provider_preference": "SIMULATED",
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["algorithm"] == "ORTOOLS"
    assert body["completeness"]["is_complete"] is True
    assert body["rule_check"]["passed"] is True
    assert body["confirmability"]["can_confirm"] is True
