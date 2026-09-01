# Requirements and Coverage

This document decomposes the approved product prompt into traceable requirements. `ACTIVE_SPEC.md` remains canonical when wording differs.

## Functional Requirements

| ID | Requirement | Verification |
|---|---|---|
| FR-IMP-001 | Import one `.xlsx` with exactly four named sheets. | Workbook unit tests; import endpoint contract |
| FR-VAL-001 | Validate IDs, relationships, counts, weights, coordinates, zones, slots, vehicle status/load. | Validation suite; GD-003/004/010/011/012 |
| FR-PLAN-001 | Create a deterministic initial 40-order dispatch plan. | Optimizer/validator tests; GD-001 |
| FR-PLAN-002 | Keep all packages for an order on one vehicle. | Invariant test; AC-001 |
| FR-PLAN-003 | Assign an order exactly once or classify it unassigned. | Invariant test; AC-001/003 |
| FR-PLAN-004 | Enforce capacity, availability, and service-zone constraints. | Constraint tests; GD-002/010/012 |
| FR-PLAN-005 | Enforce AM/PM, lunch, three-minute service, and depot start/end. | Time-dimension tests; GD-005 |
| FR-PLAN-006 | Optimize feasibility, travel time/distance, then load balance. | Fixed-matrix objective tests |
| FR-PLAN-007 | Independently validate solver output before confirmability. | Validator mutation/fault-injection tests |
| FR-EXP-001 | Explain assignments only from structured tool evidence. | Agent eval; reason schema tests |
| FR-MAP-001 | Return depot, stops, coordinates, route polyline, color, sequence, ETA, leg metrics. | Map-data response snapshot |
| FR-URG-001 | Preview exactly one pre-dispatch urgent order as a new immutable version. | GD-006; lifecycle tests |
| FR-URG-002 | Return before/after assignment, sequence, distance/time, load, conflict diff. | Preview contract tests |
| FR-URG-003 | Require explicit human confirmation of exact plan/version. | Transition tests; AC-002 |
| FR-URG-004 | Reject automatic insertion after `DISPATCHED`. | GD-007; AC-006 |
| FR-STATE-001 | Persist and audit `DRAFT→VALIDATED→PROPOSED→CONFIRMED→DISPATCHED`. | State-machine tests |
| FR-AGENT-001 | One Agent supports five documented natural-language intents through strict tools. | Tool-routing Evals |
| FR-API-001 | Expose the minimum REST endpoints and usable OpenAPI/Swagger. | OpenAPI snapshot and endpoint integration tests |
| FR-API-002 | Return one stable error envelope with request ID. | Representative 4xx/5xx contract tests |

## Non-functional and Security Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-REL-001 | Core REST works without OpenAI. | OpenAI failure test |
| NFR-REL-002 | Google/TDX failure degrades explicitly without breaking core planning. | GD-009; provider fake tests |
| NFR-SEC-001 | No secrets, PII, full workbook, or chain-of-thought in logs/traces/context/Git. | Redaction tests and repository scan |
| NFR-SEC-002 | CORS origins come from environment; no permanent wildcard. | Settings/ready tests |
| NFR-SEC-003 | Untrusted chat/cells/provider text cannot override guardrails or approval. | GD-008 injection tests |
| NFR-OBS-001 | Correlate request, dataset, plan/version, and Agent run IDs. | Log event schema tests |
| NFR-COST-001 | Enforce turn/tool/token/time/retry/loop limits. | Boundary and limit tests |
| NFR-MNT-001 | Domain/optimizer/validator do not import Agent/LLM modules. | Architecture dependency test |
| NFR-VER-001 | Python/dependencies/models use reviewed locks/config. | Lock consistency and config tests |

## Approved Prompt Coverage

| Formal topic | Feature/decision | Tests | Primary file |
|---|---|---|---|
| Orders/areas/windows/packages/weights | Four-sheet workbook and domain validation | workbook suite | `ACTIVE_SPEC.md` §4 |
| Vehicle max/current load and service zones | Hard candidate and capacity constraints | GD-002/010/012 | `ACTIVE_SPEC.md` §3/5 |
| Explainable assignment/order | Evidence schema plus Agent explanation | Agent evidence Eval | `api-contract.md` |
| Overweight/time conflict/unassignable | Stable exception codes and partial plan | GD-003/005/012 | `api-contract.md` |
| Urgent order 41 | Pre-dispatch versioned preview/diff | GD-006/007 | `urgent-order-insertion.md` |
| Human confirmation | Plan state machine and audit event | lifecycle tests | `guardrails.md` |
| Single Agent | One Agent, no handoff/A2A/AP2 | architecture test | `architecture.md` |
| Deterministic algorithms | Services/function tools; no LLM arithmetic | unit/invariant tests | `developer.md` |
| Depot/zones/vehicles | Fixed reference data | fixture validation | `ACTIVE_SPEC.md` §3 |
| 40 orders/350–380 kg/concentration | Fixed-seed sample | sample audit | demo workbook |
| Working hours/lunch/service time | Hard time dimensions | time tests | `ACTIVE_SPEC.md` §5 |
| Google Routes | Provider interface, field mask, split keys, fallback | provider tests | `architecture.md` |
| TDX | P0 status/fallback, P1 mapping | provider tests | `implementation-plan.md` |
| SQLite | Versioned persistence/audit | repository tests | `architecture.md` |
| REST/OpenAPI/CORS | Contract-first API | snapshot/integration tests | `api-contract.md` |
| Observability/cost | Structured logs, tracing, limits | schema/limit tests | `observability.config` |
| Golden/red team | Twelve concrete cases | Eval runner | `golden-dataset.json` |

## P0 vs P1

### P0 — three-day commitment

Import/validation, fixed demo data, deterministic planning/validator, route/map payload, overload redistribution, urgent preview/version/confirm/dispatch, SQLite, REST/OpenAPI, one Agent/tool layer, provider fallback/status, tests, README, and frontend handoff.

### P1 — only after P0 quality gates

Google live traffic/polylines, real TDX congestion mapping, congestion route-change showcase, and additional animation timeline detail.

## Requirement Change Rule

Any material change must update the Spec ID, affected API schema, Golden case, deterministic tests, migration/rollback impact, and changelog before implementation.
