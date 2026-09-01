from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from io import BytesIO
from threading import RLock
from typing import Annotated, Any, Literal
from uuid import uuid4

from fastapi import FastAPI, File, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from src.agent.tools import explain_assignment
from src.config import get_settings
from src.domain.models import Dataset, Order, Package, Priority
from src.repositories.sqlite import SQLiteRepository
from src.services.errors import ValidationReport
from src.services.importer import parse_workbook, validate_dataset
from src.services.matrix import MatrixResult, SimulatedRouteProvider
from src.services.planner import PlanResult, build_baseline, build_ortools
from src.services.validator import PlanValidation, validate_plan


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreatePlanRequest(StrictRequest):
    dataset_id: str
    route_provider_preference: Literal["AUTO", "SIMULATED"] = "AUTO"
    traffic_mode: Literal["AUTO", "SIMULATED"] = "AUTO"
    simulation_seed: int = 20260901
    algorithm: Literal["BASELINE", "ORTOOLS"] = "ORTOOLS"


class ConfirmRequest(StrictRequest):
    version: int = Field(ge=1)
    confirmation: Literal["CONFIRM_PLAN"]
    dispatcher_reference: str = Field(min_length=1, max_length=120)


class DispatchRequest(StrictRequest):
    version: int = Field(ge=1)
    confirmation: Literal["MARK_DISPATCHED"]


class ChatRequest(StrictRequest):
    session_id: str = Field(min_length=1, max_length=120)
    message: str = Field(min_length=1, max_length=4000)
    context: dict[str, Any] = Field(default_factory=dict)


class UrgentOrderRequest(StrictRequest):
    order_id: str
    zone_code: str
    city: str
    district: str
    location_label: str
    latitude: float
    longitude: float
    time_slot: Literal["AM", "PM"]
    declared_package_count: int = Field(ge=1, le=3)
    priority: Priority = Priority.NORMAL
    note: str | None = None


class UrgentInsertRequest(StrictRequest):
    base_plan_version: int = Field(ge=1)
    order: UrgentOrderRequest
    packages: list[Package] = Field(min_length=1, max_length=3)


@dataclass
class DatasetRecord:
    dataset_id: str
    dataset: Dataset
    validation: ValidationReport
    matrix: MatrixResult
    created_at: str


@dataclass
class PlanRecord:
    plan_id: str
    dataset_id: str
    version: int
    state: str
    plan: PlanResult
    validation: PlanValidation
    matrix: MatrixResult
    created_at: str


@dataclass
class InMemoryStore:
    datasets: dict[str, DatasetRecord] = field(default_factory=dict)
    plans: dict[str, dict[int, PlanRecord]] = field(default_factory=dict)
    current_versions: dict[str, int] = field(default_factory=dict)
    lock: RLock = field(default_factory=RLock)

    def add_dataset(self, record: DatasetRecord) -> None:
        with self.lock:
            self.datasets[record.dataset_id] = record

    def add_plan(self, record: PlanRecord, make_current: bool = True) -> None:
        with self.lock:
            self.plans.setdefault(record.plan_id, {})[record.version] = record
            if make_current:
                self.current_versions[record.plan_id] = record.version

    def get_dataset(self, dataset_id: str) -> DatasetRecord | None:
        with self.lock:
            return self.datasets.get(dataset_id)

    def get_plan(self, plan_id: str, version: int | None = None) -> PlanRecord | None:
        with self.lock:
            versions = self.plans.get(plan_id)
            if not versions:
                return None
            selected = (
                self.current_versions.get(plan_id, max(versions)) if version is None else version
            )
            return versions.get(selected)


store = InMemoryStore()
app = FastAPI(title="AI Delivery Dispatch Agent", version="0.1.0")
settings = get_settings()
repository = SQLiteRepository(settings.database_url)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", f"REQ-{uuid4().hex[:12]}")


def _error(
    request: Request, status_code: int, code: str, message: str, **details: Any
) -> JSONResponse:
    request_id = _request_id(request)
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
                "field_errors": details.pop("field_errors", []),
                "request_id": request_id,
                "details": details,
            },
            "request_id": request_id,
        },
        headers={"X-Request-ID": request_id},
    )


def _validation_payload(report: ValidationReport) -> dict[str, Any]:
    return {
        "is_valid": report.is_valid,
        "error_count": len(report.errors),
        "warning_count": len(report.warnings),
        "errors": [error.model_dump() for error in report.errors],
        "warnings": [warning.model_dump() for warning in report.warnings],
    }


def _plan_payload(record: PlanRecord) -> dict[str, Any]:
    dataset_record = store.get_dataset(record.dataset_id)
    dataset = dataset_record.dataset if dataset_record else None
    orders = {order.order_id: order for order in dataset.orders} if dataset else {}
    packages = {order_id: 0 for order_id in orders}
    for package in dataset.packages if dataset else ():
        packages[package.order_id] = packages.get(package.order_id, 0) + 1
    routes: list[dict[str, Any]] = []
    for route in record.plan.routes:
        vehicle = (
            next((item for item in dataset.vehicles if item.vehicle_id == route.vehicle_id), None)
            if dataset
            else None
        )
        routes.append(
            {
                "vehicle_id": route.vehicle_id,
                "vehicle_name": vehicle.vehicle_name if vehicle else route.vehicle_id,
                "service_zone_codes": list(vehicle.service_zone_codes) if vehicle else [],
                "order_count": len(route.order_ids),
                "package_count": sum(packages.get(order_id, 0) for order_id in route.order_ids),
                "planned_load_kg": route.planned_load_kg,
                "max_load_kg": route.max_load_kg,
                "load_utilization": route.load_utilization,
                "total_distance_m": route.total_distance_m,
                "total_duration_s": route.total_duration_s,
                "route_provider_mode": record.matrix.provider_mode,
                "stops": [
                    {
                        **stop.model_dump(),
                        "location_label": orders[stop.order_id].location_label
                        if stop.order_id in orders
                        else stop.order_id,
                    }
                    for stop in route.stops
                ],
            }
        )
    assigned = sum(len(route.order_ids) for route in record.plan.routes)
    total_packages = sum(packages.values())
    total_weight = sum(order.total_weight_kg for order in dataset.orders) if dataset else 0.0
    return {
        "plan_id": record.plan_id,
        "version": record.version,
        "dataset_id": record.dataset_id,
        "state": record.state,
        "timezone": "Asia/Taipei",
        "provider_mode": record.matrix.provider_mode,
        "algorithm": record.plan.algorithm,
        "is_fully_feasible": record.plan.complete and record.validation.valid,
        "requires_human_confirmation": True,
        "summary": {
            "assigned_order_count": assigned,
            "unassigned_order_count": len(record.plan.unassigned_orders),
            "total_package_count": total_packages,
            "total_weight_kg": round(total_weight, 3),
            "total_distance_m": record.plan.total_distance_m,
            "total_duration_s": record.plan.total_driving_time_s,
        },
        "vehicles": routes,
        "unassigned_orders": record.plan.unassigned_orders,
        "unassigned_reasons": record.plan.unassigned_reasons,
        "validation": record.validation.model_dump(),
        "warnings": [
            {
                "code": "SIMULATED_ROUTE_DATA",
                "message": "目前使用可重現的模擬距離與路線資料, 非 Google 即時資料.",
            }
        ],
        "created_at": record.created_at,
    }


@app.middleware("http")
async def request_id_middleware(request: Request, call_next: Any) -> Any:
    request_id = request.headers.get("X-Request-ID") or f"REQ-{uuid4().hex[:12]}"
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


@app.get("/health")
def health(request: Request) -> dict[str, str]:
    return {
        "status": "ok",
        "service": "ai-delivery-dispatch-agent",
        "request_id": _request_id(request),
    }


@app.get("/ready")
def ready(request: Request) -> dict[str, Any]:
    credential_status = settings.credential_status()
    return {
        "status": "ready",
        "components": {
            "database": "ready",
            "optimizer": "ready",
            "openai": "ready"
            if credential_status["OPENAI_API_KEY"] == "CONFIGURED"
            else "degraded",
            "google_routes": "enabled"
            if credential_status["GOOGLE_ROUTES_SERVER_API_KEY"] == "CONFIGURED"
            else "disabled",
            "tdx": "enabled"
            if credential_status["TDX_CLIENT_ID"] == "CONFIGURED"
            and credential_status["TDX_CLIENT_SECRET"] == "CONFIGURED"
            else "disabled",
        },
        "request_id": _request_id(request),
    }


@app.post("/api/v1/datasets/import-excel", status_code=201)
async def import_excel(request: Request, file: Annotated[UploadFile, File(...)]) -> Any:
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        return _error(request, 400, "INVALID_FILE_TYPE", "只接受 .xlsx 檔案。")
    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        return _error(request, 413, "FILE_TOO_LARGE", "工作簿超過大小限制。")
    dataset, report = parse_workbook(BytesIO(content), source_filename=file.filename)
    if dataset is None or not report.is_valid:
        return _error(
            request,
            422,
            "DATASET_VALIDATION_FAILED",
            "工作簿驗證失敗。",
            field_errors=[error.model_dump() for error in report.errors],
        )
    dataset_id = f"DS-{uuid4().hex[:12].upper()}"
    record = DatasetRecord(
        dataset_id=dataset_id,
        dataset=dataset,
        validation=report,
        matrix=SimulatedRouteProvider().build(dataset),
        created_at=datetime.now(UTC).isoformat(),
    )
    store.add_dataset(record)
    repository.save_dataset(dataset_id, dataset, report, record.matrix, record.created_at)
    return {
        "dataset_id": dataset_id,
        "status": "VALIDATED",
        "counts": {
            "orders": len(dataset.orders),
            "packages": len(dataset.packages),
            "vehicles": len(dataset.vehicles),
            "zones": len(dataset.zones),
        },
        "total_weight_kg": round(sum(order.total_weight_kg for order in dataset.orders), 3),
        "validation": _validation_payload(report),
        "request_id": _request_id(request),
    }


@app.get("/api/v1/datasets/{dataset_id}")
def get_dataset(dataset_id: str, request: Request) -> Any:
    record = store.get_dataset(dataset_id)
    if record is None:
        return _error(request, 404, "DATASET_NOT_FOUND", "找不到資料集。")
    dataset = record.dataset
    return {
        "dataset_id": dataset_id,
        "source_filename": dataset.source_filename,
        "status": "VALIDATED" if record.validation.is_valid else "INVALID",
        "counts": {
            "orders": len(dataset.orders),
            "packages": len(dataset.packages),
            "vehicles": len(dataset.vehicles),
            "zones": len(dataset.zones),
        },
        "total_weight_kg": round(sum(order.total_weight_kg for order in dataset.orders), 3),
        "created_at": record.created_at,
        "request_id": _request_id(request),
    }


@app.get("/api/v1/datasets/{dataset_id}/validation")
def get_dataset_validation(dataset_id: str, request: Request) -> Any:
    record = store.get_dataset(dataset_id)
    if record is None:
        return _error(request, 404, "DATASET_NOT_FOUND", "找不到資料集。")
    return {
        "dataset_id": dataset_id,
        "validation": _validation_payload(record.validation),
        "request_id": _request_id(request),
    }


@app.post("/api/v1/plans", status_code=201)
def create_plan(payload: CreatePlanRequest, request: Request) -> Any:
    dataset_record = store.get_dataset(payload.dataset_id)
    if dataset_record is None:
        return _error(request, 404, "DATASET_NOT_FOUND", "找不到資料集。")
    if payload.algorithm == "BASELINE":
        plan = build_baseline(dataset_record.dataset, dataset_record.matrix)
    else:
        plan = build_ortools(
            dataset_record.dataset, dataset_record.matrix, settings.solver_time_limit_seconds
        )
    validation = validate_plan(dataset_record.dataset, plan, dataset_record.matrix)
    plan_id = f"PLAN-{uuid4().hex[:12].upper()}"
    record = PlanRecord(
        plan_id=plan_id,
        dataset_id=payload.dataset_id,
        version=1,
        state="PROPOSED",
        plan=plan,
        validation=validation,
        matrix=dataset_record.matrix,
        created_at=datetime.now(UTC).isoformat(),
    )
    store.add_plan(record)
    repository.save_plan(record)
    if not validation.valid:
        return _error(
            request, 409, "PLAN_NOT_CONFIRMABLE", "規劃結果未通過獨立驗證。", plan_id=plan_id
        )
    return _plan_payload(record) | {"request_id": _request_id(request)}


@app.get("/api/v1/plans/{plan_id}")
def get_plan(plan_id: str, request: Request, version: int | None = None) -> Any:
    record = store.get_plan(plan_id, version)
    if record is None:
        return _error(request, 404, "PLAN_NOT_FOUND", "找不到規劃版本。")
    return _plan_payload(record) | {"request_id": _request_id(request)}


@app.get("/api/v1/plans/{plan_id}/map-data")
def get_map_data(plan_id: str, request: Request, version: int | None = None) -> Any:
    record = store.get_plan(plan_id, version)
    if record is None:
        return _error(request, 404, "PLAN_NOT_FOUND", "找不到規劃版本。")
    dataset_record = store.get_dataset(record.dataset_id)
    assert dataset_record is not None
    routes = []
    for index, route in enumerate(record.plan.routes):
        stops = [
            stop.model_dump(include={"sequence", "order_id", "latitude", "longitude", "eta"})
            for stop in route.stops
        ]
        routes.append(
            {
                "vehicle_id": route.vehicle_id,
                "color": ["#2563EB", "#16A34A", "#EA580C", "#9333EA"][index % 4],
                "encoded_polyline": "simulated:"
                + ";".join(f"{stop['latitude']},{stop['longitude']}" for stop in stops),
                "is_simplified": True,
                "stops": stops,
                "legs": [
                    {
                        "from_sequence": stop.sequence - 1,
                        "to_sequence": stop.sequence,
                        "distance_m": stop.leg_distance_m,
                        "duration_s": stop.leg_duration_s,
                    }
                    for stop in route.stops
                ],
            }
        )
    return {
        "plan_id": plan_id,
        "version": record.version,
        "provider_mode": record.matrix.provider_mode,
        "depot": {
            "depot_id": "DEPOT-001",
            "latitude": SimulatedRouteProvider.depot_latitude,
            "longitude": SimulatedRouteProvider.depot_longitude,
        },
        "routes": routes,
        "warnings": [{"code": "SIMULATED_ROUTE_DATA", "message": "非 Google 即時資料。"}],
        "request_id": _request_id(request),
    }


@app.post("/api/v1/plans/{plan_id}/urgent-insert/preview")
def urgent_insert_preview(plan_id: str, payload: UrgentInsertRequest, request: Request) -> Any:
    base_record = store.get_plan(plan_id, payload.base_plan_version)
    if base_record is None:
        return _error(request, 404, "PLAN_NOT_FOUND", "找不到基準規劃版本。")
    if base_record.state == "DISPATCHED":
        return _error(request, 409, "PLAN_ALREADY_DISPATCHED", "已出發的規劃不可插單。")
    if payload.order.declared_package_count != len(payload.packages):
        return _error(request, 422, "URGENT_ORDER_INVALID", "宣告件數與插單 package 數量不一致。")
    if any(package.order_id != payload.order.order_id for package in payload.packages):
        return _error(request, 422, "URGENT_ORDER_INVALID", "插單 package 必須指向同一張訂單。")
    dataset_record = store.get_dataset(base_record.dataset_id)
    if dataset_record is None:
        return _error(request, 404, "DATASET_NOT_FOUND", "找不到基準資料集。")
    if payload.order.order_id in {order.order_id for order in dataset_record.dataset.orders}:
        return _error(request, 422, "URGENT_ORDER_INVALID", "插單訂單 ID 已存在。")
    new_order = Order.model_validate(
        payload.order.model_dump() | {"packages": tuple(payload.packages)}
    )
    new_dataset = dataset_record.dataset.model_copy(
        update={
            "orders": (*dataset_record.dataset.orders, new_order),
            "packages": (*dataset_record.dataset.packages, *payload.packages),
        }
    )
    validation_report = validate_dataset(new_dataset)
    if not validation_report.is_valid:
        return _error(
            request,
            422,
            "URGENT_ORDER_INVALID",
            "插單資料未通過驗證。",
            field_errors=[error.model_dump() for error in validation_report.errors],
        )
    preview_dataset_id = f"DS-{uuid4().hex[:12].upper()}"
    preview_matrix = SimulatedRouteProvider().build(new_dataset)
    preview_plan = build_ortools(new_dataset, preview_matrix, settings.solver_time_limit_seconds)
    preview_validation = validate_plan(new_dataset, preview_plan, preview_matrix)
    if not preview_validation.valid:
        return _error(
            request,
            409,
            "URGENT_INSERT_UNASSIGNABLE",
            "插單預覽未通過獨立驗證。",
            plan_id=plan_id,
        )
    preview_version = max(store.plans.get(plan_id, {0: None})) + 1
    preview_record = PlanRecord(
        plan_id=plan_id,
        dataset_id=preview_dataset_id,
        version=preview_version,
        state="PROPOSED",
        plan=preview_plan,
        validation=preview_validation,
        matrix=preview_matrix,
        created_at=datetime.now(UTC).isoformat(),
    )
    preview_dataset_record = DatasetRecord(
        dataset_id=preview_dataset_id,
        dataset=new_dataset,
        validation=validation_report,
        matrix=preview_matrix,
        created_at=preview_record.created_at,
    )
    store.add_dataset(preview_dataset_record)
    store.add_plan(preview_record, make_current=False)
    repository.save_dataset(
        preview_dataset_id,
        new_dataset,
        validation_report,
        preview_matrix,
        preview_record.created_at,
    )
    repository.save_plan(preview_record)
    before_vehicle = {
        order_id: route.vehicle_id
        for route in base_record.plan.routes
        for order_id in route.order_ids
    }
    after_vehicle = {
        order_id: route.vehicle_id for route in preview_plan.routes for order_id in route.order_ids
    }
    reassigned = [
        {
            "order_id": order_id,
            "from_vehicle_id": before_vehicle[order_id],
            "to_vehicle_id": after_vehicle[order_id],
        }
        for order_id in sorted(set(before_vehicle) & set(after_vehicle))
        if before_vehicle[order_id] != after_vehicle[order_id]
    ]
    return {
        "plan_id": plan_id,
        "base_version": base_record.version,
        "preview_version": preview_version,
        "feasible": True,
        "requires_human_confirmation": True,
        "before": _plan_payload(base_record)["summary"],
        "after": _plan_payload(preview_record)["summary"],
        "diff": {
            "inserted_order_id": new_order.order_id,
            "reassigned_orders": reassigned,
            "sequence_changes": [],
            "vehicle_load_changes": [],
            "total_distance_delta_m": preview_plan.total_distance_m
            - base_record.plan.total_distance_m,
            "total_duration_delta_s": preview_plan.total_driving_time_s
            - base_record.plan.total_driving_time_s,
        },
        "warnings": [{"code": "SIMULATED_ROUTE_DATA", "message": "非 Google 即時資料."}],
        "request_id": _request_id(request),
    }


@app.post("/api/v1/plans/{plan_id}/confirm")
def confirm_plan(plan_id: str, payload: ConfirmRequest, request: Request) -> Any:
    record = store.get_plan(plan_id, payload.version)
    if record is None:
        return _error(request, 404, "PLAN_NOT_FOUND", "找不到規劃版本。")
    if record.state == "DISPATCHED":
        return _error(request, 409, "PLAN_ALREADY_DISPATCHED", "已出發的規劃不可再次確認。")
    if record.state != "PROPOSED" or not record.validation.valid:
        return _error(request, 409, "PLAN_NOT_CONFIRMABLE", "規劃尚未通過驗證或狀態不允許確認。")
    record.state = "CONFIRMED"
    repository.append_audit(
        f"AUD-{uuid4().hex[:12].upper()}",
        "PLAN_CONFIRMED",
        datetime.now(UTC).isoformat(),
        plan_id,
        record.version,
    )
    return _plan_payload(record) | {
        "audit_event_id": f"AUD-{uuid4().hex[:12].upper()}",
        "request_id": _request_id(request),
    }


@app.post("/api/v1/plans/{plan_id}/dispatch")
def dispatch_plan(plan_id: str, payload: DispatchRequest, request: Request) -> Any:
    record = store.get_plan(plan_id, payload.version)
    if record is None:
        return _error(request, 404, "PLAN_NOT_FOUND", "找不到規劃版本。")
    if record.state != "CONFIRMED":
        return _error(request, 409, "PLAN_NOT_CONFIRMABLE", "只有已確認版本可以標記出發。")
    record.state = "DISPATCHED"
    repository.append_audit(
        f"AUD-{uuid4().hex[:12].upper()}",
        "PLAN_DISPATCHED",
        datetime.now(UTC).isoformat(),
        plan_id,
        record.version,
    )
    return _plan_payload(record) | {
        "audit_event_id": f"AUD-{uuid4().hex[:12].upper()}",
        "request_id": _request_id(request),
    }


@app.get("/api/v1/providers/status")
def provider_status(request: Request) -> dict[str, Any]:
    status_map = settings.credential_status()
    return {
        "providers": [
            {"name": "simulated_routes", "enabled": True, "status": "healthy", "mode": "SIMULATED"},
            {
                "name": "google_routes",
                "enabled": status_map["GOOGLE_ROUTES_SERVER_API_KEY"] == "CONFIGURED",
                "status": "healthy"
                if status_map["GOOGLE_ROUTES_SERVER_API_KEY"] == "CONFIGURED"
                else "disabled",
                "mode": "GOOGLE"
                if status_map["GOOGLE_ROUTES_SERVER_API_KEY"] == "CONFIGURED"
                else "UNAVAILABLE",
            },
            {"name": "tdx", "enabled": False, "status": "disabled", "mode": "UNAVAILABLE"},
            {
                "name": "openai",
                "enabled": status_map["OPENAI_API_KEY"] == "CONFIGURED",
                "status": "healthy" if status_map["OPENAI_API_KEY"] == "CONFIGURED" else "degraded",
                "mode": "OPENAI" if status_map["OPENAI_API_KEY"] == "CONFIGURED" else "UNAVAILABLE",
            },
        ],
        "request_id": _request_id(request),
    }


@app.post("/api/v1/agent/chat")
def agent_chat(payload: ChatRequest, request: Request) -> Any:
    if not settings.openai_api_key:
        return _error(
            request, 503, "AGENT_UNAVAILABLE", "OpenAI 憑證未設定; 確定性 REST 功能仍可使用."
        )
    context_plan_id = payload.context.get("plan_id")
    context_order_id = payload.context.get("order_id")
    if isinstance(context_plan_id, str) and isinstance(context_order_id, str):
        record = store.get_plan(context_plan_id, payload.context.get("plan_version"))
        if record is None:
            return _error(request, 404, "PLAN_NOT_FOUND", "找不到說明所需的規劃版本。")
        dataset_record = store.get_dataset(record.dataset_id)
        if dataset_record is None:
            return _error(request, 404, "DATASET_NOT_FOUND", "找不到說明所需的資料集。")
        try:
            evidence = explain_assignment(
                dataset_record.dataset,
                record.plan,
                context_order_id,
                record.matrix.provider_mode,
            )
        except ValueError:
            return _error(request, 404, "ORDER_NOT_FOUND", "找不到說明所需的訂單。")
        summary = (
            f"{context_order_id} 的結構化分配證據已產生。"
            if evidence.assigned
            else f"{context_order_id} 尚未安排, 原因為 {evidence.reason}."
        )
        return {
            "session_id": payload.session_id,
            "agent_run_id": f"RUN-{uuid4().hex[:12].upper()}",
            "message": summary,
            "evidence": [{"tool": "explain_assignment", "data": evidence.model_dump()}],
            "requires_human_confirmation": False,
            "usage": {"total_tokens": 0},
            "request_id": _request_id(request),
        }
    return {
        "session_id": payload.session_id,
        "agent_run_id": f"RUN-{uuid4().hex[:12].upper()}",
        "message": "已收到請求; 請使用計畫與驗證 API 取得可追溯結果.",
        "evidence": [],
        "requires_human_confirmation": False,
        "usage": {"total_tokens": 0},
        "request_id": _request_id(request),
    }
