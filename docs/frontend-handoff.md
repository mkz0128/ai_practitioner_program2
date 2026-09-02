# Frontend Handoff

Backend implementation is available locally. After installing CPython 3.12, confirm
`python --version` reports `3.12.x`, then use this clean-checkout sequence from the repository root:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock
$env:CORS_ALLOWED_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"
```

Then start FastAPI:

```powershell
.\.venv\Scripts\python.exe -m uvicorn src.api.main:app --reload --host 127.0.0.1 --port 8000
```

Then open Swagger at `http://127.0.0.1:8000/docs` or use the pinned schema at
`docs/openapi-snapshot.sha256`. The snapshot test fails closed if the 13-route contract changes
without a deliberate update.

## Frontend environment variables

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_GOOGLE_MAPS_BROWSER_API_KEY=
```

The browser key is optional and must be restricted to exact HTTP referrers and the Maps JavaScript
API. The backend allowlist is `CORS_ALLOWED_ORIGINS`; set it to every exact local frontend origin.
Never put `OPENAI_API_KEY`, `GOOGLE_ROUTES_SERVER_API_KEY`, `TDX_CLIENT_ID`, or
`TDX_CLIENT_SECRET` in frontend variables or bundles.

## Demo fixture

Use `data/samples/demo-delivery-40-orders.xlsx` (repository-root relative path). It is the
fictitious four-sheet fixture with 40 orders, 80 packages, 4 vehicles, 5 zones, and 365 kg. The
Chinese no-dispatch walkthrough is:

```powershell
.\.venv\Scripts\python.exe scripts/run_p0_demo.py
```

## What the frontend can rely on

- REST only; no WebSocket.
- Swagger/OpenAPI will be served by FastAPI (`/docs`, `/openapi.json`).
- Plan and preview payloads are versioned and immutable by `plan_id + version`.
- All list fields are JSON arrays.
- Map payload contains depot, ordered stops, legs, vehicle colors, polyline, ETA, and provider warning.
- Animation is a client-side accelerated movement along the returned polyline; it is not GPS.
- Every proposed/preview plan requires human confirmation.

## Recommended frontend sequence

```text
1. POST import-excel
2. GET dataset validation
3. POST plans
4. GET plan and map-data
5. Render vehicles/stops/exceptions/provider badge
6. Optional urgent-insert preview and show diff
7. Human clicks confirm for exact plan/version
8. Optional mark dispatched
```

## Endpoint request/response examples

The backend implements all 13 method/path pairs in `docs/api-contract.md`; the following is the
frontend-sized request/response index. All bodies are JSON except the multipart import.

| Endpoint | Request | Response to handle |
|---|---|---|
| `GET /health` | none | `{"status":"ok","service":"ai-delivery-dispatch-agent","request_id":"REQ-*"}` |
| `GET /ready` | none | `{"status":"ready","components":{...},"request_id":"REQ-*"}` |
| `POST /api/v1/datasets/import-excel` | multipart field `file` (`.xlsx`) | `201 {"dataset_id":"DS-*","status":"VALIDATED","counts":{"orders":40,"packages":80,"vehicles":4,"zones":5},"total_weight_kg":365.0}` |
| `GET /api/v1/datasets/{dataset_id}` | path ID | `{"dataset_id":"DS-*","status":"VALIDATED","counts":{...},"total_weight_kg":365.0}` |
| `GET /api/v1/datasets/{dataset_id}/validation` | path ID | `{"dataset_id":"DS-*","validation":{"is_valid":true,"errors":[],"warnings":[]}}` |
| `POST /api/v1/plans` | `{"dataset_id":"DS-*","algorithm":"ORTOOLS","route_provider_preference":"AUTO","traffic_mode":"AUTO","simulation_seed":20260901}` | `201 {"plan_id":"PLAN-*","version":1,"state":"PROPOSED","summary":{...},"vehicles":[...]}` |
| `GET /api/v1/plans/{plan_id}` | optional `?version=1` | Plan with `algorithm`, `dataset_hash`, `vehicles`, `unassigned_orders`, `validation` |
| `GET /api/v1/plans/{plan_id}/map-data` | optional `?version=1` | Map payload with `depot`, `routes`, `stops`, `legs`, `provider_mode` |
| `POST /api/v1/plans/{plan_id}/urgent-insert/preview` | `{"base_plan_version":1,"order":{...},"packages":[...]}` | `200 {"base_version":1,"preview_version":2,"mode":"MINIMAL_CHANGE","before":{...},"after":{...},"diff":{...}}` |
| `POST /api/v1/plans/{plan_id}/confirm` | `{"version":2,"confirmation":"CONFIRM_PLAN","dispatcher_reference":"frontend-user"}` | `200 {"state":"CONFIRMED","version":2,"audit_event_id":"AUD-*"}` |
| `POST /api/v1/plans/{plan_id}/dispatch` | `{"version":2,"confirmation":"MARK_DISPATCHED"}` | `200 {"state":"DISPATCHED",...}`; never call in the demo |
| `POST /api/v1/agent/chat` | `{"session_id":"SESSION-001","message":"為什麼 ORD-032 改派？","context":{"plan_id":"PLAN-*","plan_version":2,"order_id":"ORD-032"}}` | `200 {"message":"...","evidence":[{"tool":"explain_assignment","data":{...}}]}` |
| `GET /api/v1/providers/status` | none | `{"providers":[{"name":"simulated_routes","status":"healthy","mode":"SIMULATED"},...]}` |

Use the generated [Swagger UI](http://127.0.0.1:8000/docs) or
`http://127.0.0.1:8000/openapi.json` for the exact schema. Do not invent omitted fields.

## Required demo flows

### 40-order initial plan

Call import → validation → `POST /plans` with `algorithm=ORTOOLS` → plan and map queries. The
expected fixture counts are 40 orders / 80 packages / 4 vehicles / 5 zones / 365 kg. Show each
vehicle's orders, package count, load/utilization, stop sequence, evidence-grounded reason, and
independent Validator status. Keep the `PROPOSED` plan visibly awaiting confirmation.

### Overload redistribution

The fixture's Z4 demand totals 112 kg while `VEH-002` allows 100 kg. The UI must show the legal
reassignment to an eligible vehicle (the accepted plan uses `VEH-003`) and never display an
overloaded route as valid or silently drop an order. Surface `UNASSIGNABLE` or
`TIME_WINDOW_CONFLICT` exceptions with their evidence when no legal assignment exists.

### `ORD-041` urgent insertion

Send the exact initial `plan_id`, `base_plan_version=1`, dataset identity, and OR-Tools plan to the
preview endpoint. The backend returns an immutable preview, not a mutation of the base plan. The
accepted result is `mode=MINIMAL_CHANGE`: before 40 orders / 365 kg and loads 93/97/152/23 kg;
after 367 kg; existing order vehicle moves 0; only `VEH-003` changes; distance +137 m; duration
+17 s. Render `reassigned_orders`, `sequence_changes`, `vehicle_load_changes`, and both metric
deltas, then ask for human confirmation of the returned preview version.

### Agent dialogue

Send the user's natural-language question with `plan_id`, `plan_version`, and (for an order
explanation) `order_id`. The Agent invokes only allowlisted deterministic tools and may quote only
their evidence. It cannot calculate a new weight, invent a route, confirm, or dispatch. If the
endpoint returns `AGENT_UNAVAILABLE`, keep all deterministic REST screens available.

## UI state mapping

| API state | Suggested UI |
|---|---|
| DRAFT | importing/processing |
| VALIDATED | dataset valid; ready to plan |
| PROPOSED | plan preview; confirmation CTA enabled only when valid |
| CONFIRMED | approved by dispatcher; dispatch CTA available |
| DISPATCHED | read-only; urgent insertion disabled |

## Provider badges

- `GOOGLE`: Google route data; follow map attribution requirements.
- `TDX`: TDX traffic enrichment.
- `MIXED`: clearly show which fields came from each provider.
- `SIMULATED`: prominent `模擬資料` badge; never say live traffic/ETA.
- `UNAVAILABLE`: show degraded feature, not a fabricated value.

## Vehicle card fields

Display `order_count`, `package_count`, `planned_load_kg`, `max_load_kg`, `load_utilization`, `service_zone_codes`, total distance/time, and exception/warning count.

## Stop fields

Display sequence, location label, AM/PM, ETA, service duration (3 minutes), leg distance/time, order weight, and explanation with expandable evidence.

### Map JSON format

`GET /api/v1/plans/{plan_id}/map-data` returns one depot and one route object per vehicle:

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

`provider_mode=SIMULATED` must show a prominent 模擬資料 badge. The polyline is a deterministic
preview, not GPS; client-side animation must not imply live vehicle tracking.

## Exceptions

Render severity, code, message, affected IDs, and `suggested_actions`. Do not infer a frontend workaround that bypasses the backend validator.

## Urgent insert diff

Show:

- inserted order;
- vehicle reassignments;
- stop sequence changes;
- each vehicle's load/utilization delta;
- total distance/duration delta;
- feasibility, exceptions, provider warnings;
- explicit confirmation of the preview version.

## Error handling

Use `error.code` for branching, `message` for the main notice, `field_errors` next to form/workbook fields, and `request_id` for support. Important cases:

```json
{
  "error": {
    "code": "DATASET_VALIDATION_FAILED",
    "message": "工作簿驗證失敗。",
    "field_errors": [{"path": "orders[3].location_label", "code": "MISSING_FIELD", "message": "欄位不可空白。"}],
    "request_id": "REQ-*",
    "details": {"affected_ids": ["ORD-004"], "retryable": false}
  },
  "request_id": "REQ-*"
}
```

Render every field error beside its order/package/column, preserve `requires_manual_review`, and
do not guess a missing value. Keep partial plans visible only when the response explicitly marks
them partial and reconciles the unassigned orders.

- `DATASET_VALIDATION_FAILED`: display all field errors.
- `TIME_WINDOW_CONFLICT` / `UNASSIGNABLE`: show exception, keep partial plan visible if returned.
- `PLAN_VERSION_CONFLICT`: refresh current version before retry.
- `PLAN_ALREADY_DISPATCHED`: disable insertion and advise manual handling.
- `AGENT_UNAVAILABLE`: keep deterministic REST UI usable.
- `LIMIT_REACHED`: stop automatic retries.

## CORS setup

Backend reads a comma-separated allowlist from `CORS_ALLOWED_ORIGINS`. Frontend must provide its exact development origin, such as `http://localhost:5173`. Do not ask the backend to leave `*` enabled.

## Keys

- Frontend receives only the Google Browser Key, restricted to exact HTTP referrers and Maps JavaScript API.
- Backend Server Key is never sent to the frontend.
- TDX and OpenAI credentials remain backend-only.

## Current integration status

The current local server implements all documented routes. Sample numeric values in
`api-contract.md` illustrate shape; generated solver outputs come from the fixed demo fixture and
are validated independently. The frontend should use `tests/test_demo_flow.py` as the no-dispatch
integration sequence and must never call `/dispatch` without an explicit dispatcher action.
