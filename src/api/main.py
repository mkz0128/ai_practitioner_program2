from __future__ import annotations

import hashlib
import hmac
import json
import re
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from threading import RLock
from typing import Annotated, Any, Literal
from uuid import uuid4

from agents import InputGuardrailTripwireTriggered
from fastapi import FastAPI, File, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from src.agent.runtime import run_dispatch_agent
from src.config import get_settings
from src.domain.models import Dataset, Order, Package, Priority, Vehicle, VehicleStatus, Zone
from src.providers.google_routes import GoogleRoutesProvider, GoogleRoutesProviderError
from src.providers.tdx import TDXProvider, correlate_events_to_plan
from src.repositories.sqlite import SQLiteRepository
from src.services.errors import ValidationReport
from src.services.evidence import recommendation_reason
from src.services.fingerprint import dataset_hash, matrix_hash
from src.services.importer import parse_workbook, validate_dataset
from src.services.matrix import MatrixResult, SimulatedRouteProvider
from src.services.plan_diff import compute_plan_diff
from src.services.planner import PlanResult, build_baseline, build_ortools, try_minimal_insert
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


class DemoLoginRequest(StrictRequest):
    password: str = Field(min_length=1, max_length=256)


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
class AgentSession:
    """Short-lived conversation context; secrets and workbook payloads are never retained."""

    plan_id: str | None = None
    plan_version: int | None = None
    order_id: str | None = None
    last_tool: str | None = None
    history: list[tuple[str, str]] = field(default_factory=list)


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


def _build_matrix(dataset: Dataset, *, prefer_live: bool) -> MatrixResult:
    """Resolve the matrix once and make live failures explicit when requested."""
    if not prefer_live:
        return SimulatedRouteProvider().build(dataset)
    if not settings.google_routes_server_api_key:
        return replace(SimulatedRouteProvider().build(dataset), warning="GOOGLE_KEY_MISSING")
    return GoogleRoutesProvider(settings.google_routes_server_api_key).build(
        dataset, allow_fallback=False
    )


def _dataset_matrix_coordinates(dataset: Dataset) -> list[tuple[float, float]]:
    orders = tuple(sorted(dataset.orders, key=lambda order: order.order_id))
    return [
        (SimulatedRouteProvider.depot_latitude, SimulatedRouteProvider.depot_longitude),
        *[(order.latitude, order.longitude) for order in orders],
    ]


store = InMemoryStore()
agent_sessions: dict[str, AgentSession] = {}
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


def _demo_session_token() -> str | None:
    password = settings.demo_access_password
    if not password:
        return None
    return hmac.new(
        password.encode("utf-8"), b"ai-dispatch-demo-session", hashlib.sha256
    ).hexdigest()


def _has_demo_session(request: Request) -> bool:
    expected = _demo_session_token()
    actual = request.cookies.get("dispatch_demo_session")
    return bool(expected and actual and hmac.compare_digest(actual, expected))


@app.middleware("http")
async def demo_access_middleware(request: Request, call_next: Any) -> Any:
    """Protect mutating/data APIs when a Render demo password is configured.

    Local development and deterministic tests leave DEMO_ACCESS_PASSWORD unset,
    preserving the existing API contract. Health, docs, login, and the public
    browser-key runtime configuration remain reachable before login.
    """
    protected = request.url.path.startswith("/api/v1/") and request.url.path not in {
        "/api/v1/runtime-config",
    }
    if (
        settings.demo_access_password
        and protected
        and request.method != "OPTIONS"
        and not _has_demo_session(request)
    ):
        return JSONResponse(
            status_code=401,
            content={
                "error": {
                    "code": "DEMO_AUTH_REQUIRED",
                    "message": "請先登入展示環境。",
                    "field_errors": [],
                }
            },
        )
    return await call_next(request)


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", f"REQ-{uuid4().hex[:12]}")


def _empty_agent_dataset() -> tuple[Dataset, MatrixResult]:
    dataset = Dataset(orders=(), packages=(), vehicles=(), zones=())
    return dataset, SimulatedRouteProvider().build(dataset)


def _demo_urgent_order() -> Order:
    """Structured synthetic ORD-041 fixture used by conversational preview."""
    package = Package(package_id="PKG-041-01", order_id="ORD-041", weight_kg=2.0)
    return Order(
        order_id="ORD-041",
        zone_code="Z4",
        city="臺北市",
        district="信義",
        location_label="臨時插單展示點",
        latitude=25.033,
        longitude=121.565,
        time_slot="PM",
        declared_package_count=1,
        priority=Priority.HIGH,
        note="結構化示範 fixture；不執行 Dispatch。",
        packages=(package,),
    )


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
        "requires_manual_review": report.requires_manual_review,
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
        cumulative_load = vehicle.current_load_kg if vehicle else 0.0
        previous_node_id = "DEPOT-001"
        stops: list[dict[str, Any]] = []
        for stop in route.stops:
            order = orders.get(stop.order_id)
            if order is None:
                continue
            cumulative_load = round(cumulative_load + order.total_weight_kg, 3)
            stop_payload = {
                **stop.model_dump(),
                "location_label": order.location_label,
                "reason": recommendation_reason(
                    route,
                    stop,
                    vehicle,
                    order,
                    previous_node_id,
                    cumulative_load,
                    record.matrix.provider_mode,
                    record.validation.valid,
                    record.plan.algorithm,
                )
                if vehicle
                else None,
            }
            stops.append(stop_payload)
            previous_node_id = stop.order_id
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
                "stops": stops,
            }
        )
    assigned = sum(len(route.order_ids) for route in record.plan.routes)
    assigned_order_ids = {order_id for route in record.plan.routes for order_id in route.order_ids}
    total_packages = sum(packages.values())
    total_weight = sum(order.total_weight_kg for order in dataset.orders) if dataset else 0.0
    assigned_weight = (
        sum(
            orders[order_id].total_weight_kg
            for order_id in assigned_order_ids
            if order_id in orders
        )
        if dataset
        else 0.0
    )
    current_dataset_hash = dataset_hash(dataset) if dataset else None
    warnings: list[dict[str, Any]] = []
    if record.matrix.provider_mode == "SIMULATED":
        warnings.append(
            {
                "code": record.matrix.warning or "SIMULATED_ROUTE_DATA",
                "message": "目前使用可重現的模擬距離與路線資料, 非 Google 即時資料。",
            }
        )
    elif record.matrix.warning:
        warnings.append({"code": record.matrix.warning, "message": "路線 provider 回傳警告。"})
    return {
        "plan_id": record.plan_id,
        "version": record.version,
        "dataset_id": record.dataset_id,
        "state": record.state,
        "timezone": "Asia/Taipei",
        "provider_mode": record.matrix.provider_mode,
        "matrix_hash": matrix_hash(record.matrix),
        "matrix_version": record.matrix.matrix_version,
        "algorithm": record.plan.algorithm,
        "dataset_hash": current_dataset_hash,
        "is_fully_feasible": record.plan.complete and record.validation.valid,
        "requires_human_confirmation": True,
        "summary": {
            "assigned_order_count": assigned,
            "unassigned_order_count": len(record.plan.unassigned_orders),
            "total_package_count": total_packages,
            "total_weight_kg": round(total_weight, 3),
            "assigned_weight_kg": round(assigned_weight, 3),
            "total_distance_m": record.plan.total_distance_m,
            "total_duration_s": record.plan.total_driving_time_s,
            "algorithm": record.plan.algorithm,
            "dataset_hash": current_dataset_hash,
            "matrix_hash": matrix_hash(record.matrix),
            "matrix_version": record.matrix.matrix_version,
            "unassigned_orders": list(record.plan.unassigned_orders),
            "vehicles": [
                {
                    "vehicle_id": route.vehicle_id,
                    "planned_load_kg": route.planned_load_kg,
                    "max_load_kg": route.max_load_kg,
                    "load_utilization": route.load_utilization,
                }
                for route in record.plan.routes
            ],
        },
        "vehicles": routes,
        "unassigned_orders": record.plan.unassigned_orders,
        "unassigned_reasons": record.plan.unassigned_reasons,
        "validation": record.validation.model_dump(),
        "warnings": warnings,
        "created_at": record.created_at,
    }


def _deserialize_matrix(payload: dict[str, Any]) -> MatrixResult:
    return MatrixResult(
        node_ids=tuple(payload["node_ids"]),
        distance_m=tuple(tuple(row) for row in payload["distance_m"]),
        duration_s=tuple(tuple(row) for row in payload["duration_s"]),
        provider_mode=payload.get("provider_mode", "SIMULATED"),
        matrix_version=payload.get("matrix_version", "sim-v1"),
        warning=payload.get("warning"),
    )


def _deserialize_dataset(payload: dict[str, Any]) -> Dataset:
    package_values = [Package.model_validate(package) for package in payload["packages"]]
    package_by_order: dict[str, list[Package]] = {}
    for package in package_values:
        package_by_order.setdefault(package.order_id, []).append(package)
    orders: list[Order] = []
    for raw_order in payload["orders"]:
        order_data = dict(raw_order)
        order_data.pop("total_weight_kg", None)
        order_data["priority"] = Priority(order_data.get("priority", Priority.NORMAL.value))
        order_data["packages"] = tuple(package_by_order.get(order_data["order_id"], ()))
        orders.append(Order.model_validate(order_data))
    vehicles = []
    for raw_vehicle in payload["vehicles"]:
        vehicle_data = dict(raw_vehicle)
        vehicle_data["status"] = VehicleStatus(vehicle_data["status"])
        vehicle_data["service_zone_codes"] = tuple(vehicle_data.get("service_zone_codes", ()))
        vehicles.append(Vehicle.model_validate(vehicle_data))
    zones = []
    for raw_zone in payload["zones"]:
        zone_data = dict(raw_zone)
        for field_name in (
            "covered_cities",
            "covered_districts",
            "tdx_city_codes",
            "adjacent_zone_codes",
        ):
            zone_data[field_name] = tuple(zone_data.get(field_name, ()))
        zones.append(Zone.model_validate(zone_data))
    return Dataset.model_validate(
        {
            "orders": tuple(orders),
            "packages": tuple(package_values),
            "vehicles": tuple(vehicles),
            "zones": tuple(zones),
            "source_filename": payload.get("source_filename", "workbook.xlsx"),
        }
    )


def _hydrate_store() -> None:
    """Restore non-secret metadata and immutable versions after a local restart."""
    for row in repository.load_datasets():
        try:
            dataset = _deserialize_dataset(json.loads(row["payload_json"]))
            dataset_validation = ValidationReport.model_validate(json.loads(row["validation_json"]))
            matrix = _deserialize_matrix(json.loads(row["matrix_json"]))
            store.add_dataset(
                DatasetRecord(
                    dataset_id=row["dataset_id"],
                    dataset=dataset,
                    validation=dataset_validation,
                    matrix=matrix,
                    created_at=row["created_at"],
                )
            )
        except (KeyError, TypeError, ValueError):
            continue
    for row in repository.load_plans():
        try:
            plan = PlanResult.model_validate(json.loads(row["payload_json"]))
            plan_validation = PlanValidation.model_validate(json.loads(row["validation_json"]))
            matrix = _deserialize_matrix(json.loads(row["matrix_json"]))
            store.add_plan(
                PlanRecord(
                    plan_id=row["plan_id"],
                    dataset_id=row["dataset_id"],
                    version=int(row["version"]),
                    state=row["state"],
                    plan=plan,
                    validation=plan_validation,
                    matrix=matrix,
                    created_at=row["created_at"],
                ),
                make_current=False,
            )
        except (KeyError, TypeError, ValueError):
            continue
    store.current_versions.update(repository.current_versions())


_hydrate_store()


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


@app.get("/auth/status", include_in_schema=False)
def auth_status(request: Request) -> dict[str, Any]:
    """Return only the demo gate state; never disclose the configured password."""
    return {
        "required": bool(settings.demo_access_password),
        "authenticated": _has_demo_session(request) if settings.demo_access_password else True,
    }


@app.post("/auth/login", include_in_schema=False)
def auth_login(payload: DemoLoginRequest, request: Request) -> Any:
    expected = settings.demo_access_password
    if not expected:
        return {"authenticated": True, "required": False}
    if not hmac.compare_digest(payload.password, expected):
        return _error(request, 401, "DEMO_AUTH_INVALID", "展示環境密碼不正確。")
    response = JSONResponse(content={"authenticated": True, "required": True})
    response.set_cookie(
        "dispatch_demo_session",
        _demo_session_token() or "",
        max_age=60 * 60 * 12,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="lax",
    )
    return response


@app.post("/auth/logout", include_in_schema=False)
def auth_logout() -> JSONResponse:
    response = JSONResponse(content={"authenticated": False})
    response.delete_cookie("dispatch_demo_session")
    return response


@app.get("/api/v1/runtime-config", include_in_schema=False)
def runtime_config() -> dict[str, str | None]:
    """Expose only the browser-safe runtime configuration to the SPA."""
    return {"google_maps_browser_api_key": settings.google_maps_browser_api_key}


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
            requires_manual_review=report.requires_manual_review,
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
    prefer_live = payload.route_provider_preference == "AUTO" and payload.traffic_mode == "AUTO"
    try:
        matrix = _build_matrix(dataset_record.dataset, prefer_live=prefer_live)
    except GoogleRoutesProviderError as exc:
        return _error(
            request,
            502,
            "PROVIDER_UNAVAILABLE",
            "Google Routes 即時矩陣無法取得。",
            provider="GOOGLE",
            operation="computeRouteMatrix",
            provider_error=exc.code,
            fallback_used=False,
            retryable=exc.code in {"GOOGLE_TIMEOUT", "GOOGLE_REQUEST_FAILED"},
        )
    if payload.algorithm == "BASELINE":
        plan = build_baseline(dataset_record.dataset, matrix)
    else:
        plan = build_ortools(dataset_record.dataset, matrix, settings.solver_time_limit_seconds)
    validation = validate_plan(dataset_record.dataset, plan, matrix)
    plan_id = f"PLAN-{uuid4().hex[:12].upper()}"
    record = PlanRecord(
        plan_id=plan_id,
        dataset_id=payload.dataset_id,
        version=1,
        state="PROPOSED",
        plan=plan,
        validation=validation,
        matrix=matrix,
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
    routes: list[dict[str, Any]] = []
    google_provider = GoogleRoutesProvider(settings.google_routes_server_api_key)
    for index, route in enumerate(record.plan.routes):
        stops = [
            stop.model_dump(include={"sequence", "order_id", "latitude", "longitude", "eta"})
            for stop in route.stops
        ]
        coordinates = [
            (SimulatedRouteProvider.depot_latitude, SimulatedRouteProvider.depot_longitude),
            *[(float(stop["latitude"]), float(stop["longitude"])) for stop in stops],
            (SimulatedRouteProvider.depot_latitude, SimulatedRouteProvider.depot_longitude),
        ]
        if record.matrix.provider_mode == "GOOGLE":
            try:
                encoded_polyline = google_provider.build_route_geometry(
                    coordinates, allow_fallback=False
                )
            except GoogleRoutesProviderError as exc:
                return _error(
                    request,
                    502,
                    "PROVIDER_UNAVAILABLE",
                    "Google Routes 道路幾何無法取得。",
                    provider="GOOGLE",
                    operation="computeRoutes",
                    provider_error=exc.code,
                    fallback_used=False,
                    retryable=exc.code in {"GOOGLE_TIMEOUT", "GOOGLE_REQUEST_FAILED"},
                )
            is_simplified = False
        else:
            encoded_polyline = "simulated:" + ";".join(
                f"{latitude},{longitude}" for latitude, longitude in coordinates
            )
            is_simplified = True
        routes.append(
            {
                "vehicle_id": route.vehicle_id,
                "color": ["#2563EB", "#16A34A", "#EA580C", "#9333EA"][index % 4],
                "encoded_polyline": encoded_polyline,
                "is_simplified": is_simplified,
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
    tdx_provider = TDXProvider(
        settings.tdx_client_id,
        settings.tdx_client_secret,
        api_base_url=settings.tdx_api_base_url,
        traffic_endpoint=settings.tdx_traffic_endpoint,
        timeout_seconds=settings.tdx_timeout_seconds,
    )
    traffic = tdx_provider.fetch_traffic()
    warnings: list[dict[str, str]] = []
    if record.matrix.provider_mode == "SIMULATED":
        warnings.append({"code": "SIMULATED_ROUTE_DATA", "message": "非 Google 即時道路資料。"})
    if traffic.warning:
        warnings.append(
            {
                "code": traffic.warning,
                "message": "TDX 路況資料目前不可用, 未以模擬事件替代。",
            }
        )
    return {
        "plan_id": plan_id,
        "version": record.version,
        "provider_mode": record.matrix.provider_mode,
        "matrix_hash": matrix_hash(record.matrix),
        "matrix_version": record.matrix.matrix_version,
        "depot": {
            "depot_id": "DEPOT-001",
            "latitude": SimulatedRouteProvider.depot_latitude,
            "longitude": SimulatedRouteProvider.depot_longitude,
        },
        "routes": routes,
        "traffic": {
            "mode": traffic.mode,
            "data_status": traffic.data_status,
            "events": [event.model_dump() for event in traffic.events],
            "route_risks": correlate_events_to_plan(
                dataset_record.dataset, record.plan, traffic.events
            ),
        },
        "warnings": warnings,
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
    try:
        preview_matrix = (
            GoogleRoutesProvider(settings.google_routes_server_api_key).extend_matrix(
                base_record.matrix,
                base_record.matrix.node_ids,
                _dataset_matrix_coordinates(dataset_record.dataset),
                (
                    "DEPOT-001",
                    *(
                        order.order_id
                        for order in sorted(new_dataset.orders, key=lambda item: item.order_id)
                    ),
                ),
                _dataset_matrix_coordinates(new_dataset),
                allow_fallback=False,
            )
            if base_record.matrix.provider_mode == "GOOGLE"
            else SimulatedRouteProvider().build(new_dataset)
        )
    except GoogleRoutesProviderError as exc:
        return _error(
            request,
            502,
            "PROVIDER_UNAVAILABLE",
            "Google Routes 即時矩陣無法取得, 無法產生插單預覽。",
            provider="GOOGLE",
            operation="computeRouteMatrix",
            provider_error=exc.code,
            fallback_used=False,
            retryable=exc.code in {"GOOGLE_TIMEOUT", "GOOGLE_REQUEST_FAILED"},
        )
    preview_plan = try_minimal_insert(base_record.plan, new_dataset, preview_matrix, new_order)
    mode = "MINIMAL_CHANGE"
    full_replan_reason: str | None = None
    if preview_plan is None:
        mode = "FULL_REPLAN"
        full_replan_reason = "NO_LEGAL_SINGLE_ROUTE_INSERTION"
        preview_plan = (
            build_ortools(new_dataset, preview_matrix, settings.solver_time_limit_seconds)
            if base_record.plan.algorithm == "ORTOOLS"
            else build_baseline(new_dataset, preview_matrix)
        )
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
    repository.save_plan(preview_record, make_current=False)
    diff = compute_plan_diff(base_record.plan, preview_plan)
    preview_warnings: list[dict[str, str]] = []
    if preview_matrix.provider_mode == "SIMULATED":
        preview_warnings.append(
            {
                "code": preview_matrix.warning or "SIMULATED_ROUTE_DATA",
                "message": "目前使用可重現的模擬距離與路線資料, 非 Google 即時資料。",
            }
        )
    elif preview_matrix.warning:
        preview_warnings.append(
            {"code": preview_matrix.warning, "message": "路線 provider 回傳警告。"}
        )
    affected_vehicles = {
        change["vehicle_id"]
        for change in diff["vehicle_load_changes"]
        if change["delta_load_kg"] != 0
    }
    affected_vehicles.update(
        change["from_vehicle_id"]
        for change in diff["sequence_changes"]
        if change["from_vehicle_id"] is not None
    )
    affected_vehicles.update(
        change["to_vehicle_id"]
        for change in diff["sequence_changes"]
        if change["to_vehicle_id"] is not None
    )
    return {
        "plan_id": plan_id,
        "base_version": base_record.version,
        "preview_version": preview_version,
        "feasible": True,
        "requires_human_confirmation": True,
        "mode": mode,
        "full_replan_reason": full_replan_reason,
        "affected_vehicle_count": len(affected_vehicles),
        "moved_order_count": len(diff["reassigned_orders"]),
        "before": _plan_payload(base_record)["summary"],
        "after": _plan_payload(preview_record)["summary"],
        "comparison": {
            "base_algorithm": base_record.plan.algorithm,
            "preview_algorithm": preview_plan.algorithm,
            "base_dataset_hash": dataset_hash(dataset_record.dataset),
            "preview_dataset_hash": dataset_hash(new_dataset),
        },
        "diff": {"inserted_order_id": new_order.order_id, **diff},
        "warnings": preview_warnings,
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
    # A confirmed version becomes the current read/continuation pointer. Preview
    # versions remain immutable and never become current before this checkpoint.
    store.current_versions[plan_id] = record.version
    repository.set_current_version(plan_id, record.version)
    repository.update_plan_state(plan_id, record.version, record.state)
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
    tdx_status = TDXProvider(
        settings.tdx_client_id,
        settings.tdx_client_secret,
        api_base_url=settings.tdx_api_base_url,
        traffic_endpoint=settings.tdx_traffic_endpoint,
        timeout_seconds=settings.tdx_timeout_seconds,
    ).status()
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
            {"name": "tdx", **tdx_status.model_dump()},
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
async def agent_chat(payload: ChatRequest, request: Request) -> Any:
    if not settings.openai_api_key:
        return _error(
            request, 503, "AGENT_UNAVAILABLE", "OpenAI 憑證未設定; 確定性 REST 功能仍可使用."
        )
    session = agent_sessions.setdefault(payload.session_id, AgentSession())
    context_plan_id = payload.context.get("plan_id") or session.plan_id
    context_order_id = payload.context.get("order_id")
    record: PlanRecord | None = None
    dataset_record: DatasetRecord | None = None
    if isinstance(context_plan_id, str):
        plan_version = payload.context.get("plan_version")
        if not isinstance(plan_version, int):
            plan_version = None
        record = store.get_plan(context_plan_id, plan_version)
        if record is None:
            return _error(request, 404, "PLAN_NOT_FOUND", "找不到說明所需的規劃版本。")
        dataset_record = store.get_dataset(record.dataset_id)
        if dataset_record is None:
            return _error(request, 404, "DATASET_NOT_FOUND", "找不到說明所需的資料集。")
    if record is None or dataset_record is None:
        dataset, matrix = _empty_agent_dataset()
    else:
        dataset, matrix = dataset_record.dataset, record.matrix

    order_match = re.search(r"\b[A-Z]{2,}(?:-[A-Z0-9]+)+\b", payload.message.upper())
    if order_match:
        context_order_id = order_match.group(0)
        session.order_id = context_order_id
    if (
        context_order_id is None
        and session.order_id
        and session.last_tool == "explain_assignment"
        and any(marker in payload.message for marker in ("為什麼", "原因", "理由"))
    ):
        context_order_id = session.order_id
    preview_request = any(
        marker in payload.message for marker in ("預覽", "插單", "受影響", "差異")
    )
    if preview_request and (context_order_id == "ORD-041" or session.order_id == "ORD-041"):
        context_order_id = None
    highest_load_followup = (
        context_order_id is None
        and session.last_tool == "highest_load_vehicle"
        and any(marker in payload.message for marker in ("為什麼", "原因", "理由"))
    )
    if record is not None:
        session.plan_id = record.plan_id
        session.plan_version = record.version

    # Context identifiers are application-controlled data. Include only the
    # selected order identifier as a hint so the model must still invoke the
    # allowlisted deterministic tool instead of receiving precomputed facts.
    agent_message = payload.message
    history_text = "\n".join(f"{role}: {content}" for role, content in session.history[-6:])
    if history_text:
        agent_message = (
            "Conversation history (use only as context):\n"
            f"{history_text}\n\nCurrent user request:\n{agent_message}"
        )
    if preview_request and session.order_id == "ORD-041" and record is not None:
        agent_message = (
            f"{agent_message}\n\nApplication context: call preview_urgent_insert exactly once "
            "with order_id=ORD-041. Use only its deterministic preview evidence and do not ask "
            "for additional order fields."
        )
    elif preview_request and isinstance(context_order_id, str) and record is not None:
        agent_message = (
            f"{agent_message}\n\nApplication context: this is a new structured "
            "urgent-order request. "
            "Extract only the order fields explicitly supplied by the user and call "
            "preview_structured_urgent_insert. If any required order or package field is missing, "
            "ask for only those missing fields. Never calculate weight, route, or assignment."
        )
    elif isinstance(context_order_id, str):
        agent_message = (
            f"{payload.message}\n\nApplication context: call the explain_assignment tool "
            f"exactly once with order_id={context_order_id} before answering. "
            "Use only that tool's evidence; do not call explain_unassigned or calculate values."
        )
    elif highest_load_followup:
        agent_message = (
            f"{payload.message}\n\nApplication context: this is a follow-up to the "
            "highest-load vehicle result. Call highest_load_vehicle exactly once and "
            "explain only values in its deterministic evidence."
        )
    elif record is not None:
        agent_message = (
            f"{agent_message}\n\nApplication context: current validated plan uses "
            f"algorithm={record.plan.algorithm} and provider_mode={record.matrix.provider_mode}. "
            "For a new planning request, call plan_dispatch with ORTOOLS unless the user "
            "explicitly asks for BASELINE. Use only tool evidence."
        )
    else:
        no_data_topic = "DATA_REQUIRED" if preview_request else "CAPABILITIES"
        agent_message = (
            f"{agent_message}\n\nApplication context: no validated dataset is loaded. "
            f"Call assistant_help with topic={no_data_topic}. "
            "Do not invent orders, metrics, or a plan."
        )
    pending_order = (
        _demo_urgent_order()
        if (preview_request and session.order_id == "ORD-041" and record is not None)
        else None
    )
    try:
        # Agent calls are evidence-only and deterministic tools have no
        # external side effects, so one bounded retry is safe for transient
        # provider/model transport failures.  This avoids turning a single
        # intermittent 502 into a broken conversational turn while keeping
        # retry count finite and observable.
        agent_result: tuple[str, Any, Any] | None = None
        last_agent_error: Exception | None = None
        for _attempt in range(2):
            try:
                agent_result = await run_dispatch_agent(
                    agent_message,
                    dataset,
                    matrix,
                    pending_order=pending_order,
                    plan=record.plan if record else None,
                    request_id=_request_id(request),
                    dataset_id=record.dataset_id if record else None,
                    plan_id=record.plan_id if record else None,
                    plan_version=record.version if record else None,
                )
                break
            except InputGuardrailTripwireTriggered:
                raise
            except Exception as exc:
                last_agent_error = exc
        if agent_result is None:
            assert last_agent_error is not None
            raise last_agent_error
        final_output, context, result = agent_result
    except InputGuardrailTripwireTriggered:
        return _error(
            request,
            400,
            "PROMPT_INJECTION_BLOCKED",
            "訊息包含不可執行的規則繞過要求。",
        )
    except Exception:
        # Do not serialize provider requests, headers, keys, or SDK internals.
        return _error(
            request,
            502,
            "AGENT_RUN_FAILED",
            "OpenAI Agent 執行失敗, 請查看 provider status 與 request_id。",
            provider="OPENAI",
            fallback_used=False,
        )

    evidence = []
    for item in context.evidence:
        evidence.append(
            {
                "tool": item.get("tool", "unknown"),
                "data": {key: value for key, value in item.items() if key != "tool"},
            }
        )
    requires_confirmation = bool(record and record.state in {"DRAFT", "VALIDATED", "PROPOSED"})
    usage = {
        "total_tokens": context.budget.total_tokens,
        "tool_calls": context.budget.tool_calls,
        "agent_run_id": context.agent_run_id,
    }
    session.history.extend([("user", payload.message), ("assistant", final_output)])
    session.last_tool = context.evidence[-1].get("tool") if context.evidence else None
    if len(session.history) > 12:
        session.history = session.history[-12:]
    return {
        "session_id": payload.session_id,
        "agent_run_id": context.agent_run_id,
        "message": final_output,
        "evidence": evidence,
        "requires_human_confirmation": requires_confirmation,
        "usage": usage,
        "provider_mode": record.matrix.provider_mode if record else "NONE",
        "plan_id": record.plan_id if record else None,
        "plan_version": record.version if record else None,
        "runner_result_type": type(result).__name__,
        "request_id": _request_id(request),
    }


# In the Render image the Vite build is copied to /app/frontend/dist. Keeping
# the same path convention locally makes the production container and local
# smoke tests exercise the same SPA fallback behaviour.
_frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _frontend_dist.is_dir():
    app.mount(
        "/assets",
        StaticFiles(directory=_frontend_dist / "assets"),
        name="frontend-assets",
    )

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str) -> Any:
        requested = (_frontend_dist / full_path).resolve()
        try:
            requested.relative_to(_frontend_dist.resolve())
        except ValueError:
            return JSONResponse(status_code=404, content={"detail": "Not found"})
        if requested.is_file():
            return FileResponse(requested)
        index_file = _frontend_dist / "index.html"
        if index_file.is_file():
            return FileResponse(index_file)
        return JSONResponse(status_code=404, content={"detail": "Frontend build unavailable"})
