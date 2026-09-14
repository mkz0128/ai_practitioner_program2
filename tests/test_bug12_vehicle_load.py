from pathlib import Path

import pytest
from agents.testing import ScriptedModel, assistant_message, function_call

from src.agent.runtime import run_dispatch_agent
from src.services.importer import parse_workbook
from src.services.matrix import SimulatedRouteProvider

SAMPLE_WORKBOOK = Path(__file__).parents[1] / "data" / "samples" / "demo-50-relaxed.xlsx"


def _fixture():
    dataset, report = parse_workbook(SAMPLE_WORKBOOK)
    assert report.is_valid and dataset is not None
    return dataset, SimulatedRouteProvider().build(dataset)


@pytest.mark.asyncio
@pytest.mark.parametrize("vehicle_id", ["VEH-001", "VEH-002", "VEH-003", "VEH-004"])
async def test_vehicle_load_returns_the_named_vehicle(vehicle_id: str) -> None:
    dataset, matrix = _fixture()
    model = ScriptedModel(
        [
            [function_call("vehicle_load", {"vehicle_id": vehicle_id}, call_id="call-load")],
            [assistant_message("Answer only from the deterministic tool evidence.")],
        ]
    )

    _, context, _ = await run_dispatch_agent(
        f"查詢 {vehicle_id} 的計畫載重。", dataset, matrix, model=model
    )

    model.assert_complete()
    evidence = context.evidence[-1]
    assert evidence["tool"] == "vehicle_load"
    assert evidence["vehicle_id"] == vehicle_id
    assert isinstance(evidence["planned_load_kg"], float)
    assert isinstance(evidence["max_load_kg"], float)
    assert isinstance(evidence["load_utilization"], float)
    assert evidence["remaining_capacity_kg"] == pytest.approx(
        evidence["max_load_kg"] - evidence["planned_load_kg"]
    )
