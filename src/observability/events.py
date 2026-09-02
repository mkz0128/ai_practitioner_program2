from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock
from typing import Any

_SENSITIVE_NAMES = {
    "password",
    "passwd",
    "secret",
    "token",
    "api_key",
    "authorization",
    "cookie",
    "private_key",
    "client_secret",
}
_SECRET_VALUE_PATTERNS = (
    re.compile(r"(?i)\b(?:sk|rk)-[A-Za-z0-9_-]{20,}"),
    re.compile(r"\bAIza[A-Za-z0-9_-]{20,}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
)


def _safe_key(key: str) -> bool:
    lowered = key.lower()
    return not any(marker in lowered for marker in _SENSITIVE_NAMES)


def _redacted(value: Any, depth: int = 0) -> Any:
    if depth > 3:
        return "[TRUNCATED]"
    if isinstance(value, dict):
        return {
            str(key): _redacted(item, depth + 1) if _safe_key(str(key)) else "[REDACTED]"
            for key, item in list(value.items())[:32]
        }
    if isinstance(value, (list, tuple)):
        return [_redacted(item, depth + 1) for item in list(value)[:32]]
    if isinstance(value, str):
        if any(pattern.search(value) for pattern in _SECRET_VALUE_PATTERNS):
            return "[REDACTED]"
        return value
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return str(type(value).__name__)


class JsonlEventRecorder:
    """Append concise, redacted event records; full prompts and workbook contents are excluded."""

    def __init__(self, agent_run_id: str, output_directory: str | Path = ".agent/runs") -> None:
        self.agent_run_id = agent_run_id
        timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
        directory = Path(output_directory)
        directory.mkdir(parents=True, exist_ok=True)
        self.path = directory / f"{timestamp}-{agent_run_id}.jsonl"
        self._lock = Lock()

    def record(self, event_type: str, **fields: Any) -> None:
        payload = {
            "timestamp": datetime.now(UTC).isoformat(),
            "event_type": event_type,
            "agent_run_id": self.agent_run_id,
            **{key: _redacted(value) for key, value in fields.items() if _safe_key(key)},
        }
        with self._lock, self.path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")
