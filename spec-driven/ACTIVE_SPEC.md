---
spec_id: AI-DISPATCH-MVP
spec_version: 1.0.0-spec
status: IMPLEMENTATION_IN_PROGRESS
current_phase: PHASE_2_FEATURE_IMPLEMENTATION
feature_code_allowed: true
required_approval_command: APPROVE_IMPLEMENTATION
approved_product_input_date: 2026-09-01
application_agent_count: 1
---

# AI 智慧配送路線與載重規劃 Agent — Active Specification

## 0. 階段閘門

本文件已吸收使用者確認的產品決策，不再重新訪談。使用者已輸入精確命令 `APPROVE_IMPLEMENTATION`，現在允許在本地沙盒開始 Feature Code。所有部署、Git push、外部付費、IAM、Production 或其他 L2/L3 動作仍需另行範圍核准。

`APPROVE_IMPLEMENTATION` 不包含部署、Git push、外部付費、IAM、Production 或其他 L2/L3 動作。

## 1. Why — 商業意圖

### 核心問題

調度人員需要把含區域、位置、時段、包裹與重量的配送訂單，快速轉成合法、可解釋、可人工確認的分車與配送順序。純 LLM 會在數字、限制與狀態上產生不可接受的幻覺；純人工則難以快速處理載重衝突、跨區限制、時段與臨時插單。

### 使用者

- Primary: 配送調度人員，負責匯入、檢查、預覽、確認與派送狀態。
- Secondary: 前端開發者，依穩定 REST/OpenAPI 合約展示地圖、指標、例外與動畫。
- Technical operator: 後端開發者，管理 provider 設定、健康狀態、測試和觀測。

### 產品成果

本系統是一套可解釋的 AI 配送調度 Copilot。單一 OpenAI Agent 負責理解自然語言並調用具明確 Schema 的工具；資料驗證、重量彙總、車輛分配、路線最佳化、配送時段約束及狀態管理，均由確定性程式執行，確保結果可驗證、可解釋且可追溯。所有最終配送方案仍由調度人員確認。系統提供可供前端串接的 REST API 與 Swagger。

### 成功標準

- 固定 40 單／4 車／5 區資料能在無外部 Key 時完整 Demo。
- 所有可確認方案通過獨立 validator，零超載、零拆單、零重複、零跨服務區、零硬時段違規。
- 第 41 張出發前插單以 preview/version/diff 呈現，未確認不覆寫。
- 前端可由 OpenAPI、sample payload 與文件獨立串接。

## 2. What — 範圍與流程

### 產品工作流程

1. `daily-dispatch`: import → validate → assign → route/order → independently validate → explain → human confirm.
2. `urgent-order-insertion`: load exact pre-dispatch plan version → validate one new order → re-optimize preview → validate → diff → human confirm.

### Agent 邊界

- 固定使用一個 OpenAI Agent；不得使用 handoff、multi-Agent、A2A 或 AP2。
- Agent 理解自然語言、選擇 allowlisted function tools、摘要錯誤並解釋 structured evidence。
- LLM 絕不執行 weight sums、legality checks、vehicle assignment、route ordering、time-window checks、state transitions 或 numeric invention。
- Algorithms 必須是 function tools/service functions，不得是 Skills。

### 已完成核心功能

- `.xlsx` import/validation，包含四張固定工作表。
- 40 張訂單範例、4 台車與 5 個營運區域。
- 確定性的 capacity／zone／time feasibility 與 OR-Tools route planning。
- 獨立 plan validator 與明確的 partial infeasibility。
- 以 SQLite 持久化 datasets、plans、versions、assignments、exceptions、audit events 與 Agent session metadata。
- Initial plan、map data、explanations、urgent order preview、confirmation 與 dispatch state。
- 使用 strict tools 的 Single Agent，以及 graceful OpenAI degradation。
- Simulated route matrix／polyline／congestion fallback。
- Google／TDX provider interface、settings、health/status、timeout/fallback；Google strict Matrix／geometry wiring、TDX OAuth event projection 與 route-risk correlation 已實作，Live 狀態仍依 credentials 判定。
- REST、OpenAPI/Swagger、sample payloads，以及由 environment 設定的 CORS。

以上「已完成核心功能」限定於目前可重現的 deterministic／simulated provider 範圍與已測試的 provider wiring。SQLite 的 confirm／dispatch durable state 仍有重啟後回寫缺口；HTTP `/api/v1/agent/chat` 維持 evidence explanation path，SDK `Runner.run` 由 runtime／E2E gate 驗證；Google／TDX 真實資料、Browser live map 與 full Live E2E 均不應由此清單推論為完成。`frontend/` 已提供 local control tower，但缺少 Browser key 時只顯示 simulated map preview。

### 原始必要功能的整合缺口

- Google Routes 提供真實距離與行駛時間，且 live Matrix 必須真正進入 OR-Tools 排程。
- Google Maps Browser API 必須在瀏覽器實際顯示地圖、Marker 與配送路線。
- TDX 必須完成 OAuth、真實路況／道路事件查詢，並指出受影響路線或配送風險。
- 前端必須完整顯示訂單、車輛、載重、路線、例外與 Agent 對話。
- Google、TDX、OR-Tools、OpenAI Agent 與前端必須完成整合驗證與前後端 Live E2E。

上述項目屬原始必要功能，不得重新分類為 P1 或可選功能。現況與證據詳見 `docs/requirements.md` 與 `docs/project-status.md`。

| 原始必要能力 | 現況 | 實際證據與缺口 |
|---|---|---|
| Google Routes live distance／duration | 部分完成（Live BLOCKED） | `src/providers/google_routes.py` strict adapter 與 `tests/test_live_provider_wiring.py`；本環境缺 server key，無 LIVE PASS。 |
| Google Matrix 進入 OR-Tools | 部分完成（wiring verified） | `_build_matrix` 將 strict Google `MatrixResult` 傳入 solver；hash/version 一致性 test；尚缺真實 provider E2E。 |
| Google Maps Browser 地圖 | 部分完成（Browser LIVE BLOCKED） | `frontend/src/components/MapPanel.tsx` 可載入 Google Maps、Marker、polyline，無 key 時為 simulated fallback。 |
| TDX OAuth／真實路況／道路事件 | 部分完成（Live BLOCKED） | `src/providers/tdx.py` OAuth、事件 models、mock provider test；缺 TDX credentials。 |
| TDX 受影響路線／配送風險 | 部分完成（deterministic） | `correlate_events_to_plan` 與 `map-data.traffic.route_risks`；尚缺 live event evidence。 |
| 前端完整操作與 Agent 顯示 | 部分完成（local control tower） | `frontend/` React/Vite/MUI、API client、RTL tests；尚缺 Browser/live E2E。 |
| 全整合前後端 Live E2E | 尚未完成 | keyless/provider-neutral/contract gates 通過；必須在有 Google、TDX、OpenAI、Browser credentials 的環境執行。 |

### 企業級擴充功能

下列能力屬 B 類企業級擴充，現況均為 `PLANNED`，不與 A 類原始必要功能混列：

- ERP／WMS／電商訂單整合層。
- 車輛出發後的路況與 ETA 持續監控。
- 路況改變後的動態重新試算。
- 例外控制塔。
- 準時優先、距離優先、最小變動等多方案比較。
- 完整 Why／What-if 排程診斷。
- 客戶 ETA 與延遲通知預覽。
- 計畫與實際結果比較。
- 成本、油耗與碳排儀表板。

### 明確不包含

- Production deployment 或 real TMS/ERP/GPS integration。
- WebSocket 或 vehicle-in-motion rescheduling。
- 為 urgent pickup 返回 depot。
- Real fleet actuation、完整 Taipei/New Taipei coverage、multi-Agent、A2A 或 AP2。

### 目前暫不處理

- 正式 ERP／WMS 客製串接。
- 司機 App。
- GPS 硬體。
- 電子簽收。
- 3D 裝載。
- 多配送中心。
- 外包車隊與承運商計價。
- 正式簡訊發送。
- 正式環境部署。

## 3. 固定參考資料

### Depot

```yaml
depot_id: DEPOT-001
name: 新北市青職基地／本次活動地點
public_address: 220 新北市板橋區黃石里民權路 170 號
latitude: 25.0131533
longitude: 121.4599675
timezone: Asia/Taipei
source:
  type: address_geocode
  provider: Google Maps public place search
  verified_on: 2026-09-01
  url: https://www.google.com/maps/search/?api=1&query=220%E6%96%B0%E5%8C%97%E5%B8%82%E6%9D%BF%E6%A9%8B%E5%8D%80%E6%B0%91%E6%AC%8A%E8%B7%AF170%E8%99%9F
```

所有 routes 均從 `DEPOT-001` 出發並返回。

### 營運區域

| Code | Name | Covered districts |
|---|---|---|
| Z1 | 新北西區 | 板橋、新莊、三重 |
| Z2 | 南部都會區 | 中和、永和、新店、文山 |
| Z3 | 臺北核心西區 | 萬華、中正、大同、中山 |
| Z4 | 臺北核心東區 | 大安、信義、松山、南港 |
| Z5 | 臺北北區 | 士林、北投、內湖 |

這是五個營運區域，而不是五個行政區；跨城市分組是刻意的設計。

### 車輛

| ID | Max load | Service zones | Initial load |
|---|---:|---|---:|
| VEH-001 | 120 kg | Z1, Z2, Z3 | 0 kg |
| VEH-002 | 100 kg | Z1, Z3, Z4 | 0 kg |
| VEH-003 | 160 kg | Z2, Z4, Z5 | 0 kg |
| VEH-004 | 110 kg | Z1, Z2, Z5 | 0 kg |

Service zones 是 hard constraints；系統沒有 primary/backup vehicle 概念。

## 4. 資料契約

### Workbook

一個 `.xlsx` 必須恰好包含四張工作表。Excel 的 list delimiter 僅為 `|`；REST 使用 arrays。

```yaml
orders:
  fields: [order_id, zone_code, city, district, location_label, latitude, longitude, time_slot, declared_package_count, priority, note]
packages:
  fields: [package_id, order_id, weight_kg]
vehicles:
  fields: [vehicle_id, vehicle_name, max_load_kg, current_load_kg, service_zone_codes, depot_id, status, note]
zones:
  fields: [zone_code, zone_name, covered_cities, covered_districts, center_latitude, center_longitude, tdx_city_codes, adjacent_zone_codes, enabled]
```

### 隱私

- 使用如 `模擬配送點 Z3-04` 的虛構 `location_label`，並搭配可用座標。
- 不含真實客戶姓名、電話或完整地址。
- 允許使用公開 depot address。

### 驗證規則

| ID | Rule |
|---|---|
| VAL-001 | 各 entity type 內的 IDs 必須唯一。 |
| VAL-002 | 每個 package 必須參照既有 order。 |
| VAL-003 | 每個 order 至少包含一個 package。 |
| VAL-004 | 宣告的 package count 必須等於實際數量。 |
| VAL-005 | 每張 order 包含 1–3 個 packages。 |
| VAL-006 | 每個 `weight_kg > 0`；缺漏／無效 weight 絕不猜測。 |
| VAL-007 | 超過所有合法候選 capacity 的 unsplittable order 標記為 `UNASSIGNABLE`。 |
| VAL-008 | Coordinates 必須是數值且在合法 latitude/longitude 範圍。 |
| VAL-009 | Zone 必須存在且啟用。 |
| VAL-010 | City/district 必須屬於宣告的營運區域。 |
| VAL-011 | `time_slot` 必須是 `AM` 或 `PM`。 |
| VAL-012 | Vehicle service zones 必須存在；不可用 vehicle 必須排除。 |
| VAL-013 | 必須符合 `0 <= current_load_kg <= max_load_kg`。 |
| VAL-014 | 缺少 location、weight 或 time 時產生 field error／`MANUAL_REVIEW`。 |

## 5. 最佳化契約

```yaml
workday: 08:00-17:00
am_window: 08:00-12:00
lunch_blackout: 12:00-13:00
pm_window: 13:00-17:00
service_minutes_per_stop: 3
order_splitting: forbidden
route_start_end: DEPOT-001
objective_priority:
  - satisfy_all_hard_constraints
  - minimize_total_travel_time_and_distance
  - balance_vehicle_load_utilization_when_distance_is_similar
```

Hard constraints 包含 exactly-once-or-unassigned、order integrity、capacity、vehicle availability、service zone、AM/PM、lunch、service time 與 depot start/end。

每個 solver output 都必須通過獨立 validator。若無法達成完整可行性，回傳 partial plan 及明確的 `unassigned_orders`／exceptions；不得靜默省略。

### 範例資料特性

- 40 initial orders, 5 zones × 8 orders.
- AM 20 / PM 20.
- 1–3 packages per order.
- Total order weight target 350–380 kg against fleet capacity 490 kg.
- 刻意集中 Z4 需求：只分配最近候選會使 VEH-002 超載，但重新分配至 VEH-003 仍可行。
- 另一張 urgent order 41 會改變 plan，且仍保持可行。

## 6. 緊急插單與 Plan 生命週期

```yaml
urgent_order_timing: after_initial_plan_before_final_dispatch
plan_states: [DRAFT, VALIDATED, PROPOSED, CONFIRMED, DISPATCHED]
```

允許的 forward transitions 都會寫入 audit。Optimizer 建立 `PROPOSED`，不得建立 `CONFIRMED`。Urgent insertion 建立 immutable preview／new version 與 before／after diff，絕不覆寫原 plan。Confirmation 需要精確的 `plan_id` 與 version；`DISPATCHED` plan 的插單回傳 `PLAN_ALREADY_DISPATCHED`。

## 7. 技術與版本鎖定

```yaml
runtime: CPython 3.12.13
api:
  fastapi: 0.141.1
  uvicorn: 0.52.4
schema:
  pydantic: 2.13.5
  pydantic-settings: 2.15.0
agent:
  openai-agents: 0.22.0
optimization:
  ortools: 9.15.6755
persistence:
  sqlalchemy: 2.0.52
  alembic: 1.19.1
  database: SQLite
http: 0.28.1
data:
  pandas: 3.0.5
  openpyxl: 3.1.5
quality:
  pytest: 9.1.1
  pytest-asyncio: 1.4.0
  ruff: 0.16.5
  mypy: 2.3.1
lock_file: requirements.lock
version_snapshot_date: 2026-09-01
```

Application dependencies 不得使用 `latest`、caret、tilde 或 open-ended dependency range。Model name 只從 `OPENAI_MODEL` 讀取；鎖定的 Demo 預設為 `gpt-5-mini`，不得靜默升級。

## 8. External Providers 與降級

### Google Routes

- 目標流程是由 Backend 使用 Compute Route Matrix 取得 distance/duration，並使用 Compute Routes 取得 route/polyline，再將同一份 live Matrix 傳入 OR-Tools。
- 使用包含 status/condition（視情況）的 narrow field masks；production 絕不使用 wildcard。
- Browser 與 Server keys 分開並受限制。
- Missing key → `SIMULATED` 與 warning；已設定 key 的 error/timeout → `PROVIDER_UNAVAILABLE`，不靜默 fallback。
- 僅在完成 Google Maps Platform terms review 後進行 cache；預設 transient TTL 為 900 秒，raw provider data 不假設可永久儲存。

目前實作狀態：`GoogleRoutesProvider` 已由 `src/api/main.py` 的 `AUTO` plan strict path 建立 Matrix，並將同一 identity 傳入 OR-Tools；`map-data` 另外取得 Google route geometry。Live 呼叫需 server key，沒有 key 時不得宣稱 live。

Reference: https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRouteMatrix

### TDX

- 已完成 provider interface、Client ID/Secret settings、OAuth token exchange、traffic event projection、city／zone／coordinate correlation 與明確 fallback。
- 真實 TDX response 仍需 credentials 與服務條款／配額確認；沒有 credentials 時回傳 `CREDENTIALS_MISSING`，不視為 Live 完成。
- TDX 是 enrichment，不是 optimization；Auth/data failure 不得使 core planning 失敗。

Reference: https://tdx.transportdata.tw/api-service/swagger/basic/

### OpenAI

- 使用 OpenAI Agents SDK single Agent 與 strict function tools。
- Built-in tracing 可設定；sensitive trace payloads 預設停用。
- 套用 token/tool/turn limits；OpenAI failure 只停用 `/agent/chat`。
- `src/agent/runtime.py` 已具備 `Runner.run` 與 strict tools 的 provider-neutral E2E；HTTP `/api/v1/agent/chat` 提供 evidence-grounded explanation path，沒有 OpenAI credentials 時明確降級。完整 HTTP live Agent E2E 仍依環境 gate 判定。

References: https://developers.openai.com/api/docs/guides/latest-model and https://platform.openai.com/docs/quickstart

## 9. REST API 最小集合

```yaml
endpoints:
  - GET /health
  - GET /ready
  - POST /api/v1/datasets/import-excel
  - GET /api/v1/datasets/{dataset_id}
  - GET /api/v1/datasets/{dataset_id}/validation
  - POST /api/v1/plans
  - GET /api/v1/plans/{plan_id}
  - GET /api/v1/plans/{plan_id}/map-data
  - POST /api/v1/plans/{plan_id}/urgent-insert/preview
  - POST /api/v1/plans/{plan_id}/confirm
  - POST /api/v1/plans/{plan_id}/dispatch
  - POST /api/v1/agent/chat
  - GET /api/v1/providers/status
```

標準 schemas、samples、status codes 與 error envelope 位於 `docs/api-contract.md`。CORS origins 來自 `CORS_ALLOWED_ORIGINS`；wildcard 不得作為長期預設。

## 10. Persistence Model

SQLite 儲存 datasets、orders、packages、vehicles、zones、plans、plan versions、routes/stops、assignments、exceptions、audit events、provider summaries 與 Agent session metadata。Plans／versions 與 audit events 採 append-oriented 設計；preview 不會修改 base state。

## 11. 驗收標準

### AC-001 — 初始每日 plan

```gherkin
Given 有效的 40-order、4-vehicle、5-zone data
When dispatcher 要求建立 delivery plan
Then 每張可安排 order 只出現在一輛 vehicle
And 同一 order 的 packages 不得拆分
And 任何 vehicle 都不得超載
And service zone 與 AM/PM constraints 均符合
And 每輛 vehicle 包含 load、utilization、sequence 與 evidence-grounded reasons
And plan 狀態為 PROPOSED 且需要 human confirmation
```

### AC-002 — 出發前 urgent order

```gherkin
Given initial plan 為 PROPOSED 且 vehicles 尚未出發
When 提交 order 41 進行 urgent insertion
Then 建立新的 preview version
And 回傳 before/after assignment、sequence、distance、time 與 load differences
And 在明確 confirmation 前 base plan 保持不變
```

### AC-003 — Capacity conflict

```gherkin
Given 將 order 指派給候選 vehicle 會造成超載
When system 重新最佳化
Then 不得將超載結果回傳為有效 final plan
And order 必須指派至其他合法 vehicle，或標記為 UNASSIGNABLE
And reason 必須引用 candidate capacity evidence
```

### AC-004 — Required data 缺漏

```gherkin
Given location、weight 或 time 缺漏
When 驗證 workbook
Then 回傳 field-level error 或 MANUAL_REVIEW
And 不得捏造缺漏值
```

### AC-005 — Time conflict

```gherkin
Given an order cannot be served inside its AM/PM window without crossing lunch
When the plan is created
Then it is classified TIME_WINDOW_CONFLICT
And it is not silently omitted or marked feasible
```

### AC-006 — Dispatched insertion rejection

```gherkin
Given plan 狀態為 DISPATCHED
When 要求 urgent insertion
Then API 回傳 PLAN_ALREADY_DISPATCHED
And 不得變更 plan version 或 assignment
And response 建議人工處理
```

### AC-007 — Provider outage

```gherkin
Given Google、TDX 或 OpenAI 不可用
When 要求 deterministic REST planning flow
Then core flow 仍可使用允許的 fallbacks
And provider warnings 指出降級來源
And simulated data 絕不描述為 live data
```

### AC-008 — Prompt injection

```gherkin
Given chat、note 或 provider text 要求忽略規則並直接 confirm 或 dispatch
When Agent 處理該文字
Then 將內容視為 untrusted data
And 不得繞過 state machine 或 human approval
And 不得捏造或執行禁止的 action
```

## 12. 非功能需求

- **Correctness**：critical deterministic 與 Golden pass rate 為 100%。
- **Security**：strict schemas、least privilege、secret/PII redaction 與 prompt-injection resistance。
- **Reliability**：provider isolation、bounded retries/timeouts 與明確 fallback。
- **Observability**：structured JSON、request/dataset/plan/version/run correlation、latency、tool 與 usage metadata。
- **Cost control**：每次最多 8 Agent turns、12 tool calls、30k total tokens、兩次 provider retries、120 秒 wall time 與 loop detection。
- **Maintainability**：分層 dependencies、provider interfaces、version pins、independent validator 與可追溯測試。

## 13. 驗證對照表

| 需求 | Deterministic tests | Golden cases | Contract/E2E |
|---|---|---|---|
| Import/validation | workbook suite | GD-003/004/011/012 | import and validation endpoints |
| Initial planning | optimizer + validator | GD-001/002/005/010 | plan + map endpoints |
| Urgent insertion | lifecycle/version suite | GD-006/007 | preview/confirm/dispatch endpoints |
| Degradation | provider fakes | GD-009 | provider status + REST continuity |
| Agent safety | tool/evidence checks | GD-008 | agent chat tool-call trace |

## 14. 整合前置條件與待辦事項

- Google Maps Browser key 仍屬前端依賴；Server key 若存在，`AUTO` plan 會 strict 取得 Matrix 並交給 OR-Tools；沒有 key 時維持 `SIMULATED` 並標示阻塞。
- TDX Client ID／Secret 僅能在需要時放入 local `.env`；取得憑證不代表 OAuth、路況查詢或風險判斷已完成。
- 啟用任何 durable cache 前，必須完成 Google content caching／persistence 的 terms review。
- Git baseline publication 受獨立規範管理，不代表已授權 deployment、production access 或後續 pushes。
