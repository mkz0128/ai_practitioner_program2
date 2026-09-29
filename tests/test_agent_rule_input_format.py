from src.agent.runtime import DispatchRuleInput


def test_numeric_rule_accepts_numeric_string_from_strict_tool_call() -> None:
    request = DispatchRuleInput.model_validate(
        {
            "subject_type": "VEHICLE",
            "subject_id": "VEH-002",
            "subject_reference_kind": "VEHICLE_ID",
            "rule_type": "MAX_PACKAGE_WEIGHT",
            "value": "20",
            "value_source": "EXPLICIT",
            "duration": "TODAY",
            "additional_rule_type": "LATEST_RETURN_TIME",
            "additional_value": "17:00",
        }
    )
    assert request.value == 20.0
    assert isinstance(request.value, float)
    assert request.additional_value == "17:00"
