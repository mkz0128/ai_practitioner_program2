from agents.exceptions import ModelBehaviorError, ModelTimeoutError

from src.api.main import _classify_agent_error


def test_agent_timeout_is_retryable_without_sdk_details() -> None:
    status, code, message, retryable = _classify_agent_error(ModelTimeoutError(8.0))

    assert (status, code, retryable) == (504, "AGENT_TIMEOUT", True)
    assert "8.0" not in message


def test_invalid_agent_output_is_blocked_without_false_success() -> None:
    status, code, message, retryable = _classify_agent_error(
        ModelBehaviorError("secret provider response")
    )

    assert (status, code, retryable) == (502, "AGENT_INVALID_RESPONSE", False)
    assert "secret provider response" not in message
    assert "方案沒有變更" in message


def test_unknown_agent_error_remains_safe_and_generic() -> None:
    status, code, message, retryable = _classify_agent_error(
        RuntimeError("headers and credential details")
    )

    assert (status, code, retryable) == (502, "AGENT_RUN_FAILED", False)
    assert "headers" not in message
    assert "credential" not in message
