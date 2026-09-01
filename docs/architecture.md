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

This layout is planned only; `src/` is intentionally absent until `APPROVE_IMPLEMENTATION`.

## ADR-001 — Single Agent

**Decision:** exactly one OpenAI Agents SDK Agent.

**Reason:** only intent routing and explanation need probabilistic behavior; adding delegation/handoffs creates latency, cost, state, and evaluation surface without MVP value.

**Constraints:** no handoffs, A2A, AP2, or sub-agents inside the product. Each tool has strict Pydantic input/output. The model comes from `OPENAI_MODEL`.

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

## ADR-005 — Provider Isolation and Fallback

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

## ADR-006 — Persistence and Versioning

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
