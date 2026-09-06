---
name: urgent-order-insertion
description: 在初始 plan 後、dispatch 前，以同一流程收集、檢查並預覽一張或多張臨時訂單；未明確確認前不修改原 plan。
version: 2.0.0
status: approved-spec
allowed_phases: [IMPLEMENTATION, TEST]
---

# 緊急訂單插入工作流程

## 觸發條件

在任何 vehicle `DISPATCHED` 前，使用者以自然語言提出一張或多張臨時訂單。`ORD-041` 只是可查詢的示範 fixture，不是固定意圖或唯一支援的訂單。

## 不觸發條件

Vehicle 已 dispatched、depot return for pickup、GPS/live WebSocket rerouting 或 production TMS/ERP mutation。

## 必要輸入

- `plan_id` 與精確的 `base_plan_version`。
- 一張或多張新訂單。
- 每張都需 order ID、配送地點／座標、Zone、件數、每件重量、AM／PM 與 priority。

## 執行步驟

1. OpenAI Agents SDK 只把自然語言整理成 strict structured output，不直接執行 Preview。
2. 程式狀態機逐張檢查必要欄位；有缺漏時一次列出，不開始計算。
3. 僅有訂單 ID 時先查既有合成 fixture；查不到就要求補資料。
4. 欄位完整後顯示全部摘要，等待「產生插單預覽／修改／取消」。
5. 使用者選擇預覽後，程式固定呼叫 batch preview；LLM 不再選擇計算工具。
6. 多張訂單在同一個 dataset、Matrix 與求解中一起處理，不產生彼此覆蓋的連續 Preview。
7. Google 模式只用既有 Matrix 加上新節點的 rows／columns；不得重抓完整 40 單 Matrix。
8. 回傳逐張安排位置與整體 before／after diff，再執行 independent Validator。
9. Preview 不修改 current version；等待精確 plan/version 的人工確認後才建立新版本。

## 使用的工具

`urgent-order-understanding`（Agents SDK strict output）、`POST /api/v1/plans/{plan_id}/urgent-insert/batch-preview`、Validator、map-data，以及僅在明確確認 plan/version 後使用的 confirm API。

## Guardrails

- Preview 絕不覆寫 base plan；stale/mismatched versions 必須拒絕。
- LLM 不得直接呼叫 Preview、不得用 regex／關鍵字決定意圖，也不得跳過摘要確認。
- 任何一張缺欄時，整批不得開始計算。
- 重複 ID、無法安排或 Validator 失敗不得污染 current plan。
- `DISPATCHED` 回傳 `PLAN_ALREADY_DISPATCHED`；不得自動 reroute。
- 回報 vehicle／sequence／load／distance／time changes、conflicts、provider mode 與 confirmation requirement。
- 不得捏造 order 或 missing values。

## 失敗處理

- Invalid order：`URGENT_ORDER_INVALID`。
- 無可行插入：`URGENT_INSERT_UNASSIGNABLE`；保留原 plan。
- Stale version：`PLAN_VERSION_CONFLICT`。
- 已 dispatched：`PLAN_ALREADY_DISPATCHED` 並建議人工處理。

## 輸出契約

不可變的 `before`、候選 `after`、每張 `inserted_orders`、結構化 `diff`、feasibility／exceptions、Matrix 增量用量與 `requires_human_confirmation: true`；確認前不得有 side effect。

## 測試

Golden cases `GD-006`–`GD-009`、`tests/test_urgent_insertion_workflow.py` 的語意／狀態機案例、`tests/test_urgent_batch_api.py` 的單批 Preview／增量 Matrix／不污染方案案例，以及 `.agent/evos/unit-tests/README.md` 的 lifecycle/versioning tests。
