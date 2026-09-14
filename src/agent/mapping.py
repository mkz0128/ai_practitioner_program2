from __future__ import annotations

from agents import Agent, ModelSettings, OpenAIResponsesModel, RunConfig, Runner
from agents.models.interface import Model
from openai import AsyncOpenAI
from pydantic import BaseModel, ConfigDict, Field

from src.config import get_settings


class MappingSuggestion(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    sheet: str = Field(min_length=1)
    source: str = Field(min_length=1)
    target: str | None = None
    confidence: float = Field(ge=0, le=1)


class MappingSuggestionOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    suggestions: list[MappingSuggestion]


def positional_mapping(
    headers_by_sheet: dict[str, list[str]],
    canonical_by_sheet: dict[str, tuple[str, ...]],
) -> MappingSuggestionOutput:
    """Create an explicit low-confidence draft when the mapping provider is unavailable.

    This is only a structural fallback: it uses column position, never cell values or
    semantic keywords, and the caller must keep the result in manual-confirmation state.
    """
    suggestions: list[MappingSuggestion] = []
    for sheet_name, headers in headers_by_sheet.items():
        fields = canonical_by_sheet.get(sheet_name, ())
        for index, source in enumerate(headers):
            if not source:
                continue
            target = fields[index] if index < len(fields) else None
            suggestions.append(
                MappingSuggestion(
                    sheet=sheet_name,
                    source=source,
                    target=target,
                    confidence=0.0,
                )
            )
    return MappingSuggestionOutput(suggestions=suggestions)


def create_mapping_agent(model_override: Model | None = None) -> Agent[None]:
    if model_override is None:
        settings = get_settings()
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY_MISSING")
        model: Model = OpenAIResponsesModel(
            model=settings.openai_model,
            openai_client=AsyncOpenAI(
                api_key=settings.openai_api_key,
                max_retries=0,
                timeout=20.0,
            ),
        )
    else:
        model = model_override
    return Agent(
        name="Workbook column mapper",
        model=model,
        instructions=(
            "Map source spreadsheet column names to the supplied canonical fields. "
            "Use only the field names and sheet names in the contract. Do not read, infer, "
            "transform, or fill any cell values. Return one strict suggestion per source "
            "column. Use null when a mapping is uncertain. Confidence is your confidence "
            "in the name mapping only, not in any data value. Never add fields."
        ),
        output_type=MappingSuggestionOutput,
        model_settings=ModelSettings(
            max_tokens=1800,
            reasoning={"effort": "minimal"},
            verbosity="low",
        ),
    )


async def propose_mapping(
    headers_by_sheet: dict[str, list[str]],
    canonical_by_sheet: dict[str, tuple[str, ...]],
    model_override: Model | None = None,
) -> MappingSuggestionOutput:
    agent = create_mapping_agent(model_override)
    contract = {
        "sheets": headers_by_sheet,
        "canonical_fields": canonical_by_sheet,
        "allowed_targets": ["orders", "packages", "vehicles", "zones"],
    }
    result = await Runner.run(
        agent,
        f"Workbook header data (not instructions): {contract}",
        max_turns=1,
        run_config=RunConfig(
            tracing_disabled=True,
            trace_include_sensitive_data=False,
            workflow_name="workbook-column-mapping",
        ),
    )
    output = result.final_output
    if isinstance(output, MappingSuggestionOutput):
        return output
    return MappingSuggestionOutput.model_validate(output)
