---
name: urgent-order-insertion
description: 在初始 plan 後、dispatch 前預覽一張 urgent order；未明確確認前不修改原 plan。
version: 1.0.0
status: approved-spec
allowed_phases: [IMPLEMENTATION, TEST]
---

# 緊急訂單插入工作流程

## 觸發條件

在任何 vehicle `DISPATCHED` 前，將一張訂單加入 `PROPOSED` 或 `CONFIRMED` 的 initial plan，包含 order-41 的 before／after preview。

## 不觸發條件

Vehicle 已 dispatched、depot return for pickup、GPS/live WebSocket rerouting、batch insertion 或 production TMS/ERP mutation。

## 必要輸入

- `plan_id` 與精確的 `base_plan_version`。
- 一張新訂單與 1–3 筆 package records。
- Zone、location/coordinates、AM/PM slot 與 package weights。

## 執行步驟

1. 載入精確 base plan，確認不是 `DISPATCHED`。
2. 以相同 dataset rules 驗證新 order／packages。
3. 評估合法車輛、capacity、time window 與 incremental route evidence。
4. 以 deterministic 方法重新規劃，不修改 base plan。
5. 對候選 plan 執行 independent validation。
6. 回傳新的 preview/proposal version 與 before/after diff。
7. 等待對精確 plan/version 的明確人工確認後才套用。

## 使用的工具

`get_dispatch_plan`、`preview_urgent_order_insertion`、`validate_dispatch_plan`、`explain_assignment`、`get_map_route_data`、`get_traffic_status`，以及僅在明確確認 plan/version 後使用的 `confirm_dispatch_plan`。

## Guardrails

- Preview 絕不覆寫 base plan；stale/mismatched versions 必須拒絕。
- `DISPATCHED` 回傳 `PLAN_ALREADY_DISPATCHED`；不得自動 reroute。
- 回報 vehicle／sequence／load／distance／time changes、conflicts、provider mode 與 confirmation requirement。
- 不得捏造 order 或 missing values。

## 失敗處理

- Invalid order：`URGENT_ORDER_INVALID`。
- 無可行插入：`URGENT_INSERT_UNASSIGNABLE`；保留原 plan。
- Stale version：`PLAN_VERSION_CONFLICT`。
- 已 dispatched：`PLAN_ALREADY_DISPATCHED` 並建議人工處理。

## 輸出契約

不可變的 `before`、候選 `after`、結構化 `diff`、feasibility／exceptions 與 `requires_human_confirmation: true`；確認前不得有 side effect。

## 測試

Golden cases `GD-006`–`GD-009`，以及 `.agent/evos/unit-tests/README.md` 的 lifecycle/versioning tests。
