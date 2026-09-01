# Three-Day Implementation Plan

## Gate

No item below begins until the user sends `APPROVE_IMPLEMENTATION`. That command authorizes local Feature Code and local deterministic tests only; dependencies, external services, Git, deployment, and production remain separately governed.

## Per-Round Control Loop

Before each implementation round:

1. Read `spec-driven/ACTIVE_SPEC.md`, `docs/project-status.md`, and `docs/validation-report.md`.
2. Set exactly one primary `NOW` item and at most three `NEXT` items.
3. Classify open work: Requirement Change, Code Bug, Data Issue, External Provider Issue, Architecture Change, or approved delivery work.
4. Requirement/architecture changes require a written impact proposal and human approval; Code Bugs require a reproducing failing test first.
5. Implement and verify the bounded work.
6. Update `DONE THIS ROUND`, `LAST VALIDATION`, `OPEN ISSUES`/`BLOCKED`, and the next `NOW`/`NEXT`.

`docs/project-status.md` is the sole progress ledger; no separate NOW/TODO/DONE files are allowed.

## Day 1 — Contract-first frontend unblock

### P0 deliverables

1. Create package skeleton matching `architecture.md`.
2. Implement strict config and stable API/error envelopes with request ID middleware.
3. Implement domain schemas, SQLAlchemy models/migrations, and repositories.
4. Implement four-sheet importer, `|` normalization, validation report, and field errors.
5. Wire `/health`, `/ready`, dataset import/query/validation, provider status.
6. Publish generated OpenAPI plus sample plan/map/error payloads and CORS setup.
7. Turn the provided workbook template/sample into executable import fixtures.

### Verification

- Workbook validation matrix passes.
- SQLite transaction/import tests pass.
- OpenAPI contains agreed endpoint names/schemas.
- Frontend can mock against documented payloads before solver exists.

### Frontend handoff checkpoint

Provide Swagger URL, OpenAPI JSON, IDs/error conventions, multipart example, plan/map samples, and `provider_mode` display rule.

## Day 2 — Deterministic planning and lifecycle

### P0 deliverables

1. Implement `SimulatedRouteProvider` with fixed seed/matrix and simplified polyline.
2. Implement candidate filtering, OR-Tools model, objective priorities, bounded solve.
3. Implement independent validator and evidence builder.
4. Implement plan/version persistence, plan query, map-data.
5. Implement urgent insertion preview, before/after diff, optimistic confirmation, and dispatch transition.
6. Add unit/integration/contract tests for every critical invariant.

### Verification

- Demo 40 orders total 350–380 kg and satisfies 5×8 / AM20 / PM20.
- Concentrated Z4 demand causes legal redistribution, never overload.
- Preview does not mutate base; stale/dispatched operations fail correctly.
- Fixed simulated matrix produces repeatable exact output.

## Day 3 — Agent, providers, observability, demo hardening

### P0 deliverables

1. Implement one OpenAI Agent and the listed strict function tools.
2. Implement evidence-only explanation and tool/prompt-injection guardrails.
3. Add OpenAI tracing configuration, JSON logs, correlation IDs, usage/limit enforcement.
4. Implement Google Routes adapter and field masks; retain default fallback if no key.
5. Implement TDX credential settings, provider health/status, timeout and graceful fallback.
6. Complete README, frontend handoff, demo script, validation report, and regression run.

### Verification

- OpenAI-off test proves deterministic REST continuity.
- Google/TDX error tests prove explicit fallback/warnings.
- Agent Evals prove correct tool routing, evidence grounding, approval boundary, and injection defense.
- Full `pytest`, `ruff`, `mypy`, OpenAPI snapshot, secret scan, and Golden suite pass.

## P1 — Only if all P0 gates are green

1. Google live traffic routing and polished polyline integration.
2. TDX live road congestion mapping to segments/zones.
3. Reproducible simulated congestion route-change scenario.
4. Additional animation time-axis data.

## File Change Forecast

| Area | Planned purpose |
|---|---|
| `src/api` | routes, schemas, middleware, CORS, error handler |
| `src/domain` | immutable business models and enums |
| `src/services` | import, validation, planning, evidence, diff |
| `src/optimization` | OR-Tools model and independent validator |
| `src/providers` | simulated, Google Routes, TDX adapters |
| `src/repositories` | SQLAlchemy persistence/versioning |
| `src/agent` | single Agent and strict function tools |
| `src/observability` | JSON logging/tracing/metrics/limits |
| `tests` | unit, integration, contract, Evals |
| `alembic` | SQLite schema migrations |

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Three-day scope pressure | incomplete quality | P0 contract-first, P1 hard cut, simulated providers |
| OR-Tools time/lunch modeling error | illegal plan | fixed time fixtures + independent validator |
| External keys absent | demo failure | fallback is default and tested |
| Live traffic nondeterminism | flaky tests | exact simulated tests; live only invariants/ranges |
| Agent hallucinated numbers | misleading explanation | evidence schema and Eval; no numeric source in prompt |
| Plan race/stale preview | wrong confirmation | immutable versions + optimistic concurrency |
| Provider cost loop | denial of wallet | quotas, cache, timeouts, retries, Agent step/token limits |

## Stop/Review Checkpoints

- End Day 1: frontend contract review.
- End Day 2: deterministic invariant and state-machine review.
- Before any live key usage: secret restrictions, quota/budget, and provider terms review.
- Before any deployment/Git push: separate Conditional LGTM.
