# Architecture Decision Record

## Decision Summary

Use one FastAPI application with a layered modular monolith, one OpenAI Agent, strict function tools, deterministic domain/validation/optimization services, replaceable external providers, SQLAlchemy/SQLite persistence, and a separate plan validator.

## Logical Layers

```text
Frontend / Swagger client
        |
FastAPI routes + strict request/response schemas
        |
Application services / use cases
   |          |             |
Agent tools   Deterministic  Plan lifecycle
   |          services      + repositories
One Agent     |             |
              +-- import/validation
              +-- OR-Tools optimizer
              +-- independent validator
              +-- evidence + diff builder
              +-- provider interfaces
                    |-- SimulatedRouteProvider (P0 default)
                    |-- GoogleRoutesProvider (optional)
                    |-- SimulatedTrafficProvider
                    |-- TDXTrafficProvider (P0 status; P1 mapping)
```

Dependency direction points inward. Domain, validation, optimizer, and plan validator may not import Agent or provider implementations.

## Planned Source Layout

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

This layout is the approved implementation target; the deterministic core, FastAPI transport,
SQLite repository, strict evidence tools, provider fallback adapters, and restart hydration now
live under `src/`. Observability hardening and the final implementation gate remain tracked work.

## ADR-001 — Single Agent

**Decision:** exactly one OpenAI Agents SDK Agent.

**Reason:** only intent routing and explanation need probabilistic behavior; adding delegation/handoffs creates latency, cost, state, and evaluation surface without MVP value.

**Constraints:** no handoffs, A2A, AP2, or sub-agents inside the product. Each tool has strict Pydantic input/output. The model comes from `OPENAI_MODEL`.

The runtime gate is an actual OpenAI Agents SDK `Agent` executed by `Runner.run`, not a prompt-only
wrapper. Its strict tools are `plan_dispatch`, `highest_load_vehicle`, `explain_unassigned`, and
`preview_urgent_insert`. Every planning tool invokes the deterministic planner and independent
Validator before returning compact JSON evidence. The model may summarize only values present in
that evidence; it may not calculate weights, routes, legality, or metrics.

The keyless SDK E2E suite uses the SDK's `ScriptedModel`, which exercises the real tool dispatch
and guardrail pipeline without network access. The opt-in live gate uses `OpenAIResponsesModel`
with `gpt-5-mini`, `parallel_tool_calls=false`, `max_tokens=2048`, `max_turns=4`, tracing disabled
for sensitive data, and a single planning tool call requirement.

Responses API request shape is locked separately from Chat Completions: `input` and
`max_output_tokens` are top-level fields, and each strict function tool has top-level `name`,
`description`, `parameters`, and `strict`. A nested Chat Completions `function` envelope is invalid
for Responses and is classified as `missing_required_parameter` (HTTP 400), never retried by
changing to a more expensive model. Direct text and strict-tool requests are smoke-tested before
the live Agent gate.

## ADR-002 — Deterministic Core

**Decision:** arithmetic, validation, assignment, route sequencing, time feasibility, state transitions, and evidence data are deterministic.

**Reason:** these are contractual invariants. The LLM cannot be the source of numeric truth.

**Control:** explanations receive structured evidence such as vehicle capacity, planned load, utilization, zone eligibility, incremental distance/duration, time-window slack, and provider mode.

## ADR-003 — Modular Monolith

**Decision:** one deployable FastAPI process for the MVP.

**Reason:** fastest three-day integration, simple transactions and debugging, no distributed-state tax. Provider interfaces retain future extraction options.

## ADR-004 — OR-Tools with Independent Validation

Model an unsplittable capacitated vehicle routing problem with vehicle eligibility and time dimensions:

- node demand = deterministic order total weight;
- allowed vehicles = AVAILABLE ∩ service zone ∩ residual capacity candidate;
- time dimension includes travel and three-minute service;
- AM `[08:00,12:00]`, PM `[13:00,17:00]` hard windows;
- lunch is modeled as non-service interval/route break, not an LLM note;
- depot is start/end for every vehicle;
- objective uses large-priority feasibility penalties/lexicographic passes, then travel, then load-balance tie-break.

After solving, a separate validator recomputes all invariants from domain data. Solver success alone never grants `valid=true`.

### Deterministic Baseline

The Benchmark reference is intentionally simple and is not an optimization fallback:

1. Sort orders by `priority` (`HIGH` first), time-window start, then `order_id`; sort vehicles by `vehicle_id`.
2. **First-Fit Eligible Vehicle** assigns each unsplittable order to the first `AVAILABLE` vehicle that serves its zone and has enough residual capacity, including `current_load_kg`.
3. If the first candidate cannot produce a legal time-feasible route, try the next eligible vehicle in the same stable order.
4. **Nearest Neighbor** sequences each vehicle from `DEPOT-001` using the fixed matrix's `distance_m`; ties use `duration_s`, then `order_id`. Only a next stop that preserves AM/PM, lunch, three-minute service, and depot-return feasibility may be selected.
5. Every route returns to `DEPOT-001`. An order with no legal assignment/sequence is emitted in `unassigned_orders` with a stable reason; it is never omitted.
6. The independent Validator evaluates the Baseline output too. An invalid Baseline is reported as a Benchmark result but can never become a confirmable plan.

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

`PARALLEL_CHEAPEST_INSERTION` is explicit rather than `AUTOMATIC` and constructs a multi-route initial solution by cheapest feasible insertions. `GUIDED_LOCAL_SEARCH` is selected to escape local minima and therefore always receives a finite time limit. The canonical 40-order solve has a 10-second hard cap and a 1,000-solution cap; reaching either returns the best feasible candidate found plus its termination reason.

The Capacity Dimension enforces per-vehicle capacity using deterministic whole-order demand. The Time Dimension uses integer seconds, allows required waiting, enforces arrival/service completion inside AM or PM, reserves the 12:00–13:00 break, includes 180 seconds at each stop, and bounds every route between the depot start/end. Vehicle/zone eligibility is expressed as allowed vehicles for each order node.

Objectives use integer costs and a documented dominating coefficient: dropping one order costs more than the maximum possible travel-plus-balance improvement, total travel time dominates the bounded utilization-gap term, and distance remains a reported metric. Coefficients are derived from the fixed matrix upper bound and recorded with the run, never chosen from live traffic. The independent Validator recomputes assignment uniqueness, no split, capacity, eligibility, time/lunch, depot endpoints, and all metric totals from source data.

### No-solution and Partial-solution Policy

- Pre-validation classifies orders with no eligible vehicle, invalid data, or impossible single-order capacity before solving.
- Solver-optional visits use deterministic high disjunction penalties so the minimum number of orders is dropped before travel optimization. Every dropped node becomes an explicit `unassigned_orders` entry with evidence.
- `ROUTING_FAIL`, `ROUTING_FAIL_TIMEOUT` without a candidate, `ROUTING_INVALID`, and `ROUTING_INFEASIBLE` produce stable errors and no confirmable proposal.
- A time-limited feasible candidate may be returned only with `optimality_proven: false`, solver status/termination metadata, explicit exceptions, and a passing independent Validator.
- A valid partial plan stays `PROPOSED`, sets `complete: false`, lists all unassigned orders, and requires explicit human review; it is never represented as a complete solution.

### Urgent Order 41 Replanning

Default policy is **minimum-change replanning**, not an unrestricted full reshuffle:

1. Start from the exact base plan/version and warm-start from its routes.
2. First try inserting order 41 while preserving existing vehicle assignments and relative stop order.
3. If infeasible, unlock only eligible affected routes and minimize moved-order count and sequence displacement before travel/load tie-breaks.
4. Only if that fails, create a separately labelled `FULL_REPLAN` fallback preview. It must expose scope, moved orders, before/after metrics, and the reason escalation was needed.
5. No preview mutates the base plan; exact plan/version confirmation remains mandatory.

The implementation first evaluates every legal insertion position on every eligible existing
route, keeping all other vehicle assignments and their relative order unchanged. The lowest
deterministic distance/time insertion is returned as `mode: MINIMAL_CHANGE`. Only when no such
candidate passes the independent Validator does the service fall back to the same algorithm's
full replan and return `mode: FULL_REPLAN`, `full_replan_reason`, `affected_vehicle_count`, and
`moved_order_count`.

### P0 Competition Acceptance Controls

The importer emits one `MISSING_REQUIRED_FIELD` error per missing required cell. Paths are
stable and entity-addressable (`orders.<order_id>.location_label`,
`orders.<order_id>.time_slot`, and `packages.<package_id>.weight_kg`), and each such error sets
`requires_manual_review: true`; the validation report carries the aggregate flag as well.

Plan stop `reason` is produced by `src/services/evidence.py` from the validated order, vehicle,
route stop, fixed matrix leg, and independent Validator result. Its evidence includes zone
eligibility, order weight, post-assignment load/utilization, legal time slot, previous node,
distance/duration, and the deterministic sequence basis. The Agent may quote this object only;
it is never a source of numeric values.

Urgent previews use a deterministic plan diff builder. `reassigned_orders`, `sequence_changes`,
and per-vehicle `vehicle_load_changes` are calculated from before/after assignments and route
positions, while distance/time deltas are computed from plan totals. The inserted order itself is
reported as a sequence change when it enters a route, and the base version remains immutable.

## ADR-005 — Fair Benchmark Contract

Baseline and Optimized runs consume the same canonical input snapshot: the same 40 orders, four vehicles, five zones, stable row/entity ordering, `DEPOT-001`, and the same versioned fixed simulated distance/duration matrix. Google live traffic is excluded from fixed Benchmark values; live runs report only invariants and observed ranges and cannot replace the canonical result.

| Metric | Definition |
|---|---|
| Total distance | Sum of fixed-matrix `distance_m` for every depot/stop arc |
| Total driving time | Sum of fixed-matrix `duration_s`; excludes waiting and service |
| Vehicle load/utilization | `current_load_kg + assigned_weight_kg`; utilization is load / max load |
| Utilization gap | Maximum minus minimum utilization across all four vehicles |
| Unassigned orders | Count plus complete ordered IDs/reason codes |
| Violations | Separate overload, cross-zone, duplicate, and time-window counts from Validator |
| Solve time | Monotonic elapsed milliseconds, measured around algorithm execution only |
| Improvement vs Baseline | `(baseline - optimized) / baseline * 100`; lower-is-better metrics only, `null` when Baseline is zero |

Reproducibility controls are: pinned OR-Tools/runtime versions; committed fixture and matrix version/hash; integer meters/seconds/grams; stable order/vehicle/node ordering and tie-breakers; identical search parameters; single-process canonical run; one unmeasured warm-up plus five measured runs; route/metric equality checks across runs; median solve time reported separately and never asserted as an exact cross-machine value. If the 10-second cap fires before the fixed solution limit or route equality fails, the run is marked non-canonical rather than silently updating Golden values.

## ADR-006 — API Key Test Layers

| Layer | Provider behavior | Gate and expected outcome |
|---|---|---|
| Keyless tests | Simulated/mock Google, TDX, and OpenAI adapters | Always runnable; no network or credential dependency; missing keys use fallback and must pass |
| Live integration tests | Explicit live adapter and narrow real request | Run only when that provider's required environment variables exist; otherwise `skip`, never fail |

Tests may check only whether a required variable is present. They may never read a secret into assertions, output it, serialize it, include it in exception text, logs, traces, snapshots, fixtures, or Git. Provider clients must redact authorization headers and query credentials. A missing/rejected key degrades to a stable skip/fallback result according to test layer; it never breaks the keyless suite.

## Runtime Acceptance Gate

The endpoint contract is executable: `tests/test_api_contract.py` extracts all 13 documented
routes, compares method/path pairs against FastAPI's registered routes, and exercises every route
with a safe success or stable error response. The 40-order demo gate then runs import, validation,
initial plan, map/provider fallback, evidence explanation, human confirmation, and order-41
preview/diff. It intentionally stops before dispatch, and asserts that the base plan/version
remains unchanged. These checks are evidence gates, not a declaration that P0 or the Agent is
complete while the implementation phase remains open.

## ADR-007 — Provider Isolation and Fallback

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

`SimulatedRouteProvider` is deterministic and default. Google missing/error/timeouts fall back visibly. TDX is traffic enrichment only. OpenAI outage bypasses only natural-language orchestration.

Google Compute Route Matrix requires a field mask. Planned minimum fields: `originIndex,destinationIndex,status,condition,distanceMeters,duration`; route geometry requests only distance, duration, encoded polyline, and leg fields needed by the frontend. Wildcard masks are forbidden outside manual investigation.

Google caching is transient and configurable (default 900 seconds). Durable storage of raw Google content is disabled until current service terms are reviewed; derived plan records retain provider identity, timestamp, and only fields legally permitted.

## ADR-008 — Persistence and Versioning

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

SQLite transactions protect import and state changes. Confirmation uses optimistic concurrency on `plan_id + version`; stale requests return `PLAN_VERSION_CONFLICT`.

## State Machine

```text
DRAFT -> VALIDATED -> PROPOSED -> CONFIRMED -> DISPATCHED
                      |             |
                      +-- urgent preview creates new PROPOSED version
```

No reverse transition or implicit confirmation. Preview is immutable and side-effect-free. Every accepted/rejected transition writes an audit event.

## Request Flow — Daily Dispatch

1. Import multipart workbook, hash it, parse four sheets.
2. Normalize list fields and validate; persist only controlled records/metadata.
3. Resolve route matrix provider and collect explicit mode/warnings.
4. Build deterministic candidates/model; solve.
5. Recompute invariants in independent validator.
6. Persist immutable PROPOSED version and evidence.
7. Agent or REST returns structured plan; human confirms separately.

## Request Flow — Urgent Insert

1. Load exact base version and require pre-dispatch state.
2. Validate order/packages.
3. Re-optimize against a copy; validate candidate.
4. Persist preview as new version without moving current pointer.
5. Return before/after/diff; explicit confirmation applies exact version.

## Error and Resilience Design

- Domain errors are stable codes, not raw stack traces.
- Provider errors include provider, operation, retryability, fallback mode, and request ID.
- Retries: at most two, only transient/idempotent provider calls, bounded exponential backoff with jitter.
- Agent limits: 8 turns, 12 tool calls, 30k tokens, 120 seconds; repeated same tool+args twice terminates.
- Readiness fails when deterministic core/database is unavailable; optional provider outage appears degraded but does not fail readiness.

## Security

- Strict Pydantic schemas reject unknown fields.
- Workbook/chat/note/provider text is untrusted and cannot issue instructions.
- `.env` and credentials are never read into prompts/logs/traces.
- Browser and Server Google keys are separate; referrer/IP/API restrictions apply.
- CORS is an environment allowlist.
- No real customer PII, production mutation, auto-deploy, or user-impersonated confirmation.

## Official References Reviewed 2026-09-01

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
