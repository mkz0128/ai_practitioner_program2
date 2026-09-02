import json
from pathlib import Path

import pytest

from src.observability import JsonlEventRecorder, LimitReachedError, RunBudget
from src.observability.limits import LimitSettings


def test_jsonl_recorder_redacts_sensitive_fields_and_values(tmp_path: Path) -> None:
    recorder = JsonlEventRecorder("RUN-TEST", tmp_path)
    recorder.record(
        "request_finished",
        api_key="do-not-log",
        nested={"client_secret": "do-not-log"},
        message="safe summary",
        request_id="REQ-TEST",
        dataset_id="DS-TEST",
        plan_id="PLAN-TEST",
        plan_version=2,
    )
    payload = json.loads(recorder.path.read_text(encoding="utf-8"))
    assert "api_key" not in payload
    assert payload["nested"]["client_secret"] == "[REDACTED]"
    assert payload["message"] == "safe summary"
    assert payload["request_id"] == "REQ-TEST"
    assert payload["dataset_id"] == "DS-TEST"
    assert payload["plan_id"] == "PLAN-TEST"
    assert payload["plan_version"] == 2
    assert "do-not-log" not in recorder.path.read_text(encoding="utf-8")


def test_run_budget_rejects_repeated_tool_arguments() -> None:
    budget = RunBudget(LimitSettings(max_same_tool_consecutive_calls=2))
    budget.check_tool_call("plan_dispatch", {"algorithm": "BASELINE"})
    budget.check_tool_call("plan_dispatch", {"algorithm": "BASELINE"})
    with pytest.raises(LimitReachedError, match="repeated_tool_arguments"):
        budget.check_tool_call("plan_dispatch", {"algorithm": "BASELINE"})


def test_run_budget_rejects_tool_and_token_limits() -> None:
    budget = RunBudget(
        LimitSettings(max_tool_calls_per_request=1, max_total_tokens_per_request=10)
    )
    budget.check_tool_call("highest_load_vehicle", {})
    with pytest.raises(LimitReachedError, match="tool_calls"):
        budget.check_tool_call("highest_load_vehicle", {})
    with pytest.raises(LimitReachedError, match="total_tokens"):
        budget.observe_usage(type("Usage", (), {"total_tokens": 11})())
    assert budget.total_tokens == 11
