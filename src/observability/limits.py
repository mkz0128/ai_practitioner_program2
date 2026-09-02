from __future__ import annotations

import json
from dataclasses import dataclass, field
from time import monotonic
from typing import Any


class LimitReachedError(RuntimeError):
    """Raised when an Agent run reaches a configured safety or cost limit."""

    code = "LIMIT_REACHED"


@dataclass(frozen=True)
class LimitSettings:
    max_agent_turns_per_request: int = 8
    max_tool_calls_per_request: int = 12
    max_same_tool_consecutive_calls: int = 2
    max_total_tokens_per_request: int = 30_000
    max_wall_clock_seconds_per_request: float = 120.0


@dataclass
class RunBudget:
    settings: LimitSettings = field(default_factory=LimitSettings)
    started_at: float = field(default_factory=monotonic)
    tool_calls: int = 0
    total_tokens: int = 0
    _last_tool_signature: str | None = field(default=None, init=False, repr=False)
    _same_tool_consecutive_calls: int = field(default=0, init=False, repr=False)

    def check_wall_clock(self) -> None:
        if monotonic() - self.started_at > self.settings.max_wall_clock_seconds_per_request:
            raise LimitReachedError("wall_clock_seconds")

    def check_tool_call(self, tool_name: str, arguments: dict[str, Any]) -> None:
        self.check_wall_clock()
        if self.tool_calls >= self.settings.max_tool_calls_per_request:
            raise LimitReachedError("tool_calls")
        signature = f"{tool_name}:{json.dumps(arguments, sort_keys=True, separators=(",", ":"))}"
        if signature == self._last_tool_signature:
            self._same_tool_consecutive_calls += 1
        else:
            self._same_tool_consecutive_calls = 1
            self._last_tool_signature = signature
        if self._same_tool_consecutive_calls > self.settings.max_same_tool_consecutive_calls:
            raise LimitReachedError("repeated_tool_arguments")
        self.tool_calls += 1

    def observe_usage(self, usage: Any) -> None:
        self.check_wall_clock()
        total = int(getattr(usage, "total_tokens", 0) or 0)
        if total == 0:
            total = int(getattr(usage, "input_tokens", 0) or 0) + int(
                getattr(usage, "output_tokens", 0) or 0
            )
        self.total_tokens = max(self.total_tokens, total)
        if self.total_tokens > self.settings.max_total_tokens_per_request:
            raise LimitReachedError("total_tokens")

    def check_turn(self, turn: int) -> None:
        self.check_wall_clock()
        if turn > self.settings.max_agent_turns_per_request:
            raise LimitReachedError("agent_turns")
