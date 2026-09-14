from src.api.main import _scope_chat_message

ALL_OPERATOR_TOOLS = (
    "assistant_help",
    "request_missing_fields",
    "begin_urgent_insertion",
    "prepare_confirmation",
    "reject_unsupported_change",
    "preview_dispatch_rule",
    "plan_dispatch",
    "highest_load_vehicle",
    "lowest_load_vehicle",
    "vehicle_load",
    "inspect_plan_overview",
    "inspect_dispatch_deviations",
    "explain_unassigned",
    "explain_assignment",
    "compare_strategies",
    "simulate_delay",
    "change_vehicle_availability",
    "change_order_constraint",
    "change_frozen_stops",
    "reassign_order_preview",
    "prioritize_order_preview",
    "remove_order_preview",
    "enforce_hard_time_windows",
    "query_plan_version",
    "preview_urgent_insert",
    "preview_structured_urgent_insert",
    "preview_multiple_urgent_insert",
)


def test_every_operator_tool_has_a_human_message() -> None:
    for tool in ALL_OPERATOR_TOOLS:
        message = _scope_chat_message(
            [{"tool": tool, "status": "PREVIEWED"}],
            "已完成確定性工具計算；未驗證的數字或訂單資訊已省略。",
        )
        assert message.strip()
        assert not message.startswith(("{", "["))
        assert "已完成確定性工具計算" not in message


def test_scope_extracts_message_from_json_model_output() -> None:
    message = _scope_chat_message(
        [{"tool": "assistant_help", "topic": "CAPABILITIES"}],
        '{"message":"可整理訂單與安排路線。","status":"GUIDANCE"}',
    )
    assert message == "可整理訂單與安排路線。"


def test_scope_uses_tool_template_when_json_has_no_message() -> None:
    message = _scope_chat_message(
        [{"tool": "query_plan_version", "plan_id": "PLAN-DEMO", "version": 3}],
        '[{"status":"PREVIEWED"}]',
    )
    assert message == "目前方案版本是 PLAN-DEMO 第 3 版。"
