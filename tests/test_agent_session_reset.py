from pathlib import Path

from fastapi.testclient import TestClient

from src.agent.runtime import DispatchAgentContext
from src.agent.urgent_workflow import UrgentUnderstanding
from src.api.main import AgentSession, agent_sessions, app, store
from src.services import dispatch_parameters, dispatch_rules
from src.services.dispatch_rules import DispatchRule, save_dispatch_rule

client = TestClient(app)


def test_runtime_reset_clears_parameters_and_all_rules(tmp_path, monkeypatch) -> None:
    parameter_path = tmp_path / "dispatch-parameters.json"
    rules_path = tmp_path / "dispatch-rules.json"
    monkeypatch.setattr(dispatch_parameters, "_PARAMETERS_PATH", parameter_path)
    monkeypatch.setattr(dispatch_rules, "_RULES_PATH", rules_path)
    dispatch_parameters.confirm_service_parameter("Z5", 3, 7)
    save_dispatch_rule(
        DispatchRule(
            rule_id="RESET-RULE-001",
            subject_type="VEHICLE",
            subject_id="VEH-003",
            rule_type="MAX_PACKAGE_WEIGHT",
            value=20.0,
            source_utterance="測試規則",
            created_at="2026-09-13T00:00:00+00:00",
        )
    )

    response = client.post("/api/v1/runtime/reset")

    assert response.status_code == 200, response.text
    assert response.json()["service_minutes_by_zone"] == {}
    assert response.json()["cleared_rule_count"] == 1
    assert dispatch_parameters.parameter_state()["service_minutes_by_zone"] == {}
    assert dispatch_rules.list_dispatch_rules(include_inactive=True) == []


def test_agent_chat_clears_frozen_stops_when_dataset_changes(monkeypatch) -> None:
    relaxed = Path(__file__).parents[1] / "data" / "samples" / "demo-50-relaxed.xlsx"
    tight = Path(__file__).parents[1] / "data" / "samples" / "demo-50-tight.xlsx"

    session_id = "DATASET-SWITCH-FROZEN-TEST"
    store.datasets.clear()
    store.plans.clear()
    store.current_versions.clear()
    agent_sessions.pop(session_id, None)
    with relaxed.open("rb") as workbook:
        first_import = client.post(
            "/api/v1/datasets/import-excel",
            files={
                "file": (
                    relaxed.name,
                    workbook,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
    with tight.open("rb") as workbook:
        second_import = client.post(
            "/api/v1/datasets/import-excel",
            files={
                "file": (
                    tight.name,
                    workbook,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
    assert first_import.status_code == 201, first_import.text
    assert second_import.status_code == 201, second_import.text
    first_dataset_id = first_import.json()["dataset_id"]
    second_dataset_id = second_import.json()["dataset_id"]
    first_plan = client.post(
        "/api/v1/plans",
        json={
            "dataset_id": first_dataset_id,
            "algorithm": "ORTOOLS",
            "route_provider_preference": "SIMULATED",
        },
    )
    second_plan = client.post(
        "/api/v1/plans",
        json={
            "dataset_id": second_dataset_id,
            "algorithm": "ORTOOLS",
            "route_provider_preference": "SIMULATED",
        },
    )
    assert first_plan.status_code == 201, first_plan.text
    assert second_plan.status_code == 201, second_plan.text
    agent_sessions[session_id] = AgentSession(
        dataset_id=first_dataset_id,
        plan_id=first_plan.json()["plan_id"],
        plan_version=first_plan.json()["version"],
        frozen_stop_ids=("ORD-001", "ORD-002"),
        frozen_stop_count=2,
    )

    async def fake_understanding(message, state, **kwargs):
        return UrgentUnderstanding(is_urgent_insertion=False), object()

    async def fake_runner(message, dataset, matrix, **kwargs):
        context = DispatchAgentContext(dataset=dataset, matrix=matrix)
        context.evidence.append(
            {
                "tool": "highest_load_vehicle",
                "vehicle_id": "VEH-003",
                "planned_load_kg": 101.0,
                "max_load_kg": 160.0,
            }
        )
        return "已完成確定性工具計算。", context, object()

    monkeypatch.setattr("src.api.main.settings.openai_api_key", "test-openai-key")
    monkeypatch.setattr("src.api.main.understand_urgent_message", fake_understanding)
    monkeypatch.setattr("src.api.main.run_dispatch_agent", fake_runner)

    response = client.post(
        "/api/v1/agent/chat",
        json={
            "session_id": session_id,
            "message": "目前哪一台車載重最高",
            "context": {
                "dataset_id": second_dataset_id,
                "plan_id": second_plan.json()["plan_id"],
                "plan_version": second_plan.json()["version"],
            },
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["message"] == "第三車目前計畫載重 101 kg，載重上限 160 kg。"
    assert agent_sessions[session_id].dataset_id == second_dataset_id
    assert agent_sessions[session_id].frozen_stop_ids == ()
    assert agent_sessions[session_id].frozen_stop_count == 0
