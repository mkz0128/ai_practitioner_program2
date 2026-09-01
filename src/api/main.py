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

from src.config import get_settings
from src.domain.models import Dataset, Order, Package
from src.services.errors import ValidationReport
from src.services.importer import parse_workbook
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


class UrgentInsertRequest(StrictRequest):
    base_plan_version: int = Field(ge=1)
    order: Order
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
    lock: RLock = field(default_factory=RLock)

    def add_dataset(self, record: DatasetRecord) -> None:
        with self.lock:
            self.datasets[record.dataset_id] = record

    def add_plan(self, record: PlanRecord) -> None:
        with self.lock:
            self.plans.setdefault(record.plan_id, {})[record.version] = record

    def get_dataset(self, dataset_id: str) -> DatasetRecord | None:
        with self.lock:
            return self.datasets.get(dataset_id)

    def get_plan(self, plan_id: str, version: int | None = None) -> PlanRecord | None:
        with self.lock:
            versions = self.plans.get(plan_id)
            if not versions:
                return None
            selected = max(versions) if version is None else version
            return versions.get(selected)


store = InMemoryStore()
app = FastAPI(title="AI Delivery Dispatch Agent", version="0.1.0")
settings = get_settings()
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
    # Keep the MVP agent path conservative: no natural-language claim is made
    # without structured plan evidence. The deterministic API remains the
    # source of truth even when an LLM provider is configured.
    return {
        "session_id": payload.session_id,
        "agent_run_id": f"RUN-{uuid4().hex[:12].upper()}",
        "message": "已收到請求; 請使用計畫與驗證 API 取得可追溯結果.",
        "evidence": [],
        "requires_human_confirmation": False,
        "usage": {"total_tokens": 0},
        "request_id": _request_id(request),
    }
