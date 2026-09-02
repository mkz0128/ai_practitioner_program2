# AI 智慧配送路線與載重規劃 Agent

三天 MVP 的定位是「可解釋的配送調度 Copilot」：以單一 OpenAI Agent 理解自然語言並操作嚴格 schema 的 function tools；所有資料驗證、重量計算、分車、路線、時段和狀態轉移都由確定性程式負責。

已收到 `APPROVE_IMPLEMENTATION`；目前已啟用本機 Feature Code 實作，並維持不部署、不啟用 Actions、不接觸正式環境的安全邊界。

## Sources of Truth

- 產品規格：`spec-driven/ACTIVE_SPEC.md`
- 本輪進度與問題：`docs/project-status.md`
- 最近一次驗證證據：`docs/validation-report.md`
- 安全與人工核准：`.agent/guardrails.md`
- API 合約：`docs/api-contract.md`
- 架構決策：`docs/architecture.md`
- 三天計畫：`docs/implementation-plan.md`
- 工作流程：`.agent/skills/daily-dispatch.md`、`.agent/skills/urgent-order-insertion.md`

## Round Progress Management

每輪開始先讀 Active Spec、Project Status、Validation Report，再讀 Guardrails、Developer Contract 與相關 Skill。`project-status.md` 同時只能有一個 `NOW`，`NEXT` 最多三項；所有新問題先依類型進入 `OPEN ISSUES`，真正阻止工作的條件才進入 `BLOCKED`。完成後必須更新 `DONE THIS ROUND` 與 `LAST VALIDATION`。

不得另外建立 `NOW.md`、`TODO.md`、`DONE.md` 或第二套進度真實來源。

## Locked Stack

- CPython 3.12.13
- FastAPI 0.141.1 / Pydantic 2.13.5
- OpenAI Agents SDK 0.22.0
- OR-Tools 9.15.6755
- SQLAlchemy 2.0.52 / SQLite
- pandas 3.0.5 / openpyxl 3.1.5
- pytest 9.1.1 / ruff 0.16.5 / mypy 2.3.1

Direct pins are in `pyproject.toml`; the Python 3.12 Windows resolution is in `requirements.lock`. The approved local `.venv` is installed from that lock; global Python remains unchanged.

## Workbook Contract

Both input workbooks contain exactly four sheets: `orders`, `packages`, `vehicles`, and `zones`.

The only list delimiter in Excel is the pipe character `|`. Examples:

- `service_zone_codes`: `Z1|Z2|Z3`
- `covered_cities`: `新北市|臺北市`
- `covered_districts`: `板橋|新莊|三重`
- `tdx_city_codes`: `NWT|TPE`
- `adjacent_zone_codes`: `Z2|Z3`

REST responses always expose these values as JSON arrays; delimiter strings never cross the API boundary.

## External Provider Modes

- Default demo mode: `SimulatedRouteProvider` plus reproducible simulated congestion.
- Google Routes: optional, server-side key, strict field mask, timeout, cache policy review, graceful fallback.
- TDX: optional P0 health/status integration; real road-to-zone congestion mapping is P1.
- OpenAI unavailable: REST import, validation, planning, confirmation, and queries remain available; only `/agent/chat` degrades.

本機 `.env` 僅供已核准的開發環境使用，永不提交；`.env.example` 只保留空白變數與 `gpt-5-mini` 預設模型。

## Planned Local Commands

These commands run the local implementation and keyless validation gates:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m mypy src
# Explicit live Agent gate; omit for the always-on keyless suite
$env:RUN_LIVE_AGENT_E2E='1'; .\.venv\Scripts\python.exe -m pytest tests/test_agent_e2e.py -q; Remove-Item Env:RUN_LIVE_AGENT_E2E
```

The keyless suite includes the real Agents SDK runner with `ScriptedModel`, strict deterministic
tools, and prompt-injection guardrails. The live gate uses `gpt-5-mini` only when credentials are
present; missing Browser/TDX credentials skip or fallback without blocking backend P0. Backend P0
and the OpenAI Agent are human-accepted as `DONE`; Frontend Integration remains `PENDING` and the
overall project remains `IN_PROGRESS`.

## Frontend Delivery Quick Start

The commands below are sufficient for a clean Windows checkout after installing CPython 3.12.
Confirm `python --version` reports `3.12.x` first (the Windows `py -3.12` launcher is also
acceptable). Run these from the repository root; they do not change global Python or Git settings.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock
$env:CORS_ALLOWED_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"
.\.venv\Scripts\python.exe -m uvicorn src.api.main:app --reload --host 127.0.0.1 --port 8000
```

Open [Swagger UI](http://127.0.0.1:8000/docs), the raw schema at
`http://127.0.0.1:8000/openapi.json`, or readiness at `http://127.0.0.1:8000/ready`.

### Frontend environment variables

These are the only values the frontend needs to know:

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_GOOGLE_MAPS_BROWSER_API_KEY=
```

`VITE_GOOGLE_MAPS_BROWSER_API_KEY` is optional and must be restricted to the exact frontend
origins and Maps JavaScript API before use. The backend `.env` uses
`CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173`. Never expose
`OPENAI_API_KEY`, `GOOGLE_ROUTES_SERVER_API_KEY`, `TDX_CLIENT_ID`, or `TDX_CLIENT_SECRET` to a
browser bundle; the browser key is not the server key.

## Demo workbook and one-command check

The canonical, fictitious workbook is [data/samples/demo-delivery-40-orders.xlsx](data/samples/demo-delivery-40-orders.xlsx).
It has exactly four sheets (`orders`, `packages`, `vehicles`, `zones`), 40 orders, 80 packages,
4 vehicles, 5 zones, and 365 kg total. Run the Chinese, no-dispatch walkthrough with:

```powershell
.\.venv\Scripts\python.exe scripts/run_p0_demo.py
```

The walkthrough imports the workbook, creates an OR-Tools plan, shows the overload redistribution
and one exception, previews `ORD-041`, and stops before Dispatch or deployment.

## API integration in the shortest path

Set `api = $env:VITE_API_BASE_URL` (or the equivalent frontend runtime setting), then call:

1. `POST /api/v1/datasets/import-excel` with the demo workbook as multipart `file`.
2. `GET /api/v1/datasets/{dataset_id}/validation`; stop and display all field errors if invalid.
3. `POST /api/v1/plans` with `{"dataset_id":"DS-*","algorithm":"ORTOOLS"}`.
4. `GET /api/v1/plans/{plan_id}` and `GET /api/v1/plans/{plan_id}/map-data` to render cards/map.
5. Optionally `POST /api/v1/agent/chat` with `plan_id`, `plan_version`, and an order ID for an
   evidence-only explanation.
6. For a pre-dispatch urgent order, call the preview endpoint and render its diff; confirm only
   after a human reviews the exact version.
7. `POST /api/v1/plans/{plan_id}/confirm` is the human approval checkpoint. The demo does not call
   `/dispatch`; a real operator may call it only after explicit confirmation.

Every response includes `X-Request-ID`; mutation/error bodies also include `request_id`. IDs and
versions are opaque and must be passed back exactly.

## Endpoint examples (all 13 contract routes)

The full schemas and status-code matrix are in [docs/api-contract.md](docs/api-contract.md).
These compact examples show the frontend request and response shape for every route.

| Method and path | Request | Successful response (abbreviated) |
|---|---|---|
| `GET /health` | none | `{"status":"ok","service":"ai-delivery-dispatch-agent","request_id":"REQ-*"}` |
| `GET /ready` | none | `{"status":"ready","components":{"database":"ready","optimizer":"ready","openai":"degraded","google_routes":"disabled","tdx":"disabled"}}` |
| `POST /api/v1/datasets/import-excel` | `multipart/form-data`, field `file=demo-delivery-40-orders.xlsx` | `201 {"dataset_id":"DS-*","status":"VALIDATED","counts":{"orders":40,"packages":80,"vehicles":4,"zones":5},"total_weight_kg":365.0}` |
| `GET /api/v1/datasets/{dataset_id}` | path `dataset_id=DS-*` | `{"dataset_id":"DS-*","status":"VALIDATED","counts":{"orders":40,"packages":80,"vehicles":4,"zones":5},"total_weight_kg":365.0}` |
| `GET /api/v1/datasets/{dataset_id}/validation` | path `dataset_id=DS-*` | `{"dataset_id":"DS-*","validation":{"is_valid":true,"error_count":0,"warning_count":0,"errors":[],"warnings":[]}}` |
| `POST /api/v1/plans` | `{"dataset_id":"DS-*","algorithm":"ORTOOLS","route_provider_preference":"AUTO","traffic_mode":"AUTO","simulation_seed":20260901}` | `201 {"plan_id":"PLAN-*","version":1,"state":"PROPOSED","algorithm":"ORTOOLS","summary":{"assigned_order_count":40,"assigned_weight_kg":365.0}}` |
| `GET /api/v1/plans/{plan_id}` | optional query `?version=1` | `{"plan_id":"PLAN-*","version":1,"state":"PROPOSED","vehicles":[...],"unassigned_orders":[],"validation":{"valid":true}}` |
| `GET /api/v1/plans/{plan_id}/map-data` | optional query `?version=1` | `{"plan_id":"PLAN-*","version":1,"provider_mode":"SIMULATED","depot":{...},"routes":[...]}` |
| `POST /api/v1/plans/{plan_id}/urgent-insert/preview` | `{"base_plan_version":1,"order":{...},"packages":[...]}` | `200 {"base_version":1,"preview_version":2,"mode":"MINIMAL_CHANGE","diff":{...},"requires_human_confirmation":true}` |
| `POST /api/v1/plans/{plan_id}/confirm` | `{"version":2,"confirmation":"CONFIRM_PLAN","dispatcher_reference":"demo-dispatcher"}` | `200 {"plan_id":"PLAN-*","version":2,"state":"CONFIRMED","audit_event_id":"AUD-*"}` |
| `POST /api/v1/plans/{plan_id}/dispatch` | `{"version":2,"confirmation":"MARK_DISPATCHED"}` | `200 {"plan_id":"PLAN-*","version":2,"state":"DISPATCHED","audit_event_id":"AUD-*"}`; do not call in the demo |
| `POST /api/v1/agent/chat` | `{"session_id":"SESSION-001","message":"為什麼 ORD-032 改派？","context":{"plan_id":"PLAN-*","plan_version":2,"order_id":"ORD-032"}}` | `200 {"message":"...","evidence":[{"tool":"explain_assignment","data":{...}}],"requires_human_confirmation":false}` |
| `GET /api/v1/providers/status` | none | `{"providers":[{"name":"simulated_routes","status":"healthy","mode":"SIMULATED"},...]}` |

The import endpoint is the only multipart route. All other request/response bodies are JSON. For
the complete urgent payload and Plan/Map shapes, copy the examples in `docs/api-contract.md`
rather than inventing fields in the client.

## Three frontend demonstration flows

### 40-order initial schedule

Import the fixed workbook, validate `40/80/4/5` counts and 365 kg, then create the OR-Tools plan.
Render each vehicle's orders, sequence, package/weight totals, utilization, AM/PM legality,
deterministic recommendation reason, and Validator result. Routes start and end at `DEPOT-001`.
The plan is `PROPOSED` and must remain visibly awaiting confirmation.

### Overload redistribution

The fixture deliberately concentrates 112 kg in Z4. `VEH-002` has a 100 kg limit, so the client
must show the legal redistribution to an eligible vehicle such as `VEH-003`, not an overloaded
route and not a silently dropped order. Display the exception/evidence fields if any order is
`UNASSIGNABLE` or has `TIME_WINDOW_CONFLICT`.

### `ORD-041` urgent insertion

Use the initial response's exact `plan_id`, `version=1`, dataset identity, and OR-Tools algorithm
as `base_plan_version`; never rebuild a Baseline “before” plan. Preview is immutable and non-mutating:
it returns `mode=MINIMAL_CHANGE`, before/after algorithm and dataset hash, assigned weight,
unassigned IDs, per-vehicle loads, and a computed diff. The accepted fixture evidence is
365 → 367 kg, existing vehicle moves `0`, only `VEH-003` affected, distance `+137 m`, and time
`+17 s`. Confirm only the returned preview version after human review.

## Agent conversation flow

Send a natural-language question with the plan/order context to `/api/v1/agent/chat`. The Agent may
call the allowlisted deterministic planning/evidence tool, then answers only from its returned
evidence. It must not calculate weights, invent route numbers, confirm, or dispatch. If OpenAI is
unavailable, show `AGENT_UNAVAILABLE` and keep the deterministic REST UI usable.

## Map payload

`GET /map-data` returns:

```json
{
  "plan_id": "PLAN-*", "version": 1, "provider_mode": "SIMULATED",
  "depot": {"depot_id": "DEPOT-001", "latitude": 25.0131533, "longitude": 121.4599675},
  "routes": [{
    "vehicle_id": "VEH-001", "color": "#2563EB", "encoded_polyline": "simulated:...",
    "is_simplified": true,
    "stops": [{"sequence": 1, "order_id": "ORD-001", "latitude": 25.011, "longitude": 121.465, "eta": "2026-09-02T08:24:00+08:00"}],
    "legs": [{"from_sequence": 0, "to_sequence": 1, "distance_m": 3500, "duration_s": 720}]
  }],
  "warnings": [{"code": "SIMULATED_ROUTE_DATA", "message": "非 Google 即時資料。"}]
}
```

Treat `provider_mode=SIMULATED` as a visible “模擬資料” badge; the polyline is not GPS. Google
server credentials and raw provider headers never belong in the browser.

## Errors and exceptions

Branch on the stable `error.code`, display `message`, attach `field_errors` to the relevant form
cell, and retain `request_id` for support:

```json
{
  "error": {
    "code": "DATASET_VALIDATION_FAILED",
    "message": "工作簿驗證失敗。",
    "field_errors": [{"path": "orders[3].location_label", "code": "MISSING_FIELD", "message": "..."}],
    "request_id": "REQ-*",
    "details": {"affected_ids": ["ORD-004"], "retryable": false}
  },
  "request_id": "REQ-*"
}
```

Important codes are `DATASET_VALIDATION_FAILED`, `MANUAL_REVIEW`, `TIME_WINDOW_CONFLICT`,
`UNASSIGNABLE`, `PLAN_NOT_FOUND`, `PLAN_VERSION_CONFLICT`, `PLAN_NOT_CONFIRMABLE`,
`PLAN_ALREADY_DISPATCHED`, `URGENT_ORDER_INVALID`, `URGENT_INSERT_UNASSIGNABLE`,
`AGENT_UNAVAILABLE`, and `LIMIT_REACHED`. Do not retry non-retryable validation/state errors or
invent missing values. A dispatched plan is read-only and cannot accept an urgent insertion.

## API, Swagger, and CORS delivery check

The backend registers and exercises all 13 contract method/path pairs. FastAPI publishes the same
routes in `/openapi.json` and Swagger UI at `/docs`. CORS is an explicit allowlist from
`CORS_ALLOWED_ORIGINS`; set the exact frontend origin(s), never a permanent `*`. A browser
preflight from an allowed origin receives the CORS headers; an unlisted origin must not be treated
as allowed.

## Scope Exclusions

No production deployment, live TMS/ERP/GPS, WebSocket, vehicle-in-motion insertion, depot return for pickup, real fleet control, multi-Agent, A2A, or AP2 is included in this MVP.
