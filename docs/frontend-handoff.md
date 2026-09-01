# Frontend Handoff

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

This round defines the contract and workbook fixtures only. No server exists until `APPROVE_IMPLEMENTATION`; sample numeric values in `api-contract.md` illustrate shape and are not generated solver outputs.
