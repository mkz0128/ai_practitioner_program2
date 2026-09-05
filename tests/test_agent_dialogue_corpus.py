import json
from collections import Counter
from pathlib import Path

import pytest
from agents.testing import ScriptedModel

from src.agent import runtime as agent_runtime
from src.agent.runtime import create_dispatch_agent

CORPUS = Path(__file__).parent / "fixtures" / "agent_dialogue_cases.json"
CASES = json.loads(CORPUS.read_text(encoding="utf-8"))["cases"]


def test_agent_dialogue_corpus_has_112_complete_unique_cases() -> None:
    payload = json.loads(CORPUS.read_text(encoding="utf-8"))
    cases = payload["cases"]
    assert payload["total"] == len(cases) == 112
    assert len({item["case_id"] for item in cases}) == 112
    required = {
        "case_id",
        "category",
        "user_message",
        "precondition",
        "expected_tool",
        "expected_parameters",
        "expected_source",
        "required_evidence",
        "allow_preview",
        "allow_formal_mutation",
        "requires_human_confirmation",
        "expected_http_status",
        "forbidden_behaviors",
    }
    assert all(required <= item.keys() for item in cases)
    assert all(item["allow_formal_mutation"] is False for item in cases)


def test_agent_dialogue_corpus_matches_required_category_counts() -> None:
    cases = json.loads(CORPUS.read_text(encoding="utf-8"))["cases"]
    assert Counter(item["category"] for item in cases) == {
        "capabilities": 8,
        "explanation": 12,
        "queries": 12,
        "vehicle_incident": 12,
        "urgent_missing": 12,
        "urgent_complete": 12,
        "delay": 8,
        "freeze": 8,
        "strategies": 8,
        "reassignment": 8,
        "ambiguous": 8,
        "prompt_injection": 4,
    }


def test_all_expected_tools_are_allowlisted_or_guardrail_outcomes() -> None:
    cases = json.loads(CORPUS.read_text(encoding="utf-8"))["cases"]
    agent = create_dispatch_agent(ScriptedModel())
    allowlist = {tool.name for tool in agent.tools}
    expected = {item["expected_tool"] for item in cases}
    assert expected - {"PROMPT_INJECTION_BLOCKED"} <= allowlist
    assert "dispatch" not in {name.lower() for name in allowlist}


def test_live_agent_reserves_output_budget_for_long_strict_tool_arguments(monkeypatch) -> None:
    monkeypatch.setattr(agent_runtime.get_settings(), "openai_api_key", "test-key")
    agent = create_dispatch_agent()
    assert agent.model_settings.tool_choice == "required"
    assert agent.model_settings.parallel_tool_calls is False
    assert agent.model_settings.max_tokens == 4096
    assert agent.model_settings.reasoning is not None
    assert agent.model_settings.reasoning.effort == "minimal"
    assert agent.model_settings.verbosity == "low"


@pytest.mark.parametrize("case", CASES, ids=[item["case_id"] for item in CASES])
def test_each_dialogue_case_enforces_tool_and_mutation_contract(case: dict) -> None:
    """Machine-readable contract: 112 cases, each reported as an independent test."""
    agent = create_dispatch_agent(ScriptedModel())
    allowlist = {tool.name for tool in agent.tools}
    expected_tool = case["expected_tool"]

    assert expected_tool == "PROMPT_INJECTION_BLOCKED" or expected_tool in allowlist
    assert case["expected_source"] in {"deterministic_tool", "input_guardrail"}
    if expected_tool == "PROMPT_INJECTION_BLOCKED":
        assert case["expected_source"] == "input_guardrail"
    else:
        assert case["expected_source"] == "deterministic_tool"
    assert case["allow_formal_mutation"] is False
    assert "automatic_dispatch" in case["forbidden_behaviors"]
    assert "secret_disclosure" in case["forbidden_behaviors"]
    assert isinstance(case["allow_preview"], bool)
    assert isinstance(case["requires_human_confirmation"], bool)
    if case["requires_human_confirmation"]:
        assert case["allow_preview"] is True
