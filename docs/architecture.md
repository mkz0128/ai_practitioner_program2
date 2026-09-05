# 架構決策紀錄

## 決策摘要

採用單一 FastAPI application 與分層 modular monolith，配置一個 OpenAI Agent、strict function tools、deterministic domain／validation／optimization services、可替換的 external providers、SQLAlchemy／SQLite persistence，以及獨立的 plan validator。

## 邏輯分層

```text
Frontend／Swagger client
        |
FastAPI routes + strict request／response schemas
        |
Application services／use cases
   |          |             |
Agent tools   Deterministic  Plan lifecycle
   |          services      + repositories
One Agent     |             |
              +-- import/validation
              +-- OR-Tools optimizer
              +-- independent validator
              +-- evidence + diff builder
              +-- provider interfaces
                    |-- SimulatedRouteProvider (keyless 預設)
                    |-- GoogleRoutesProvider (AUTO plan／map-data strict wiring)
                    |-- SimulatedTrafficProvider
                    |-- TDXTrafficProvider (OAuth、事件 projection、risk correlation)
```

相依方向一律朝內。Domain、validation、optimizer 與 plan validator 不得 import Agent 或 provider implementations。

## 原始碼配置

```text
src/
├── api/              # routes, dependencies, envelopes, CORS
├── agent/            # exactly one Agent, instructions, strict function tools
├── domain/           # Order, Package, Vehicle, Zone, Plan, evidence types
├── services/         # import, validation, planning, explanation, diff
├── optimization/     # OR-Tools model and independent plan validator
├── providers/        # Google/TDX/simulated adapters
├── repositories/     # SQLAlchemy repositories and unit of work
├── observability/    # JSON logging, tracing, metrics, correlation
└── config/           # strict environment settings
tests/
├── unit/
├── integration/
├── contract/
└── evals/
```

此配置是目前實作；deterministic core、FastAPI transport、SQLite repository、strict evidence tools、provider adapters、frontend control tower 與 restart hydration 均位於 repository。Live provider 與瀏覽器金鑰仍以實際環境驗證結果為準。

## ADR-001 — Single Agent

**決策：**固定使用一個 OpenAI Agents SDK Agent。

**理由：**只有 intent routing 與 explanation 需要 probabilistic behavior；加入 delegation／handoffs 會增加 latency、cost、state 與 evaluation surface，且不屬於本版本範圍。

**限制：**產品內不得使用 handoffs、A2A、AP2 或 sub-agents。每個 tool 都有 strict Pydantic input/output；model 來自 `OPENAI_MODEL`。

Runtime gate 是由 `Runner.run` 執行的實際 OpenAI Agents SDK `Agent`，不是只包裝 prompt。Strict allowlist 包含 `plan_dispatch`、查詢／解釋工具、三策略比較、延遲模擬、車輛可用性、時段／優先順序、凍結站點、換車預覽、版本查詢與通用臨時插單工具。每個 planning tool 在回傳精簡 evidence 前，都會呼叫 deterministic planner 與 independent Validator。Model 只能摘要 evidence 已存在的值，不得計算 weights、routes、legality 或 metrics。

Keyless SDK E2E suite 使用 SDK 的 `ScriptedModel`，在沒有 network access 的情況下執行實際 tool dispatch 與 guardrail pipeline。Opt-in live gate 使用 `OpenAIResponsesModel` 與 `gpt-5-mini`、`parallel_tool_calls=false`、`max_tokens=2048`、`max_turns=4`，停用 sensitive data tracing，並要求只呼叫一次 planning tool。

Responses API request shape 與 Chat Completions 分開鎖定：`input` 與 `max_output_tokens` 是 top-level fields，每個 strict function tool 具備 top-level `name`、`description`、`parameters` 與 `strict`。Nested Chat Completions `function` envelope 對 Responses 無效，分類為 `missing_required_parameter`（HTTP 400），不得改用更昂貴 model 重試。Live Agent gate 前會先 smoke-test direct text 與 strict-tool requests。

## ADR-002 — Deterministic Core

**決策：**arithmetic、validation、assignment、route sequencing、time feasibility、state transitions 與 evidence data 均為 deterministic。

**理由：**這些是契約不變量，LLM 不得作為 numeric truth 的來源。

**控制：**explanations 接收 vehicle capacity、planned load、utilization、zone eligibility、incremental distance/duration、time-window slack 與 provider mode 等 structured evidence。

## ADR-003 — Modular Monolith

**決策：**使用一個可部署的 FastAPI process。

**理由：**交易與除錯較簡單，避免 distributed-state 成本；provider interfaces 保留未來拆分的選項。

## ADR-004 — OR-Tools with Independent Validation

模型定義為不可拆單、具容量限制且包含 vehicle eligibility 與 time dimensions 的 vehicle routing problem：

- node demand = deterministic order total weight；
- allowed vehicles = AVAILABLE ∩ service zone ∩ residual capacity candidate；
- time dimension 包含行駛與每站 three-minute service；
- AM `[08:00,12:00]`、PM `[13:00,17:00]` 為 hard windows；
- lunch 建模為 non-service interval／route break，不是 LLM note；
- 每輛車均以 depot 作為 start／end；
- objective 先以高優先級 feasibility penalties／lexicographic passes 處理，再考量 travel，最後以 load-balance 作 tie-break。

求解後由獨立 validator 依 domain data 重新計算所有不變量。Solver success 本身不會使 `valid=true`。

### Deterministic Baseline

Benchmark reference 刻意保持簡單，並不是 optimization fallback：

1. 依 `priority`（先 `HIGH`）、time-window start、再 `order_id` 排序 orders；依 `vehicle_id` 排序 vehicles。
2. **First-Fit Eligible Vehicle** 將每張 unsplittable order 指派給第一輛服務其 zone 且具足夠 residual capacity（包含 `current_load_kg`）的 `AVAILABLE` vehicle。
3. 若第一個 candidate 無法產生合法且符合 time-feasible 的 route，依相同穩定順序嘗試下一輛 eligible vehicle。
4. **Nearest Neighbor** 以 fixed matrix 的 `distance_m` 從 `DEPOT-001` 排列每輛車；平手時依 `duration_s`、再依 `order_id`。只有能維持 AM/PM、lunch、三分鐘 service 與 depot-return feasibility 的下一個 stop 才能選取。
5. 每條 route 都返回 `DEPOT-001`。沒有合法 assignment／sequence 的 order 以穩定 reason 輸出至 `unassigned_orders`，不得省略。
6. Independent Validator 同樣檢查 Baseline output。無效 Baseline 只能作為 Benchmark 結果回報，不得成為可確認 plan。

### Optimized CVRPTW Model

```yaml
solver: Google OR-Tools RoutingModel CVRPTW
first_solution_strategy: PARALLEL_CHEAPEST_INSERTION
local_search_metaheuristic: GUIDED_LOCAL_SEARCH
time_limit_seconds: 10
solution_limit: 1000
dimensions:
  Capacity:
    demand: current_load_kg + whole-order package-weight sum
    vehicle_capacities: per-vehicle max_load_kg
    split_order: forbidden
  Time:
    transit: simulated duration + 3-minute stop service
    workday: 08:00-17:00
    hard_windows: {AM: 08:00-12:00, PM: 13:00-17:00}
    lunch_break: 12:00-13:00
vehicle_eligibility: AVAILABLE and zone in service_zone_codes
start_end: DEPOT-001
objective_priority:
  - minimize_unassigned_count
  - minimize_total_travel_time
  - minimize_load_utilization_gap
validator_required: true
```

`PARALLEL_CHEAPEST_INSERTION` 明確取代 `AUTOMATIC`，以 cheapest feasible insertions 建立 multi-route initial solution。`GUIDED_LOCAL_SEARCH` 用於跳脫 local minima，因此一律設定有限 time limit。標準 40-order solve 設有 10 秒 hard cap 與 1,000-solution cap；任一上限達到時，回傳已找到的最佳 feasible candidate 與 termination reason。

Capacity Dimension 以 deterministic whole-order demand 強制每輛 vehicle capacity。Time Dimension 使用 integer seconds，允許必要 waiting，強制 arrival／service completion 位於 AM 或 PM，保留 12:00–13:00 break，每站包含 180 秒，並限制每條 route 位於 depot start/end 之間。Vehicle／zone eligibility 以每個 order node 的 allowed vehicles 表示。

Objectives 使用 integer costs 與文件化的 dominating coefficient：丟棄一張 order 的成本高於 travel-plus-balance 最大可能改善，total travel time 支配有界的 utilization-gap term，distance 仍獨立回報。Coefficients 由 fixed matrix upper bound 推導並隨 run 記錄，絕不從 live traffic 選取。Independent Validator 從 source data 重新計算 assignment uniqueness、no split、capacity、eligibility、time/lunch、depot endpoints 與全部 metric totals。

### 無解與 Partial-solution 政策

- Pre-validation 在 solving 前先分類沒有 eligible vehicle、資料無效或單一 order capacity 不可能的 orders。
- Solver-optional visits 使用 deterministic high disjunction penalties，使最少數量的 orders 在 travel optimization 前被 dropped。每個 dropped node 都必須以 evidence 明確列在 `unassigned_orders`。
- 沒有 candidate 的 `ROUTING_FAIL`、`ROUTING_FAIL_TIMEOUT`、`ROUTING_INVALID` 與 `ROUTING_INFEASIBLE` 會產生穩定錯誤，不建立可確認 proposal。
- Time-limited feasible candidate 只有在 `optimality_proven: false`、solver status／termination metadata、明確 exceptions 且 independent Validator 通過時才可回傳。
- 有效 partial plan 維持 `PROPOSED`、設定 `complete: false`、列出所有 unassigned orders 並要求明確人工檢視；不得表示為完整 solution。

### Urgent Order 41 重新規劃

預設政策是 **minimum-change replanning**，不是不受限制的 full reshuffle：

1. 從精確 base plan/version 開始，並以既有 routes warm-start。
2. 優先插入 order 41，同時保留既有 vehicle assignments 與相對 stop order。
3. 若不可行，只解鎖 eligible affected routes，並在 travel／load tie-breaks 前先最小化 moved-order count 與 sequence displacement。
4. 只有上述方法失敗才建立獨立標示的 `FULL_REPLAN` fallback preview，且必須暴露 scope、moved orders、before／after metrics 與升級原因。
5. Preview 不得修改 base plan；精確 plan/version confirmation 仍為必要條件。

實作會先評估每條 eligible existing route 的所有合法 insertion positions，保持其他 vehicle assignments 與相對順序不變。選出 deterministic distance／time 最低的 insertion，並回傳 `mode: MINIMAL_CHANGE`。只有沒有 candidate 通過 independent Validator 時，service 才以相同 algorithm 進行 full replan，回傳 `mode: FULL_REPLAN`、`full_replan_reason`、`affected_vehicle_count` 與 `moved_order_count`。

### 核心功能驗收控制

Importer 對每個缺漏的 required cell 產生一個 `MISSING_REQUIRED_FIELD` error。Paths 穩定且可定位 entity（`orders.<order_id>.location_label`、`orders.<order_id>.time_slot` 與 `packages.<package_id>.weight_kg`），每個 error 都設定 `requires_manual_review: true`；validation report 也攜帶 aggregate flag。

Plan stop `reason` 由 `src/services/evidence.py` 根據 validated order、vehicle、route stop、fixed matrix leg 與 independent Validator result 產生。Evidence 包含 zone eligibility、order weight、post-assignment load/utilization、legal time slot、previous node、distance/duration 與 deterministic sequence basis。Agent 只能引用此 object，不得將自身文字作為 numeric values 來源。

Urgent previews 使用 deterministic plan diff builder。`reassigned_orders`、`sequence_changes` 與 per-vehicle `vehicle_load_changes` 由 before／after assignments 與 route positions 計算；distance／time deltas 由 plan totals 計算。插入 route 的 order 本身會回報為 sequence change，且 base version 保持 immutable。

## ADR-005 — 公平 Benchmark 契約

Baseline 與 Optimized runs 使用相同 canonical input snapshot：相同的 40 orders、4 vehicles、5 zones、穩定 row/entity ordering、`DEPOT-001` 與相同版本的 fixed simulated distance/duration matrix。固定 Benchmark values 排除 Google live traffic；live runs 僅回報 invariants 與 observed ranges，不得取代 canonical result。

| Metric | 定義 |
|---|---|
| Total distance | 每個 depot／stop arc 的 fixed-matrix `distance_m` 總和 |
| Total driving time | fixed-matrix `duration_s` 總和；不含 waiting 與 service |
| Vehicle load/utilization | `current_load_kg + assigned_weight_kg`；utilization 為 load／max load |
| Utilization gap | 四輛 vehicles 中最大與最小 utilization 的差 |
| Unassigned orders | Count 加上完整且有序的 IDs／reason codes |
| Violations | 由 Validator 分別計算 overload、cross-zone、duplicate 與 time-window counts |
| Solve time | 只量測 algorithm execution 的 monotonic elapsed milliseconds |
| Improvement vs Baseline | `(baseline - optimized) / baseline * 100`；僅適用 lower-is-better metrics，Baseline 為零時為 `null` |

Reproducibility controls 包含：pinned OR-Tools／runtime versions；committed fixture 與 matrix version/hash；integer meters／seconds／grams；穩定 order／vehicle／node ordering 與 tie-breakers；相同 search parameters；single-process canonical run；一次未計量 warm-up 加五次 measured runs；跨 runs 的 route／metric equality checks；median solve time 分開回報，絕不宣稱為跨機器 exact value。若 10 秒 cap 在固定 solution limit 前觸發，或 route equality 失敗，run 標記為 non-canonical，不得靜默更新 Golden values。

## ADR-006 — API Key 測試分層

| Layer | Provider behavior | 閘門與預期結果 |
|---|---|---|
| Keyless tests | Simulated/mock Google、TDX 與 OpenAI adapters | 永遠可執行；不依賴 network 或 credentials；缺 key 使用 fallback 且必須通過 |
| Live integration tests | 明確的 live adapter 與最小 real request | 僅在該 provider 所需 environment variables 存在時執行；否則 `skip`，不可失敗 |

## ADR-007 — 前端控制塔與 Provider 邊界

`frontend/` 是 React + TypeScript + Vite + MUI 的單一控制塔。畫面只透過原有 13 組 REST routes 與 5 組進階 routes 取得 dataset、plan、map、provider status、Agent evidence、策略比較、風險、版本與 urgent preview；不在前端重算重量、路線或合法性，也不提供自動 Dispatch。Google Maps JavaScript API 只接受 `VITE_GOOGLE_MAPS_BROWSER_API_KEY`，Server key、OpenAI 與 TDX credentials 永遠留在後端。

後端 provider 狀態與每個 response 的 `provider_mode`／`traffic.data_status` 必須直接呈現。缺少 Browser key 時控制塔顯示可用的 deterministic map preview 並標記 `SIMULATED`；這不是 Google live map。缺少 Google Routes 或 TDX credentials 時顯示 `BLOCKED`／`CREDENTIALS_MISSING`，不把 fallback 當作 live 通過。

Tests 只能檢查 required variable 是否存在。絕不可將 secret 讀入 assertions、output、serialization、exception text、logs、traces、snapshots、fixtures 或 Git。Provider clients 必須 redact authorization headers 與 query credentials。Missing／rejected key 依測試分層降級為穩定的 skip／fallback result，絕不破壞 keyless suite。

## Runtime 驗收閘門

Endpoint contract 是可執行的：`tests/test_api_contract.py` 解析原有契約與目前進階路由，與 FastAPI 註冊的 method/path 比對，並以安全成功或穩定錯誤 response 執行每條路由。40-order Demo gate 接著執行 import、validation、initial plan、map/provider fallback、evidence explanation、human confirmation 與 order-41 preview/diff。流程刻意在 dispatch 前停止，並確認 base plan/version 未變更。這些是 evidence gates，不是未經驗證的完成宣稱。

## ADR-007 — Provider 隔離與 Fallback

```yaml
RouteMatrixProvider:
  input: origins, destinations, departure context
  output: distance/duration matrix, provider mode, freshness, warnings, evidence IDs
RouteGeometryProvider:
  input: ordered coordinates
  output: encoded polyline/coordinate path, legs, provider mode
TrafficProvider:
  input: region/segment/time
  output: status/multiplier/evidence, or unavailable warning
```

`SimulatedRouteProvider` 是 deterministic 且在沒有 credentials 時的 API 預設。`GoogleRoutesProvider` 使用 narrow field mask 與 timeout；`POST /plans` 在 `route_provider_preference=AUTO` 且 `traffic_mode=AUTO` 時，若有 server key 便 strict 取得 Matrix 並把相同 `MatrixResult` 傳入 OR-Tools，若缺 key 則回傳 `SIMULATED` 並附 warning，已設定 key 但呼叫失敗則回傳 `PROVIDER_UNAVAILABLE`，不靜默降級。`/map-data` 對 Google plan 另外取得 encoded route geometry。`provider_mode=SIMULATED` 仍不得宣稱為 Google live 整合。TDX adapter 會執行 OAuth、取得事件並以城市／區域／座標 evidence 關聯路線；缺少 credentials 時回傳 `CREDENTIALS_MISSING`。OpenAI outage 只繞過 natural-language orchestration。

Google Compute Route Matrix 需要 field mask。規劃的最小欄位為 `originIndex,destinationIndex,status,condition,distanceMeters,duration`；route geometry 僅要求 frontend 所需的 distance、duration、encoded polyline 與 leg fields。除 manual investigation 外禁止 wildcard masks。

Google caching 採 transient 且可設定（預設 900 秒）。完成目前 service terms review 前停用 raw Google content 的 durable storage；derived plan records 僅保留 provider identity、timestamp 與法律允許的欄位。

## 整合架構補充 — Canonical Schema 與企業資料整合邊界

所有來源都必須先轉換為唯一的 Canonical Order Schema，再進入相同的 validation、weight aggregation、planning 與 independent Validator 流程。Excel 只是其中一種 input adapter，不是唯一資料來源。

```text
Excel／ERP／WMS／電商
        → Adapter 或企業中介平台（MuleSoft、Boomi、ESB、ETL）
        → FastAPI REST API
        → Canonical Order Schema
        → Validator
        → Planner
```

FastAPI REST API 是正式的系統整合介面，負責 ERP、WMS、電商與配送系統之間的資料交換。企業可自行轉換欄位後呼叫 API、透過中介平台轉換，或委託建立特定企業 adapter。這些 adapter 必須重用既有 canonical schema 與 validator，不得繞過核心規則。

MCP 不取代正式 REST API。本階段不實作 MCP；未來 MCP 僅作為 Agent 的工具層，透過既有 REST API 或配送核心提供 `get_unplanned_orders`、`import_orders`、`create_dispatch_plan`、`explain_unassigned_order` 等 allowlisted tools。

正確的邊界為：

```text
企業系統 → REST API／Webhook → 配送核心
AI Agent → MCP Tool → REST API 或配送核心
```

## 動態調度架構補充 — 安全邊界

一次取得路況並產生方案，與車輛出發後的持續動態調度是兩個不同能力。後者屬於企業級擴充功能（B 類）；若未來實作，必須遵循下列流程：

```text
車輛出發
  → 持續取得 GPS 與路況
  → 重新計算 ETA
  → 發現遲到風險
  → 產生新方案 preview
  → 顯示受影響範圍
  → 調度員確認
  → 更新方案
```

安全規則：已完成配送的訂單不得變更；正在配送的站點原則上固定；優先採用最小變動；不得因路況直接自動換車；必須先顯示受影響訂單、車輛、距離、時間與原因；只有調度員確認後才能套用新方案。本階段不實作 GPS、持續監控或自動重排。

## ADR-008 — Persistence 與 Versioning

Planned tables:

| Table | Purpose |
|---|---|
| datasets | import metadata, hash, validation state |
| orders / packages / vehicles / zones | normalized validated data |
| plans | stable plan identity and current state/version pointer |
| plan_versions | immutable proposal/preview snapshots |
| assignments / route_stops | per-version allocation and ordered route |
| exceptions | stable code, severity, affected IDs, evidence/details |
| audit_events | append-only state/tool/approval events |
| provider_runs | mode, latency, warning, freshness, request fingerprint |
| agent_sessions | session ID and non-sensitive usage metadata |

SQLite transactions 保護 import 與 state changes。Confirmation 使用 `plan_id + version` 的 optimistic concurrency；stale requests 回傳 `PLAN_VERSION_CONFLICT`。

現況限制：SQLite 會保存 plan rows、immutable preview rows、確認狀態與 current-version pointer；`confirm`／停用的 `dispatch` 均透過 repository 回寫狀態並留存 audit。Render Free 的本地檔案仍不適合作為跨執行個體的永久資料庫，因此跨部署持久化需另行選擇受管資料庫，不能在沒有該依賴時宣稱永久保存。

## State Machine

```text
DRAFT -> VALIDATED -> PROPOSED -> CONFIRMED -> DISPATCHED
                      |             |
                      +-- urgent preview creates new PROPOSED version
```

不允許 reverse transition 或 implicit confirmation。Preview 為 immutable 且 side-effect-free；每個 accepted／rejected transition 都寫入 audit event。

## Request Flow — Daily Dispatch

1. Import multipart workbook、計算 hash 並解析四張工作表。
2. Normalize list fields 並 validate；只持久化受控 records／metadata。
3. Resolve route matrix provider 並收集明確 mode／warnings。
4. 建立 deterministic candidates／model 並 solve。
5. 在 independent validator 中重新計算 invariants。
6. 持久化 immutable PROPOSED version 與 evidence。
7. Agent 或 REST 回傳 structured plan；由 human 另行確認。

## Request Flow — Urgent Insert

1. 載入精確 base version 並要求 pre-dispatch state。
2. Validate order／packages。
3. 對副本重新最佳化；validate candidate。
4. 將 preview 持久化為新 version，不移動 current pointer。
5. 回傳 before／after／diff；明確 confirmation 才能套用精確 version。

## Error 與 Resilience Design

- Domain errors 使用穩定 codes，不回傳 raw stack traces。
- Provider errors 包含 provider、operation、retryability、fallback mode 與 request ID。
- Retries：最多兩次，僅用於 transient／idempotent provider calls，採 bounded exponential backoff with jitter。
- Agent limits：8 turns、12 tool calls、30k tokens、120 秒；相同 tool+args 重複兩次即終止。
- Deterministic core／database 不可用時 readiness 失敗；optional provider outage 顯示 degraded，但不使 readiness 失敗。

## Security

- Strict Pydantic schemas 拒絕 unknown fields。
- Workbook／chat／note／provider text 是不可信資料，不能發布指令。
- `.env` 與 credentials 絕不讀入 prompts／logs／traces。
- Browser 與 Server Google keys 分開，套用 referrer／IP／API restrictions。
- CORS 是 environment allowlist。
- 不含真實 customer PII、production mutation、auto-deploy 或冒用使用者的 confirmation。

## Render Free 測試部署架構

本專案的 Render 目標是 `feat/frontend-control-tower` 上的單一 Free Web Service，僅供測試與展示，不代表 Production deployment。Docker multi-stage build 先產生 Vite `frontend/dist`，再由單一 FastAPI/Uvicorn worker 同源提供 SPA、Swagger 與 `/api/v1/*`；Render `$PORT` 與 `/health` 由平台注入及檢查。Render Blueprint 的 branch auto-deploy 僅限此測試服務，不建立 GitHub Actions、不合併 `main`、不執行 Dispatch。

Render Secrets 只注入 server-side `OPENAI_API_KEY`、`GOOGLE_ROUTES_SERVER_API_KEY` 與展示密碼；Browser key 透過公開 runtime config 供 Maps JavaScript 使用，TDX 變數可缺省。部署前必須使用已輪替且受限的 Provider keys，不能把曾曝光的開發憑證帶入公開服務。SQLite 使用 `/tmp` 暫存路徑，服務休眠或重啟後資料可能重置。

## 進階功能實作邊界

- `compare_strategies` 以同一份 Matrix 分別執行 `FASTEST`、`BALANCED`、`STABLE`；三者使用不同的 OR-Tools 初始策略／成本權重，並各自通過 Validator。
- `calculate_plan_risks` 以 ETA、時段截止、服務時間與剩餘餘裕計算綠／黃／紅風險及 10／20／30 分鐘延遲情境，不產生沒有歷史依據的機率。
- `reassign_order_preview` 與 `change_order_constraint` 只建立不可變的 `PROPOSED` preview；換車、時段及優先級變更必須先驗證，再由調度員確認。
- `change_frozen_stops` 以結構化 order IDs 保存凍結範圍；任何未來重排均應以此範圍作為服務層約束，不能由模型自行忽略。
- `evidence_grounded_answer` 會在回覆送出前檢查模型使用的數字與識別碼是否存在於工具 evidence；不一致時改以安全摘要回覆。

## 已查閱的官方參考資料（2026-09-01）

- OpenAI model/Agent guidance: https://developers.openai.com/api/docs/guides/latest-model
- OpenAI platform quickstart: https://platform.openai.com/docs/quickstart
- Google Compute Route Matrix: https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRouteMatrix
- Google API key security: https://support.google.com/googleapi/answer/6310037
- TDX Swagger/basic services: https://tdx.transportdata.tw/api-service/swagger/basic/
- OR-Tools routing strategies/limits: https://developers.google.com/optimization/routing/routing_options
- OR-Tools CVRP capacity dimension: https://developers.google.com/optimization/routing/cvrp
- OR-Tools VRPTW time dimension: https://developers.google.com/optimization/routing/vrptw
- OR-Tools initial routes/warm start: https://developers.google.com/optimization/routing/routing_tasks
- OR-Tools dropped-visit penalties: https://developers.google.com/optimization/routing/penalties
