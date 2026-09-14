from pathlib import Path

import pytest
from agents.testing import ScriptedModel, assistant_message, function_call
from fastapi.testclient import TestClient

from src.agent.runtime import DispatchAgentContext, run_dispatch_agent
from src.api.main import _persist_plan_change_preview, app, store
from src.services.importer import parse_workbook
from src.services.matrix import SimulatedRouteProvider
from src.services.planner import build_ortools
from src.services.solve_scope import prioritize_remaining_order

SAMPLE_WORKBOOK = Path(__file__).parents[1] / "data" / "samples" / "demo-delivery-40-orders.xlsx"
client = TestClient(app)


def _fixture():
    dataset, report = parse_workbook(SAMPLE_WORKBOOK)
    assert report.is_valid and dataset is not None
    matrix = SimulatedRouteProvider().build(dataset)
    plan = build_ortools(dataset, matrix, time_limit_seconds=10, objective="FASTEST")
    return dataset, matrix, plan


@pytest.mark.asyncio
async def test_unsupported_plan_change_uses_a_strict_refusal_tool() -> None:
    dataset, matrix, plan = _fixture()
    model = ScriptedModel(
        [
            [function_call("reject_unsupported_change", {}, call_id="unsupported")],
            [assistant_message("只回報工具證據。")],
        ]
    )
    _, context, _ = await run_dispatch_agent(
        "把所有單重新分配一遍。",
        dataset,
        matrix,
        model=model,
        plan=plan,
        plan_id="PLAN-CHANGE-TEST",
        plan_version=1,
    )
    model.assert_complete()
    assert context.evidence[-1]["tool"] == "reject_unsupported_change"
    assert context.evidence[-1]["status"] == "UNSUPPORTED_CHANGE"
    assert "不能改" in context.evidence[-1]["message"]


def test_plan_change_candidate_is_an_immutable_card_until_confirmed() -> None:
    store.datasets.clear()
    store.plans.clear()
    store.current_versions.clear()
    with SAMPLE_WORKBOOK.open("rb") as workbook:
        imported = client.post(
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
    dataset_id = imported.json()["dataset_id"]
    created = client.post(
        "/api/v1/plans",
        json={
            "dataset_id": dataset_id,
            "algorithm": "ORTOOLS",
            "route_provider_preference": "SIMULATED",
        },
    )
    assert created.status_code == 201, created.text
    plan_id = created.json()["plan_id"]
    record = store.get_plan(plan_id, 1)
    dataset_record = store.get_dataset(dataset_id)
    assert record is not None and dataset_record is not None
    order_id = next(
        order_id
        for route in record.plan.routes
        for order_id in route.order_ids
        if len(route.order_ids) > 1
    )
    candidate = prioritize_remaining_order(
        record.plan,
        dataset_record.dataset,
        record.matrix,
        order_id,
    )
    assert candidate is not None
    context = DispatchAgentContext(
        dataset=dataset_record.dataset,
        matrix=record.matrix,
        plan=record.plan,
        plan_id=plan_id,
        plan_version=1,
    )
    context.pending_preview_plan = candidate
    context.pending_preview_kind = "PRIORITIZE_ORDER"
    context.pending_preview_order_id = order_id
    context.evidence.append(
        {
            "tool": "prioritize_order_preview",
            "message": "已重新求解提前配送順序，對話中的新方案卡尚未套用。",
        }
    )
    option = _persist_plan_change_preview(context, record, dataset_record)
    assert option is not None
    assert option["preview_version"] == 2
    expected_eta = next(
        stop.eta
        for route in candidate.routes
        for stop in route.stops
        if stop.order_id == order_id
    )
    assert option["estimated_eta"] == expected_eta
    assert option["cost"]["distance_delta_m"] >= 0
    assert option["cost"]["duration_delta_s"] >= 0
    assert store.current_versions[plan_id] == 1
    assert client.get(f"/api/v1/plans/{plan_id}").json()["version"] == 1

    confirmed = client.post(
        f"/api/v1/plans/{plan_id}/confirm",
        json={
            "version": option["preview_version"],
            "confirmation": "CONFIRM_PLAN",
            "dispatcher_reference": "plan-card-test",
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["version"] == 2
    assert client.get(f"/api/v1/plans/{plan_id}").json()["version"] == 2
