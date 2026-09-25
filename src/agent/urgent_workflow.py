from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, Literal, cast

from agents import Agent, ModelSettings, OpenAIResponsesModel, RunConfig, Runner
from agents.models.interface import Model
from openai import AsyncOpenAI
from pydantic import BaseModel, ConfigDict, Field

from src.agent.runtime import reject_prompt_injection
from src.config import get_settings
from src.domain.models import Order, Package, Priority, TimeSlotValue

UrgentAction = Literal[
    "NONE",
    "ADD_OR_UPDATE",
    "MODIFY",
    "PREVIEW",
    "CANCEL",
    "BYPASS_CONFIRMATION",
]
UrgentFieldName = Literal[
    "order_id",
    "zone_code",
    "city",
    "district",
    "location_label",
    "latitude",
    "longitude",
    "time_slot",
    "declared_package_count",
    "package_weight_kg",
]
REQUIRED_URGENT_FIELDS: tuple[UrgentFieldName, ...] = (
    "order_id",
    "location_label",
    "city",
    "district",
    "latitude",
    "longitude",
    "zone_code",
    "package_weight_kg",
    "declared_package_count",
    "time_slot",
)
# This is the canonical field contract used by both the conversational intake
# and the deterministic preview conversion.  Keep it as an ordered tuple so
# the user-facing missing-field message is stable as well as complete.
URGENT_PREVIEW_REQUIRED_FIELDS: tuple[UrgentFieldName, ...] = REQUIRED_URGENT_FIELDS
UrgentStage = Literal[
    "IDLE",
    "COLLECTING",
    "REVIEW_READY",
    "PREVIEW_REQUESTED",
    "PREVIEW_READY",
    "CANCELLED",
    "BLOCKED",
]


class UrgentOrderDraft(BaseModel):
    """LLM-extracted fields; deterministic code decides whether they are sufficient."""

    model_config = ConfigDict(extra="forbid")

    order_id: str | None = Field(
        default=None,
        description=(
            "本則訊息明確提供的新訂單識別碼；即使位於訊息句首也要擷取，"
            "保留原字串，不得自行產生。只有單獨提到既有訂單識別碼時才放入 referenced_order_ids。"
        ),
    )
    zone_code: str | None = Field(
        default=None, description="本則訊息明確提供的配送區域代碼。"
    )
    city: str | None = Field(
        default=None, description="本則訊息明確提供的城市或縣市；不可由行政區或地點名稱推導。"
    )
    district: str | None = Field(
        default=None,
        description=(
            "只有本則訊息明確說出行政區時才填；單獨的行政區名稱（例如信義區）"
            "屬於 district，不是配送點名稱。地點名稱內的同名文字不算行政區。"
        ),
    )
    location_label: str | None = Field(
        default=None,
        description=(
            "本則訊息明確提供的具體配送點、店名、站名或地址；單獨的行政區名稱"
            "不能填入 location_label，必須另有具體配送點才能填。若本則訊息已有緯度與經度，"
            "location_label 可留空，應由應用程式產生顯示用標籤。"
        ),
    )
    latitude: float | None = Field(
        default=None, ge=-90, le=90, description="本則訊息明確提供的緯度。"
    )
    longitude: float | None = Field(
        default=None, ge=-180, le=180, description="本則訊息明確提供的經度。"
    )
    time_slot: TimeSlotValue | None = Field(
        default=None,
        description=(
            "本則訊息明確提供的配送時段；『今天早上送到』、『今天早上配送』、"
            "『早上送』都表示 MORNING，『下午』表示 AFTERNOON，『晚上』表示 EVENING。"
        ),
    )
    declared_package_count: int | None = Field(
        default=None, ge=1, le=3, description="本則訊息明確提供的包裹件數。"
    )
    package_weight_kg: float | None = Field(
        default=None, gt=0, description="本則訊息明確提供的每件重量。"
    )
    priority: Literal["NORMAL", "HIGH"] | None = Field(
        default=None,
        description="不要填寫；訂單的優先級由應用程式依流程決定。",
    )
    supplied_fields: list[UrgentFieldName] = Field(
        default_factory=list,
        max_length=10,
        description=(
            "只列本則訊息明確說出的欄位。每個 populated 欄位都必須列入；"
            "若『信義』只出現在『信義示範配送點』這個地點名稱內，不能列 district。"
        ),
    )
    derived_fields: list[UrgentFieldName] = Field(
        default_factory=list,
        max_length=10,
        description="只由應用程式依已提供欄位與資料集確定性推導的欄位；模型不得填寫。",
    )

    @staticmethod
    def resolve_priority(supplied: str | None) -> str:
        """Decide the priority from the workflow, not from the model's mood.

        An order taken in here is a same-day urgent insert by construction, so
        the interpreter is not asked to judge it.  Left to the model, the same
        sentence tagged one run 急件 and the next run not.
        """
        return supplied or "HIGH"

    @classmethod
    def from_order(cls, order: Order) -> UrgentOrderDraft:
        weights = {package.weight_kg for package in order.packages}
        per_package = next(iter(weights)) if len(weights) == 1 else None
        return cls(
            order_id=order.order_id,
            zone_code=order.zone_code,
            city=order.city,
            district=order.district,
            location_label=order.location_label,
            latitude=order.latitude,
            longitude=order.longitude,
            time_slot=order.time_slot,
            declared_package_count=order.declared_package_count,
            package_weight_kg=per_package,
            priority=order.priority.value,
            supplied_fields=list(REQUIRED_URGENT_FIELDS),
        )

    def to_order(self) -> Order:
        resolved = ensure_display_location_label(self)
        missing = missing_fields(resolved)
        if missing:
            raise ValueError(f"URGENT_ORDER_FIELDS_MISSING:{','.join(missing)}")
        assert resolved.order_id is not None
        assert resolved.zone_code is not None
        assert resolved.city is not None
        assert resolved.district is not None
        assert resolved.location_label is not None
        assert resolved.latitude is not None
        assert resolved.longitude is not None
        assert resolved.time_slot is not None
        assert resolved.declared_package_count is not None
        assert resolved.package_weight_kg is not None
        packages = tuple(
            Package(
                package_id=f"PKG-{resolved.order_id}-{index:02d}",
                order_id=resolved.order_id,
                weight_kg=resolved.package_weight_kg,
            )
            for index in range(1, resolved.declared_package_count + 1)
        )
        return Order(
            order_id=resolved.order_id,
            zone_code=resolved.zone_code,
            city=resolved.city,
            district=resolved.district,
            location_label=resolved.location_label,
            latitude=resolved.latitude,
            longitude=resolved.longitude,
            time_slot=resolved.time_slot,
            declared_package_count=resolved.declared_package_count,
            priority=Priority(self.resolve_priority(resolved.priority)),
            note="由使用者提供的臨時訂單",
            packages=packages,
        )


class UrgentUnderstanding(BaseModel):
    """Structured semantic result from the Agents SDK; never executes a preview."""

    model_config = ConfigDict(extra="forbid")

    is_urgent_insertion: bool
    action: UrgentAction = Field(
        default="NONE",
        description=(
            "BYPASS_CONFIRMATION 只給「不用檢查了」「直接派車」「跳過預覽」這種"
            "明確要略過人工確認的要求。"
            "「用 A，但這單先送」「照 B，可是先送那一張」是在挑一個方案再要求調整，"
            "不是跳過確認：這種句子填 NONE，交給主流程重新試算。"
            "CANCEL 是放掉手上的草稿，ADD_OR_UPDATE 是補或改欄位，"
            "PREVIEW 是要看插單預覽。"
        ),
    )
    preview_requested: bool = Field(
        default=False,
        description=(
            "只有使用者在 REVIEW_READY 狀態明確要求產生、查看或顯示臨時插單預覽時為 true。"
            "這是語意欄位，不是從字串關鍵字判斷；此時 action 必須是 PREVIEW 且 orders 必須為空。"
        ),
    )
    orders: list[UrgentOrderDraft] = Field(default_factory=list, max_length=20)
    referenced_order_ids: list[str] = Field(default_factory=list, max_length=20)


class UrgentFieldAudit(BaseModel):
    """Strict re-extraction result for one urgent-order draft."""

    model_config = ConfigDict(extra="forbid")

    order: UrgentOrderDraft


class UrgentFieldAuditResult(BaseModel):
    """Strict, fail-closed provenance audit aligned with extracted order order."""

    model_config = ConfigDict(extra="forbid")

    orders: list[UrgentFieldAudit] = Field(default_factory=list, max_length=20)


class MissingOrderFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    order_ref: str
    missing_fields: list[str]


class UrgentWorkflowState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stage: UrgentStage = "IDLE"
    orders: list[UrgentOrderDraft] = Field(default_factory=list)
    pending_order_id: str | None = None


@dataclass(frozen=True)
class UrgentWorkflowResult:
    state: UrgentWorkflowState
    complete_orders: list[UrgentOrderDraft]
    missing_by_order: list[MissingOrderFields]
    duplicate_order_ids: list[str]
    should_preview: bool
    blocked_reason: str | None = None


def new_urgent_workflow() -> UrgentWorkflowState:
    return UrgentWorkflowState()


def _field_is_available(
    order: UrgentOrderDraft, field: UrgentFieldName, value: object
) -> bool:
    has_value = value is not None and not (
        isinstance(value, str) and not value.strip()
    )
    if not has_value:
        return False
    if not order.supplied_fields:
        return True
    return field in order.supplied_fields or field in order.derived_fields


def missing_fields(order: UrgentOrderDraft) -> list[str]:
    # Direct deterministic callers and persisted v1 drafts have no provenance
    # list. Keep their value-based behaviour; live structured intake supplies
    # the list so a value inferred from another field cannot look complete.
    def available(field: UrgentFieldName, value: object) -> bool:
        return _field_is_available(order, field, value)

    values: dict[UrgentFieldName, object] = {
        "order_id": order.order_id,
        "location_label": order.location_label,
        "city": order.city,
        "district": order.district,
        "latitude": order.latitude,
        "longitude": order.longitude,
        "zone_code": order.zone_code,
        "package_weight_kg": order.package_weight_kg,
        "declared_package_count": order.declared_package_count,
        "time_slot": order.time_slot,
    }
    coordinates_are_available = available("latitude", values["latitude"]) and available(
        "longitude", values["longitude"]
    )
    return [
        field
        for field in URGENT_PREVIEW_REQUIRED_FIELDS
        if field != "location_label" or not coordinates_are_available
        if not available(field, values[field])
    ]


def ensure_display_location_label(order: UrgentOrderDraft) -> UrgentOrderDraft:
    """Fill the display-only place label from explicit district or coordinates."""
    if order.location_label and order.location_label.strip():
        return order
    coordinates_are_available = _field_is_available(
        order, "latitude", order.latitude
    ) and _field_is_available(order, "longitude", order.longitude)
    if coordinates_are_available and _field_is_available(
        order, "district", order.district
    ) and order.district:
        label = f"{order.district.strip()}配送點"
    elif coordinates_are_available:
        assert order.latitude is not None
        assert order.longitude is not None
        label = f"座標 {order.latitude:.6f}, {order.longitude:.6f}"
    else:
        return order
    return order.model_copy(
        update={
            "location_label": label,
            "derived_fields": list(dict.fromkeys([*order.derived_fields, "location_label"])),
        }
    )


def _merge_order(current: UrgentOrderDraft | None, update: UrgentOrderDraft) -> UrgentOrderDraft:
    if current is None:
        return update
    update_data = update.model_dump(exclude_none=True)
    supplied_fields = list(
        dict.fromkeys([*current.supplied_fields, *update.supplied_fields])
    )
    # A field the dispatcher has now stated is no longer one the application
    # filled in, so it must drop out of derived_fields. Left in, the card kept
    # saying 「這是我補的」 about a value they had just corrected themselves.
    stated = set(update.supplied_fields)
    derived_fields = [
        name
        for name in dict.fromkeys([*current.derived_fields, *update.derived_fields])
        if name not in stated
    ]
    if supplied_fields:
        update_data["supplied_fields"] = supplied_fields
    update_data["derived_fields"] = derived_fields
    return current.model_copy(update=update_data)


def advance_urgent_workflow(
    state: UrgentWorkflowState,
    understanding: UrgentUnderstanding,
    *,
    fixture_lookup: Callable[[str], Order | None],
    existing_order_ids: set[str],
) -> UrgentWorkflowResult:
    """Advance the non-mutating urgent-order state machine.

    Only a REVIEW_READY state followed by an explicit PREVIEW action can set
    ``should_preview``. The language model cannot execute or skip this transition.
    """

    if understanding.action == "BYPASS_CONFIRMATION":
        return UrgentWorkflowResult(
            state=UrgentWorkflowState(stage="BLOCKED"),
            complete_orders=[],
            missing_by_order=[],
            duplicate_order_ids=[],
            should_preview=False,
            blocked_reason="CONFIRMATION_BYPASS_BLOCKED",
        )
    if understanding.action == "CANCEL":
        return UrgentWorkflowResult(
            state=UrgentWorkflowState(stage="CANCELLED"),
            complete_orders=[],
            missing_by_order=[],
            duplicate_order_ids=[],
            should_preview=False,
        )

    incoming: list[UrgentOrderDraft] = []
    for supplied in understanding.orders:
        normalized_order = supplied.model_copy(
            update={"order_id": supplied.order_id.strip().upper()}
            if supplied.order_id
            else {}
        )
        fixture = (
            fixture_lookup(normalized_order.order_id)
            if normalized_order.order_id
            else None
        )
        if fixture is not None:
            # Models may represent a plain order reference as an item containing
            # only order_id. Resolve that deterministic record regardless of
            # which strict field carried the ID, while letting explicitly
            # supplied values override the fixture.
            normalized_order = _merge_order(
                UrgentOrderDraft.from_order(fixture), normalized_order
            )
        incoming.append(normalized_order)
    structured_ids = {
        item.order_id.strip().upper() for item in incoming if item.order_id
    }
    for reference in understanding.referenced_order_ids:
        normalized = reference.strip().upper()
        if normalized in structured_ids:
            continue
        fixture = fixture_lookup(normalized)
        incoming.append(
            UrgentOrderDraft.from_order(fixture)
            if fixture is not None
            else UrgentOrderDraft(order_id=normalized)
        )
    if not incoming and not state.orders and understanding.action in {
        "ADD_OR_UPDATE",
        "MODIFY",
        "PREVIEW",
    }:
        incoming = [UrgentOrderDraft()]

    normalized_incoming_ids = [
        item.order_id.strip().upper() for item in incoming if item.order_id
    ]
    duplicate_ids = sorted(
        {item for item in normalized_incoming_ids if normalized_incoming_ids.count(item) > 1}
        | existing_order_ids.intersection(normalized_incoming_ids)
    )
    if duplicate_ids:
        return UrgentWorkflowResult(
            state=UrgentWorkflowState(
                stage="BLOCKED",
                orders=state.orders,
                pending_order_id=state.pending_order_id,
            ),
            complete_orders=[],
            missing_by_order=[],
            duplicate_order_ids=duplicate_ids,
            should_preview=False,
            blocked_reason="DUPLICATE_ORDER_ID",
        )

    order_map = {
        item.order_id.strip().upper(): item
        for item in state.orders
        if item.order_id is not None
    }
    anonymous = [item for item in state.orders if item.order_id is None]
    for item in incoming:
        normalized_order = item.model_copy(
            update={"order_id": item.order_id.strip().upper()} if item.order_id else {}
        )
        if normalized_order.order_id:
            current = order_map.get(normalized_order.order_id)
            if current is None and anonymous:
                current = anonymous.pop(0)
            order_map[normalized_order.order_id] = _merge_order(
                current, normalized_order
            )
        elif state.pending_order_id and state.pending_order_id in order_map:
            order_map[state.pending_order_id] = _merge_order(
                order_map[state.pending_order_id], normalized_order
            )
        else:
            if anonymous:
                anonymous[0] = _merge_order(anonymous[0], normalized_order)
            elif len(order_map) == 1:
                only_id = next(iter(order_map))
                order_map[only_id] = _merge_order(order_map[only_id], normalized_order)
            else:
                anonymous.append(normalized_order)
    orders = [
        ensure_display_location_label(order)
        for order in [*order_map.values(), *anonymous]
    ]

    missing_by_order = [
        MissingOrderFields(
            order_ref=order.order_id or f"第 {index} 張急單",
            missing_fields=missing,
        )
        for index, order in enumerate(orders, start=1)
        if (missing := missing_fields(order))
    ]
    if missing_by_order:
        next_state = UrgentWorkflowState(
            stage="COLLECTING",
            orders=orders,
            pending_order_id=state.pending_order_id,
        )
        return UrgentWorkflowResult(
            state=next_state,
            complete_orders=[],
            missing_by_order=missing_by_order,
            duplicate_order_ids=[],
            should_preview=False,
        )

    if understanding.action == "PREVIEW" and state.stage == "REVIEW_READY":
        next_state = UrgentWorkflowState(stage="PREVIEW_REQUESTED", orders=orders)
        return UrgentWorkflowResult(
            state=next_state,
            complete_orders=orders,
            missing_by_order=[],
            duplicate_order_ids=[],
            should_preview=True,
        )

    next_state = UrgentWorkflowState(stage="REVIEW_READY", orders=orders)
    return UrgentWorkflowResult(
        state=next_state,
        complete_orders=orders,
        missing_by_order=[],
        duplicate_order_ids=[],
        should_preview=False,
    )


def create_urgent_understanding_agent(
    model_override: Model | None = None,
    *,
    existing_order_ids: Sequence[str] = (),
) -> Agent[None]:
    if model_override is None:
        settings = get_settings()
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY_MISSING")
        model: Model = OpenAIResponsesModel(
            model=settings.openai_model,
            openai_client=AsyncOpenAI(api_key=settings.openai_api_key),
        )
    else:
        model = model_override
    return Agent(
        name="Urgent order interpreter",
        model=model,
        instructions=(
            "Classify the current message semantically. Do not use keyword matching. "
            "Highest-priority workflow boundary: when application state says "
            "urgent_stage=REVIEW_READY and summary_already_shown=true, and the current "
            "message explicitly asks to generate, create, or show the urgent insertion "
            "preview, return is_urgent_insertion=true, action=PREVIEW, "
            "preview_requested=true, and orders=[]; do not return ADD_OR_UPDATE, MODIFY, "
            "NONE, or a blank draft, and do not ask for fields that are already in the "
            "shown summary. "
            "Hard boundary: this interpreter may return is_urgent_insertion=true only "
            "when the current message supplies a new temporary-delivery fact or explicitly "
            "operates on the displayed urgent draft. A request to inspect, summarize, or "
            "describe the current dispatch plan—including its shape, arrangement, or status—"
            "must return is_urgent_insertion=false, action=NONE, and empty orders, even "
            "when a draft or preview is present. "
            "First check whether the current message contains a new temporary-delivery fact "
            "or an explicit operation on the already shown urgent draft. If it contains neither, "
            "always set is_urgent_insertion=false and action=NONE; do not let the presence of "
            "urgent_stage, a pending order, or an earlier draft change that result. Questions "
            "about the plan, status, version, vehicle load, assignment, strategy, or deviations "
            "are examples of this unrelated case and belong to the main dispatch Agent. In that "
            "case return no draft orders and no supplied fields; never copy a field from the "
            "draft metadata into the current message's structured result. Viewing, describing, "
            "or asking what the current plan looks like is not an operation on the urgent draft, "
            "even when the message is vague or mentions the plan itself. "
            "This interpreter only owns new temporary-delivery facts and explicit operations "
            "on an already shown urgent draft. If the current message is a read-only question "
            "about the fleet or plan—overview, strategy comparison, vehicle load, greatest load, "
            "plan version, assignment, or delivery deviation—always set "
            "is_urgent_insertion=false and action=NONE, regardless of urgent_stage. The main "
            "dispatch Agent owns those queries. Never replay the draft because its metadata is "
            "present. "
            "An existing order ID from the current plan combined with a request to stop "
            "today, move to a later day, arrive earlier, meet an arrival deadline, or change "
            "its delivery slot is not an urgent-order draft; set is_urgent_insertion=false "
            "and action=NONE so the main dispatch agent can choose the correct plan-change "
            "tool. Do not decide that tool in this intake pass. "
            "A request to assign an existing or current order to a named human driver or "
            "person is also not a new urgent order, even when no order ID is repeated; set "
            "is_urgent_insertion=false and action=NONE so the main dispatch agent can use "
            "reject_unsupported_change. "
            "Set is_urgent_insertion=true only for adding one or more temporary delivery "
            "orders, supplying missing fields for that active workflow, choosing preview, "
            "modifying the shown draft, or cancelling it. Extract only facts the user supplied. "
            "Even when the message supplies only a time slot and weight, it still describes "
            "one new urgent order: return one order object containing those supplied fields; "
            "do not return an empty orders list or discard the time slot. In particular, "
            "『有一張急單要今天早上送到，15公斤』 must produce one order with "
            "time_slot=MORNING and package_weight_kg=15. "
            "Never invent location, zone, weight, count, MORNING/AFTERNOON/EVENING, "
            "IDs or coordinates. Always leave priority null: the application, not "
            "you, decides it from the workflow the order arrived through. "
            "Interpret city and district as separate fields: city is the supplied "
            "municipality or county (for example 臺北市), while district is the supplied "
            "local district (for example 信義區). A district name is not a city; never "
            "copy or infer a city from a district, and leave city null when no city was "
            "supplied. Preserve the user's supplied district text exactly; do not append "
            "or remove a suffix such as 區. "
            "Every populated field in an order must also be listed in supplied_fields "
            "only when the user explicitly stated that field in the current message. "
            "Do not treat a word embedded in location_label, such as the 信義 in "
            "信義示範配送點, as an explicitly supplied district. A follow-up may list "
            "only the fields supplied in that follow-up; the application merges the "
            "provenance with the existing draft. "
             "A place name is location_label, while an administrative district must "
             "be stated separately; do not infer district from a place-name substring. "
             "A follow-up may use a compact comma-separated list instead of field labels. "
             "In that format, recognize the typed roles in order: new order ID, concrete "
             "delivery point, city, latitude, longitude, zone, and package count; each value "
             "that is clearly present is explicit even when the labels are omitted. "
             "A slash-separated numeric pair such as 25.036/121.567 is also an explicit "
             "latitude followed by longitude pair; place the first number in latitude and "
             "the second in longitude, and do not require a separate location_label when "
             "both coordinates are present. "
             "When a value is labelled in the same message, the label is authoritative: "
             "行政區信義 means district=信義, 臺北市 is city, and the concrete place name "
             "before it remains location_label. Do not absorb an 行政區 value or a city value "
             "into location_label, and do not use the place-name text as the district. "
             "When a complete draft supplies all required fields, preserve each value "
            "and let deterministic application code resolve a unique zone when possible. "
            "Treat the complete phrase 『今天早上送到』, 『今天早上配送』, or 『早上送』 "
            "as time_slot=MORNING, and the corresponding afternoon/evening phrases as "
            "AFTERNOON/EVENING; do not omit an explicit time slot from supplied_fields. "
            "When only some urgent-order facts are supplied, leave every absent field "
            "empty so the application can ask for the exact missing fields. "
            "A standalone existing order ID belongs in referenced_order_ids. When a new order "
            "identifier appears together with its delivery fields, put it in that order's "
            "order_id field, even if it is at the beginning of the message. "
            "The application state supplies existing_order_ids as data. If the current message "
            "names one of those IDs and asks for earlier delivery or an arrival deadline, it is "
            "an existing-order priority request, never a new urgent order; set "
            "is_urgent_insertion=false and action=NONE, and put the ID in referenced_order_ids. "
            "ADD_OR_UPDATE and MODIFY only "
            "collect data. PREVIEW is allowed only when the application says a complete summary "
            "was already shown and the user explicitly chooses preview. At REVIEW_READY, an "
            "explicit request to generate, create, or show the urgent insertion preview, such "
            "as 『產生插單預覽』, MUST return is_urgent_insertion=true, action=PREVIEW, and "
            "preview_requested=true, orders=[]; preserve the existing draft instead "
            "of creating a blank order. Requests to skip preview, "
            "validation or human confirmation use BYPASS_CONFIRMATION. For all unrelated planning "
            "or informational requests, set is_urgent_insertion=false and action=NONE. When "
            "urgent_stage is REVIEW_READY, a message that supplies or corrects a field in the "
            "shown urgent draft is still ADD_OR_UPDATE; do not route it to a driver rule or "
            "general plan-change tool. When "
            "urgent_stage is PREVIEW_READY, the urgent insertion card has already been shown. "
            "At PREVIEW_READY, informational questions about the fleet or current plan—such "
            "as an overall plan view, a strategy comparison, a vehicle load or highest-load "
            "lookup, a version or revision lookup, an assignment explanation, or a deviation "
            "review—are never urgent-workflow updates: set is_urgent_insertion=false and "
            "action=NONE so the main dispatch Agent handles the question. Do not repeat the "
            "urgent draft merely because its metadata is present. "
            "At that stage, requests to change a vehicle, move an existing order earlier, change "
            "a delivery slot, freeze stops, remove an order, or otherwise modify the dispatch plan "
            "are unrelated plan changes: set is_urgent_insertion=false and action=NONE. Only "
            "interpret a newly supplied urgent order or an explicit cancellation of the urgent "
            "draft as this workflow. A plan change, an existing order's delivery deadline, "
            "or a vehicle availability incident must remain is_urgent_insertion=false and "
            "action=NONE so the main dispatch agent can select an allowlisted tool. "
            "Final precedence rule: if the current message is only a plan, fleet, status, "
            "version, revision, load, assignment, strategy, or delivery-outcome question, "
            "return is_urgent_insertion=false, action=NONE, orders=[], and "
            "referenced_order_ids=[]; never copy any value from draft_orders. "
            "A request to see, review, summarize, or describe the current plan is not an "
            "operation on the urgent draft and is never PREVIEW, MODIFY, or ADD_OR_UPDATE, "
            "including while urgent_stage is REVIEW_READY; this includes asking for the "
            "plan's shape or overall arrangement. Return the empty NONE result so "
            "the main dispatch Agent handles the plan question. "
        ),
        output_type=UrgentUnderstanding,
        input_guardrails=[cast(Any, reject_prompt_injection)],
        model_settings=ModelSettings(
            # Ten-order intake is a strict extraction result, not a planning
            # answer. Keep enough room for the bounded structured payload while
            # avoiding the larger planning-response budget.
            max_tokens=3072,
            reasoning={"effort": "minimal"},
            verbosity="low",
        ),
    )


def create_urgent_field_audit_agent(model_override: Model | None = None) -> Agent[None]:
    """Create the strict provenance pass used before a draft can be reviewed."""
    if model_override is None:
        settings = get_settings()
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY_MISSING")
        model: Model = OpenAIResponsesModel(
            model=settings.openai_model,
            openai_client=AsyncOpenAI(api_key=settings.openai_api_key),
        )
    else:
        model = model_override
    return Agent(
        name="Urgent field provenance auditor",
        model=model,
        instructions=(
            "Re-extract the urgent-order fields from the current user message only. "
            "Use strict structured output; do not execute tools or infer missing facts. "
            "Return one order object per expected order, in message order. "
            "A field is explicit only when the current user message clearly states that "
            "field as a standalone fact. A concrete delivery point, store, station or "
            "address is location_label; a standalone administrative district is district, "
             "not location_label. A word inside a concrete place name is not district. "
            "A compact comma-separated follow-up may list the new order ID, concrete delivery "
            "point, city, latitude, longitude, zone, and package count in that typed order; "
            "treat each clearly supplied value as explicit even without a field label. "
            "A slash-separated numeric pair such as 25.036/121.567 is also an explicit "
            "latitude followed by longitude pair; put the first number in latitude and the "
            "second in longitude, so a separate location_label is not required when both "
            "coordinates are present. "
            "When a value is labelled in the message, the label is authoritative: "
             "行政區信義 is district=信義 and 臺北市 is city; keep the concrete place name "
             "as location_label and do not absorb labelled city or district text into it. "
             "When a new order identifier appears with delivery fields, put it in order_id "
            "even if it is at the beginning of the message; use referenced_order_ids only "
            "for a standalone reference to an existing order. "
            "Keep a field empty unless the current "
            "message states it as a standalone fact, and list only those fields in "
            "supplied_fields. The deterministic application will merge provenance "
            "across turns and will ask for every field that a preview requires. "
            "In other messages, treat an explicit weight such as 15公斤 as "
            "package_weight_kg=15, and an explicit phrase such as 今天早上送到、今天早上配送、"
            "早上送 or 早上時段 as time_slot=MORNING; include both in supplied_fields. "
            "If a phrase is ambiguous, leave the field empty. Do not copy a value from "
            "any application state or candidate draft."
        ),
        output_type=UrgentFieldAuditResult,
        input_guardrails=[cast(Any, reject_prompt_injection)],
        model_settings=ModelSettings(
            max_tokens=2048,
            reasoning={"effort": "minimal"},
            verbosity="low",
        ),
    )


def _apply_field_audit(
    understanding: UrgentUnderstanding,
    audit: UrgentFieldAuditResult,
) -> UrgentUnderstanding:
    """Make the independent provenance pass authoritative, failing closed."""
    audited_orders: list[UrgentOrderDraft] = []
    for index, draft in enumerate(understanding.orders):
        audited = (
            audit.orders[index].order
            if index < len(audit.orders)
            else UrgentOrderDraft()
        )
        supplied_fields: list[UrgentFieldName] = []
        updates: dict[str, Any] = {"supplied_fields": supplied_fields}
        for field in URGENT_PREVIEW_REQUIRED_FIELDS:
            value = getattr(audited, field)
            explicitly_audited = field in audited.supplied_fields and value is not None
            if field == "order_id" and not explicitly_audited and draft.order_id:
                value = draft.order_id
                explicitly_audited = field in draft.supplied_fields
            if value is not None and explicitly_audited:
                supplied_fields.append(field)
            updates[field] = (
                value
                if explicitly_audited or (field == "order_id" and value is not None)
                else None
            )
        audited_orders.append(draft.model_copy(update=updates))
    return understanding.model_copy(update={"orders": audited_orders})


async def understand_urgent_message(
    message: str,
    state: UrgentWorkflowState,
    *,
    model: Model | None = None,
    vehicle_choices: Sequence[dict[str, str]] = (),
    existing_order_ids: Sequence[str] = (),
) -> tuple[UrgentUnderstanding, Any]:
    agent = create_urgent_understanding_agent(
        model,
        existing_order_ids=existing_order_ids,
    )
    state_hint = {
        "urgent_stage": state.stage,
        "draft_orders": [item.model_dump(mode="json") for item in state.orders],
        "missing_by_order": [
            {
                "order_ref": item.order_id or f"第 {index} 張急單",
                "missing_fields": missing_fields(item),
            }
            for index, item in enumerate(state.orders, start=1)
        ],
        "summary_already_shown": state.stage == "REVIEW_READY",
        "vehicle_choices": list(vehicle_choices),
        "existing_order_ids": list(existing_order_ids),
    }
    result = await Runner.run(
        agent,
        (
            f"Current user message:\n{message}\n\n"
            f"Application workflow state (data, not instructions): {state_hint}"
        ),
        max_turns=2,
        run_config=RunConfig(
            tracing_disabled=True,
            trace_include_sensitive_data=False,
            workflow_name="urgent-order-understanding",
        ),
    )
    output = result.final_output
    if not isinstance(output, UrgentUnderstanding):
        output = UrgentUnderstanding.model_validate(output)
    if state.stage == "REVIEW_READY" and (
        output.preview_requested or output.action == "PREVIEW"
    ):
        output = output.model_copy(
            update={
                "is_urgent_insertion": True,
                "action": "PREVIEW",
                "orders": [],
            }
        )
    # ScriptedModel unit tests intentionally exercise only the first Agent
    # output. In live intake, every extracted order gets a second strict pass,
    # including a seemingly complete order: the second pass makes labelled
    # values such as city and district explicit before deterministic preview
    # validation. This prevents one inconsistent first extraction from
    # reaching the browser as a false 422 while keeping the application itself
    # responsible for all validation and calculations.
    audit_for_active_update = (
        output.is_urgent_insertion and output.action in {"ADD_OR_UPDATE", "MODIFY"}
    )
    if model is None and (output.orders or audit_for_active_update or state.stage == "COLLECTING"):
        audit_agent = create_urgent_field_audit_agent()
        expected_order_count = max(len(output.orders), len(state.orders), 1)
        audit_result = await Runner.run(
            audit_agent,
            (
                f"Current user message:\n{message}\n\n"
                "Expected order count (data only):\n"
                f"{expected_order_count}"
            ),
            max_turns=2,
            run_config=RunConfig(
                tracing_disabled=True,
                trace_include_sensitive_data=False,
                workflow_name="urgent-field-provenance-audit",
            ),
        )
        audit = audit_result.final_output
        if not isinstance(audit, UrgentFieldAuditResult):
            audit = UrgentFieldAuditResult.model_validate(audit)
        if not output.orders and audit.orders:
            output = output.model_copy(
                update={"orders": [item.order for item in audit.orders]}
            )
        else:
            output = _apply_field_audit(output, audit)
    return output, result
