from src.api.main import _scope_chat_message


def test_scope_reply_for_highest_load_is_human_readable() -> None:
    message = _scope_chat_message(
        [
            {
                "tool": "highest_load_vehicle",
                "vehicle_id": "VEH-003",
                "planned_load_kg": 101.0,
                "max_load_kg": 160.0,
            }
        ],
        "已完成確定性工具計算；未驗證的數字或訂單資訊已省略。",
    )
    assert message == "VEH-003 目前計畫載重 101 kg，載重上限 160 kg。"


def test_scope_reply_for_remove_order_names_order_and_count() -> None:
    message = _scope_chat_message(
        [
            {
                "tool": "remove_order_preview",
                "status": "PREVIEWED",
                "order_id": "ORD-019",
                "assigned_order_count": 49,
            }
        ],
        "已完成確定性工具計算；未驗證的數字或訂單資訊已省略。",
    )
    assert message == "已試算今天不配送 ORD-019：目前方案將安排 49 張訂單；原方案尚未變更。"


def test_scope_reply_for_vehicle_availability_names_vehicle_and_impact() -> None:
    message = _scope_chat_message(
        [
            {
                "tool": "change_vehicle_availability",
                "status": "PREVIEWED",
                "requested_status": "UNAVAILABLE",
                "affected_vehicle_id": "VEH-003",
                "plan": {"assigned_order_count": 47, "unassigned_orders": ["ORD-019", "ORD-022"]},
            }
        ],
        "已完成確定性工具計算；未驗證的數字或訂單資訊已省略。",
    )
    assert message == "VEH-003 今天停駛試算完成：目前可安排 47 張，未安排 2 張；請檢查後再確認。"
