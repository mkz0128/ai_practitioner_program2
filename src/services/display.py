"""Turn internal identifiers into the words a dispatcher actually says.

Every operator-facing string goes through here. Vehicle ids and slot enums are
how the data is keyed; they are not how anyone on a loading dock talks. Keeping
the conversion in one place is what stops 「第二車」 and 「VEH-002」 appearing in
the same sentence.
"""

from __future__ import annotations

_ORDINALS = ("一", "二", "三", "四", "五", "六", "七", "八", "九", "十")

_SLOTS = {
    "MORNING": "早上",
    "AFTERNOON": "下午",
    "EVENING": "晚上",
}


def vehicle_label(vehicle_id: str | None) -> str:
    """``VEH-002`` becomes 第二車; anything unexpected is returned unchanged.

    Falling back to the raw id matters: a dispatcher seeing VEH-017 knows to ask
    about it, whereas a silently wrong 「第十七車」 would read as if the system
    understood something it did not.
    """
    if not vehicle_id:
        return "這台車"
    text = vehicle_id.strip().upper()
    if not text.startswith("VEH-"):
        return vehicle_id
    digits = text[4:]
    if not digits.isdigit():
        return vehicle_id
    number = int(digits)
    if 1 <= number <= len(_ORDINALS):
        return f"第{_ORDINALS[number - 1]}車"
    return vehicle_id


def vehicle_labels(vehicle_ids: list[str] | tuple[str, ...]) -> str:
    """Join several vehicles the way a person lists them: 第一車、第三車."""
    return "、".join(vehicle_label(item) for item in vehicle_ids)


def slot_label(time_slot: str | None) -> str:
    """``MORNING`` becomes 早上. An unknown slot keeps its own text."""
    if not time_slot:
        return ""
    return _SLOTS.get(str(time_slot).strip().upper(), str(time_slot))


def slot_sentence(time_slot: str | None) -> str:
    """The slot as it appears in a list of order facts: 早上送."""
    label = slot_label(time_slot)
    return f"{label}送" if label in _SLOTS.values() else label


def order_label(order_id: str | None) -> str:
    return order_id or "這張單"


def minutes_phrase(minutes: float) -> str:
    """A duration a person would say out loud: 63 分鐘, or 1 小時 3 分鐘."""
    total = round(minutes)
    if total < 60:
        return f"{total} 分鐘"
    hours, rest = divmod(total, 60)
    return f"{hours} 小時 {rest} 分鐘" if rest else f"{hours} 小時"
