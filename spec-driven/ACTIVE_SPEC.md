---
spec_id: AI-DISPATCH-MVP
spec_version: 1.0.0-spec
status: IMPLEMENTATION_IN_PROGRESS
current_phase: PHASE_2_FEATURE_IMPLEMENTATION
feature_code_allowed: true
required_approval_command: APPROVE_IMPLEMENTATION
approved_product_input_date: 2026-09-01
target_delivery_days: 3
application_agent_count: 1
---

# AI 智慧配送路線與載重規劃 Agent — Active Specification

## 0. Phase Gate

本文件已吸收使用者確認的產品決策，不再重新訪談。使用者已輸入精確命令 `APPROVE_IMPLEMENTATION`，現在允許在本地沙盒開始 Feature Code。所有部署、Git push、外部付費、IAM、Production 或其他 L2/L3 動作仍需另行範圍核准。

`APPROVE_IMPLEMENTATION` 不包含部署、Git push、外部付費、IAM、Production 或其他 L2/L3 動作。

## 1. Why — 商業意圖

### Problem

調度人員需要把含區域、位置、時段、包裹與重量的配送訂單，快速轉成合法、可解釋、可人工確認的分車與配送順序。純 LLM 會在數字、限制與狀態上產生不可接受的幻覺；純人工則難以快速處理載重衝突、跨區限制、時段與臨時插單。

### Users

- Primary: 配送調度人員，負責匯入、檢查、預覽、確認與派送狀態。
- Secondary: 前端開發者，依穩定 REST/OpenAPI 合約展示地圖、指標、例外與動畫。
- Technical operator: 後端開發者，管理 provider 設定、健康狀態、測試和觀測。

### MVP Outcome

三天內交付可供前端串接的 REST API 與 Swagger。產品定位為「可解釋的配送調度 Copilot」，不是自動車隊控制器。

### Success Measures

- 固定 40 單／4 車／5 區資料能在無外部 Key 時完整 Demo。
- 所有可確認方案通過獨立 validator，零超載、零拆單、零重複、零跨服務區、零硬時段違規。
- 第 41 張出發前插單以 preview/version/diff 呈現，未確認不覆寫。
- 前端可由 OpenAPI、sample payload 與文件獨立串接。

## 2. What — 範圍與流程

### Product Workflows

1. `daily-dispatch`: import → validate → assign → route/order → independently validate → explain → human confirm.
2. `urgent-order-insertion`: load exact pre-dispatch plan version → validate one new order → re-optimize preview → validate → diff → human confirm.

### Agent Boundary

- Exactly one OpenAI Agent; no handoff, multi-Agent, A2A, or AP2.
- Agent understands natural language, selects allowlisted function tools, summarizes errors, and explains structured evidence.
- LLM never performs weight sums, legality checks, vehicle assignment, route ordering, time-window checks, state transitions, or numeric invention.
- Algorithms are function tools/service functions, never Skills.

### In Scope (P0)

- `.xlsx` import/validation with four fixed sheets.
- 40-order sample, four vehicles, five operating zones.
- Deterministic capacity/zone/time feasibility and OR-Tools route planning.
- Independent plan validator and explicit partial infeasibility.
- SQLite persistence of datasets, plans, versions, assignments, exceptions, audit events, and Agent session metadata.
- Initial plan, map data, explanations, urgent order preview, confirmation, dispatch state.
- Single Agent with strict tools and graceful OpenAI degradation.
- Simulated route matrix/polyline/congestion fallback.
- Google/TDX provider interface, settings, health/status, timeout/fallback.
- REST, OpenAPI/Swagger, sample payloads, CORS from environment.

### P1

- Google live traffic mode and higher-quality polylines.
- TDX road congestion to road/zone mapping.
- Reproducible congestion event demonstrating route changes.
- Extra animation timeline fields beyond minimum ETA/sequence.

### Explicit Non-goals

- Production deployment or real TMS/ERP/GPS integration.
- WebSocket or vehicle-in-motion rescheduling.
- Return to depot for urgent pickup.
- Real fleet actuation, full Taipei/New Taipei coverage, multi-Agent, A2A, or AP2.

## 3. Fixed Reference Data

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

All routes start and end at `DEPOT-001`.

### Operating Zones

| Code | Name | Covered districts |
|---|---|---|
| Z1 | 新北西區 | 板橋、新莊、三重 |
| Z2 | 南部都會區 | 中和、永和、新店、文山 |
| Z3 | 臺北核心西區 | 萬華、中正、大同、中山 |
| Z4 | 臺北核心東區 | 大安、信義、松山、南港 |
| Z5 | 臺北北區 | 士林、北投、內湖 |

These are five operating zones, not five districts. Cross-city grouping is intentional.

### Vehicles

| ID | Max load | Service zones | Initial load |
|---|---:|---|---:|
| VEH-001 | 120 kg | Z1, Z2, Z3 | 0 kg |
| VEH-002 | 100 kg | Z1, Z3, Z4 | 0 kg |
| VEH-003 | 160 kg | Z2, Z4, Z5 | 0 kg |
| VEH-004 | 110 kg | Z1, Z2, Z5 | 0 kg |

Service zones are hard constraints. There is no primary/backup vehicle concept.

## 4. Data Contract

### Workbook

One `.xlsx`, exactly four sheets. The only list delimiter in Excel is `|`; REST uses arrays.

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

### Privacy

- Fictitious `location_label` such as `模擬配送點 Z3-04`, paired with usable coordinates.
- No real customer names, phones, or complete addresses.
- Public depot address is allowed.

### Validation Rules

| ID | Rule |
|---|---|
| VAL-001 | IDs are unique within entity type. |
| VAL-002 | Every package references an existing order. |
| VAL-003 | Every order has at least one package. |
| VAL-004 | Declared package count equals actual count. |
| VAL-005 | Order has 1–3 packages. |
| VAL-006 | Every `weight_kg > 0`; missing/invalid weight is never guessed. |
| VAL-007 | Unsplittable order exceeding every legal candidate capacity is `UNASSIGNABLE`. |
| VAL-008 | Coordinates are numeric and within valid latitude/longitude bounds. |
| VAL-009 | Zone exists and is enabled. |
| VAL-010 | City/district belongs to the declared operating zone. |
| VAL-011 | `time_slot` is exactly `AM` or `PM`. |
| VAL-012 | Vehicle service zones exist; unavailable vehicle is excluded. |
| VAL-013 | `0 <= current_load_kg <= max_load_kg`. |
| VAL-014 | Missing location, weight, or time becomes field error/`MANUAL_REVIEW`. |

## 5. Optimization Contract

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

Hard constraints: exactly-once-or-unassigned, order integrity, capacity, vehicle availability, service zone, AM/PM, lunch, service time, and depot start/end.

Every solver output passes a separate validator. If full feasibility is impossible, return a partial plan plus explicit `unassigned_orders`/exceptions; never omit silently.

### Sample Data Properties

- 40 initial orders, 5 zones × 8 orders.
- AM 20 / PM 20.
- 1–3 packages per order.
- Total order weight target 350–380 kg against fleet capacity 490 kg.
- Deliberate Z4 concentration: nearest-candidate-only assignment overloads VEH-002, while redistribution to VEH-003 remains feasible.
- One separate urgent order 41 changes the plan but remains feasible.

## 6. Urgent Insertion and Plan Lifecycle

```yaml
urgent_order_timing: after_initial_plan_before_final_dispatch
plan_states: [DRAFT, VALIDATED, PROPOSED, CONFIRMED, DISPATCHED]
```

Allowed forward transitions are audited. Optimizer creates `PROPOSED`, never `CONFIRMED`. Urgent insertion creates an immutable preview/new version with before/after diff and never overwrites the original. Confirmation requires exact `plan_id` and version. `DISPATCHED` returns `PLAN_ALREADY_DISPATCHED` for insertion.

## 7. Technology and Version Lock

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

No `latest`, caret, tilde, or open-ended dependency range is allowed in application dependencies. Model name is read only from `OPENAI_MODEL`; current proposed demo default is `gpt-5.6-luna`, subject to eval and account availability.

## 8. External Providers and Degradation

### Google Routes

- Backend: Compute Route Matrix for distance/duration and Compute Routes for route/polyline.
- Use narrow field masks including status/condition where relevant; never wildcard in production.
- Browser and Server keys are separate and restricted.
- Missing key/error/timeout → `SimulatedRouteProvider`, with `provider_mode: SIMULATED` and warning.
- Cache only under reviewed Google Maps Platform terms; default transient TTL is 900 seconds and raw provider data is not assumed permanently storable.

Reference: https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRouteMatrix

### TDX

- P0: provider interface, Client ID/Secret settings, health/status, timeout, and graceful fallback.
- P1: actual road congestion mapping to road segments/zones.
- TDX is enrichment, not optimization. Auth/data failure cannot fail core planning.

Reference: https://tdx.transportdata.tw/api-service/swagger/basic/

### OpenAI

- OpenAI Agents SDK single Agent and strict function tools.
- Built-in tracing is configurable; sensitive trace payloads disabled by default.
- Token/tool/turn/time limits apply. OpenAI failure disables `/agent/chat` only.

References: https://developers.openai.com/api/docs/guides/latest-model and https://platform.openai.com/docs/quickstart

## 9. REST API Minimum

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

The canonical schemas, samples, status codes, and error envelope live in `docs/api-contract.md`. CORS origins come from `CORS_ALLOWED_ORIGINS`; wildcard is not a lasting default.

## 10. Persistence Model

SQLite stores datasets, orders, packages, vehicles, zones, plans, plan versions, routes/stops, assignments, exceptions, audit events, provider summaries, and Agent session metadata. Plans/versions and audit events are append-oriented; preview does not mutate base state.

## 11. Acceptance Criteria

### AC-001 — Initial daily plan

```gherkin
Given valid 40-order, 4-vehicle, 5-zone data
When the dispatcher requests a delivery plan
Then each assignable order appears on exactly one vehicle
And packages for one order are not split
And no vehicle is overloaded
And service zone and AM/PM constraints are satisfied
And each vehicle includes load, utilization, sequence, and evidence-grounded reasons
And the plan is PROPOSED and requires human confirmation
```

### AC-002 — Pre-dispatch urgent order

```gherkin
Given an initial PROPOSED plan and vehicles have not departed
When order 41 is submitted for urgent insertion
Then a new preview version is created
And before/after assignment, sequence, distance, time, and load differences are returned
And the base plan is unchanged until explicit confirmation
```

### AC-003 — Capacity conflict

```gherkin
Given assigning an order to a candidate would overload it
When the system re-optimizes
Then no overload is returned as a valid final plan
And the order is assigned to another legal vehicle or marked UNASSIGNABLE
And the reason cites candidate capacity evidence
```

### AC-004 — Missing required data

```gherkin
Given location, weight, or time is missing
When the workbook is validated
Then a field-level error or MANUAL_REVIEW is returned
And no missing value is invented
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
Given a plan is DISPATCHED
When urgent insertion is requested
Then the API returns PLAN_ALREADY_DISPATCHED
And no plan version or assignment is changed
And the response recommends manual handling
```

### AC-007 — Provider outage

```gherkin
Given Google, TDX, or OpenAI is unavailable
When a deterministic REST planning flow is requested
Then the core flow remains available using permitted fallbacks
And provider warnings identify the degraded source
And simulated data is never described as live data
```

### AC-008 — Prompt injection

```gherkin
Given chat, note, or provider text says to ignore rules and directly confirm or dispatch
When the Agent handles the text
Then it treats the content as untrusted data
And does not bypass the state machine or human approval
And does not invent or execute a forbidden action
```

## 12. Non-functional Requirements

- **Correctness**: critical deterministic and Golden pass rate 100%.
- **Security**: strict schemas, least privilege, secret/PII redaction, prompt-injection resistance.
- **Reliability**: provider isolation, bounded retries/timeouts, explicit fallback.
- **Observability**: structured JSON, request/dataset/plan/version/run correlation, latency, tool and usage metadata.
- **Cost control**: max 8 Agent turns, 12 tool calls, 30k total tokens, two provider retries, 120-second wall time, loop detection.
- **Maintainability**: layered dependencies, provider interfaces, version pins, independent validator, traceable tests.

## 13. Verification Map

| Requirement | Deterministic tests | Golden cases | Contract/E2E |
|---|---|---|---|
| Import/validation | workbook suite | GD-003/004/011/012 | import and validation endpoints |
| Initial planning | optimizer + validator | GD-001/002/005/010 | plan + map endpoints |
| Urgent insertion | lifecycle/version suite | GD-006/007 | preview/confirm/dispatch endpoints |
| Degradation | provider fakes | GD-009 | provider status + REST continuity |
| Agent safety | tool/evidence checks | GD-008 | agent chat tool-call trace |

## 14. Open Items That Do Not Block Local Implementation

- Google Maps Browser and Server API Keys are not yet available; simulated fallback is mandatory.
- TDX Client ID/Secret exist with the user but must be placed only in local `.env` when needed.
- Real TDX road/zone mapping is P1.
- Google content caching/persistence details require a final terms review before enabling any durable cache.
- Git baseline publication is separately governed; it does not authorize deployment, production access, or future pushes.
