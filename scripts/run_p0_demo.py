"""Run the deterministic P0 competition demonstration without dispatch/deploy."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.api.main import app, store  # noqa: E402
from src.domain.models import Dataset  # noqa: E402
from src.services.evidence import recommendation_reason  # noqa: E402
from src.services.importer import parse_workbook  # noqa: E402
from src.services.matrix import SimulatedRouteProvider  # noqa: E402
from src.services.planner import PlanResult, build_baseline  # noqa: E402
from src.services.validator import PlanValidation, validate_plan  # noqa: E402

WORKBOOK = ROOT / "data" / "samples" / "demo-delivery-40-orders.xlsx"
client = TestClient(app)


def _print_plan(label: str, dataset: Dataset, plan: PlanResult, validation: PlanValidation) -> None:
    orders = {order.order_id: order for order in dataset.orders}
    vehicles = {vehicle.vehicle_id: vehicle for vehicle in dataset.vehicles}
    print(f"\n=== {label} ({plan.algorithm}) ===")
    print(
        f"Validator: {'通過' if validation.valid else '失敗'}; "
        f"未安排 {len(plan.unassigned_orders)} 單"
    )
    for route in plan.routes:
        vehicle = vehicles[route.vehicle_id]
        print(
            f"{route.vehicle_id}: {len(route.order_ids)} 單, "
            f"{route.planned_load_kg:g}/{route.max_load_kg:g} kg, "
            f"使用率 {route.load_utilization:.1%}"
        )
        cumulative = vehicle.current_load_kg
        previous = "DEPOT-001"
        for stop in route.stops:
            order = orders[stop.order_id]
            cumulative = round(cumulative + order.total_weight_kg, 3)
            reason = recommendation_reason(
                route,
                stop,
                vehicle,
                order,
                previous,
                cumulative,
                "SIMULATED",
                validation.valid,
                plan.algorithm,
            )
            print(
                f"  {stop.sequence:02d}. {stop.order_id}, {order.total_weight_kg:g} kg, "
                f"累計 {cumulative:g} kg ({cumulative / vehicle.max_load_kg:.1%})\n"
                f"      理由: {reason['summary']}"
            )
            previous = stop.order_id
    if plan.unassigned_orders:
        print("未安排案例:")
        for order_id in plan.unassigned_orders:
            print(f"  {order_id}: {plan.unassigned_reasons[order_id]}")


def _print_api_plan(label: str, payload: dict[str, object]) -> None:
    print(f"\n=== {label} ({payload['algorithm']}) ===")
    summary = payload["summary"]
    assert isinstance(summary, dict)
    print(
        f"Validator: {'通過' if payload['validation']['valid'] else '失敗'}; "
        f"已安排 {summary['assigned_order_count']} 單; "
        f"總重 {summary['assigned_weight_kg']:g} kg"
    )
    for route in payload["vehicles"]:
        print(
            f"{route['vehicle_id']}: {route['order_count']} 單, "
            f"{route['planned_load_kg']:g}/{route['max_load_kg']:g} kg, "
            f"使用率 {route['load_utilization']:.1%}"
        )
        for stop in route["stops"]:
            reason = stop["reason"]["summary"]
            print(
                f"  {stop['sequence']:02d}. {stop['order_id']}, "
                f"{stop['order_weight_kg']:g} kg\n      理由: {reason}"
            )


def main() -> None:
    dataset, report = parse_workbook(WORKBOOK)
    if not report.is_valid or dataset is None:
        raise SystemExit(f"Demo 資料驗證失敗: {report.model_dump()}")
    matrix = SimulatedRouteProvider().build(dataset)
    baseline = build_baseline(dataset, matrix)
    baseline_validation = validate_plan(dataset, baseline, matrix)

    print("=== P0 競賽 Demo (僅預覽, 不執行 Dispatch 或部署) ===")
    print("資料: 40 單、80 件包裹、4 台車、5 個區域; 固定 simulated matrix。")
    _print_plan("Baseline 分車與配送順序", dataset, baseline, baseline_validation)
    store.datasets.clear()
    store.plans.clear()
    store.current_versions.clear()
    with WORKBOOK.open("rb") as workbook:
        imported = client.post(
            "/api/v1/datasets/import-excel",
            files={
                "file": (
                    WORKBOOK.name,
                    workbook,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
    if imported.status_code != 201:
        raise SystemExit(f"API 匯入失敗: {imported.status_code}")
    dataset_id = imported.json()["dataset_id"]
    initial = client.post(
        "/api/v1/plans",
        json={
            "dataset_id": dataset_id,
            "algorithm": "ORTOOLS",
            "route_provider_preference": "SIMULATED",
        },
    )
    if initial.status_code != 201:
        raise SystemExit(f"OR-Tools 初始方案失敗: {initial.status_code}")
    initial_payload = initial.json()
    _print_api_plan("OR-Tools 初始分車與配送順序", initial_payload)

    z4_ids = {order.order_id for order in dataset.orders if order.zone_code == "Z4"}
    z4_before = {
        order_id: route.vehicle_id
        for route in baseline.routes
        for order_id in route.order_ids
        if order_id in z4_ids
    }
    z4_after = {
        stop["order_id"]: route["vehicle_id"]
        for route in initial_payload["vehicles"]
        for stop in route["stops"]
        if stop["order_id"] in z4_ids
    }
    print("\n=== Z4 112kg 超重後重新分配 ===")
    print(f"Baseline: {json.dumps(z4_before, ensure_ascii=False, sort_keys=True)}")
    print(f"OR-Tools: {json.dumps(z4_after, ensure_ascii=False, sort_keys=True)}")
    print("說明: 不可拆單、遵守車輛載重與服務區域; 無法合法安排則保留 UNASSIGNABLE。")

    urgent_source = next(order for order in dataset.orders if order.zone_code == "Z4")
    preview = client.post(
        f"/api/v1/plans/{initial_payload['plan_id']}/urgent-insert/preview",
        json={
            "base_plan_version": initial_payload["version"],
            "order": {
                "order_id": "ORD-041",
                "zone_code": "Z4",
                "city": urgent_source.city,
                "district": urgent_source.district,
                "location_label": "Demo 第41單",
                "latitude": 25.033,
                "longitude": 121.565,
                "time_slot": "PM",
                "declared_package_count": 1,
                "priority": "HIGH",
                "note": "preview only",
            },
            "packages": [{"package_id": "PKG-041-01", "order_id": "ORD-041", "weight_kg": 2.0}],
        },
    )
    if preview.status_code != 200:
        raise SystemExit(f"第41單 preview 失敗: {preview.status_code}")
    preview_payload = preview.json()
    print("\n=== 第41單插單 Preview (完整差異) ===")
    print(
        f"基準 plan_id={initial_payload['plan_id']}, version={initial_payload['version']}, "
        f"dataset_id={initial_payload['dataset_id']}, algorithm={initial_payload['algorithm']}"
    )
    print(f"before: {json.dumps(preview_payload['before'], ensure_ascii=False, sort_keys=True)}")
    print(f"after: {json.dumps(preview_payload['after'], ensure_ascii=False, sort_keys=True)}")
    print(f"mode: {preview_payload['mode']}")
    print(json.dumps(preview_payload["diff"], ensure_ascii=False, indent=2, sort_keys=True))
    print(f"Preview Validator: {'通過' if preview_payload['feasible'] else '失敗'}")
    print("人工確認: 請由 dispatcher 檢視上述差異後再確認; 本 Demo 不執行 Dispatch 或部署。")


if __name__ == "__main__":
    main()
