import os

import pytest
from openai import AsyncOpenAI

from src.config import get_settings


@pytest.mark.live
@pytest.mark.asyncio
async def test_responses_gpt5_mini_text_and_strict_tool_smoke() -> None:
    if not os.getenv("RUN_LIVE_RESPONSES_SMOKE"):
        pytest.skip("Set RUN_LIVE_RESPONSES_SMOKE=1 for the explicit Responses API gate")
    settings = get_settings()
    if not settings.openai_api_key:
        pytest.skip("OPENAI_API_KEY is not configured")
    client = AsyncOpenAI(api_key=settings.openai_api_key)
    text_response = await client.responses.create(
        model="gpt-5-mini",
        input="Reply with exactly OK.",
        max_output_tokens=256,
    )
    assert text_response.output_text.strip()
    tool_response = await client.responses.create(
        model="gpt-5-mini",
        input="Call the echo tool exactly once.",
        max_output_tokens=512,
        tools=[
            {
                "type": "function",
                "name": "echo",
                "description": "Return an empty deterministic acknowledgement.",
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "required": [],
                    "additionalProperties": False,
                },
                "strict": True,
            }
        ],
        tool_choice={"type": "function", "name": "echo"},
    )
    assert any(
        item.type == "function_call" and item.name == "echo" for item in tool_response.output
    )
