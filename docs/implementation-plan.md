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

## Algorithm and Benchmark Delivery Contract

Implementation order after approval is deliberate:

1. Implement the independent Validator and metric calculator first.
2. Implement deterministic Baseline: stable order sort → First-Fit Eligible Vehicle → time-feasible Nearest Neighbor → explicit unassigned reconciliation.
3. Freeze/version the simulated matrix and record its hash with the 40-order/4-vehicle/5-zone fixture hash.
4. Implement OR-Tools CVRPTW: Capacity/Time Dimensions, allowed vehicles, hard AM/PM windows, lunch break, 180-second service, depot start/end.
5. Lock search parameters: `PARALLEL_CHEAPEST_INSERTION`, `GUIDED_LOCAL_SEARCH`, 10-second `time_limit`, 1,000 `solution_limit`.
6. Run both algorithms on the exact same snapshot and have the same Validator/metric calculator evaluate both.

| Benchmark output | Unit/formula |
|---|---|
| Total distance | meters, sum of fixed-matrix route arcs |
| Total driving time | seconds, sum of fixed-matrix duration arcs |
| Vehicle load/utilization | kg and `planned_load_kg / max_load_kg` per vehicle |
| Utilization gap | max utilization minus min utilization across four vehicles |
| Unassigned | count plus ordered IDs/reasons |
| Violations | overload, cross-zone, duplicate, and time-window counts separately |
| Solve time | monotonic milliseconds around algorithm only; median of five measured runs after one warm-up |
| Improvement | `(baseline - optimized) / baseline * 100`, or `null` when Baseline is zero |

Canonical comparison rejects live Google matrices. Reproducibility requires pinned runtime/OR-Tools, committed fixture and matrix version/hash, integer units, stable entity/node/tie ordering, identical search parameters, a single process, and equal routes/metrics across repeated runs. A wall-clock timeout before the fixed solution limit makes the run non-canonical rather than changing Golden values.

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
2. Implement the shared independent Validator and Benchmark metric calculator.
3. Implement the deterministic First-Fit Eligible Vehicle + Nearest Neighbor Baseline.
4. Implement candidate filtering and the OR-Tools CVRPTW with locked strategies, objective priorities, and bounded solve.
5. Implement explicit no-solution/partial-solution status mapping and unassigned reconciliation.
6. Implement plan/version persistence, plan query, and map-data.
7. Implement order-41 minimum-change preview; warm-start the base routes, then broaden affected routes, and only then emit a labelled `FULL_REPLAN` fallback preview.
8. Add unit/integration/contract tests for every critical invariant and Benchmark formula.

### Verification

- Demo 40 orders total 350–380 kg and satisfies 5×8 / AM20 / PM20.
- Concentrated Z4 demand causes legal redistribution, never overload.
- Baseline and OR-Tools receive byte-identical fixture/matrix identities and use the same Validator.
- Canonical repeated runs produce identical routes and metrics; solve time is reported as a median, not asserted exactly across machines.
- Benchmark reports every required metric and uses `null`, not division-by-zero, for undefined percentage improvements.
- Preview does not mutate base; stale/dispatched operations fail correctly.
- Fixed simulated matrix produces repeatable exact output.

## Day 3 — Agent, providers, observability, demo hardening

### P0 deliverables

1. Implement one OpenAI Agent and the listed strict function tools.
2. Implement evidence-only explanation and tool/prompt-injection guardrails.
3. Add OpenAI tracing configuration, JSON logs, correlation IDs, usage/limit enforcement.
4. Implement Google Routes adapter and field masks; retain default fallback if no key.
5. Implement TDX credential settings, provider health/status, timeout and graceful fallback.
6. Split provider verification into always-on keyless simulated/mock tests and opt-in live integration tests.
7. Make live tests skip when required environment variables are absent; missing/rejected keys may fallback but never fail the keyless suite.
8. Verify no API Key value reaches output, logs, traces, assertions, snapshots, fixtures, or Git.
9. Complete README, frontend handoff, demo script, validation report, and regression run.

The Agents SDK acceptance gate is explicit: run one real `Runner.run` Agent with strict tools and
an `OpenAIResponsesModel` live smoke, plus provider-neutral `ScriptedModel` E2E cases for daily
dispatch, highest-load lookup, unassigned explanation, urgent insertion, missing-data questions,
prompt injection, and evidence-only numeric grounding. The live request remains on `gpt-5-mini`;
Responses tools use top-level `name`/`parameters`/`strict` fields and never the Chat Completions
nested function envelope. A prior HTTP 400 `missing_required_parameter` is retained as a regression
diagnostic, not hidden by a model change.

The API gate counts 13 documented method/path pairs, 13 FastAPI registrations, and 13 exercised
responses. The 40-order demo gate runs import → validation → initial plan → route-provider
fallback → Agent explanation → confirm → order-41 preview/diff and deliberately does not dispatch.
The implemented `src/observability` package writes redacted JSONL trajectory events and enforces
turn/tool/token/wall-clock/repeated-call limits; `docs/openapi-snapshot.sha256` fails closed on
contract drift.

The competition P0 gate additionally requires executable field-level import errors, deterministic
Plan stop recommendations, and a real urgent-insert diff. `tests/test_competition_acceptance.py`
covers the 112 kg Z4 concentration, missing address/weight/time cells, explicit time-window and
capacity exceptions, and independent Validator reconciliation. `scripts/run_p0_demo.py` is the
one-command Chinese walkthrough for the 40-order/4-vehicle fixture; it previews order 41 and
never dispatches or deploys.

Urgent insertion is implemented as a deterministic minimum-change search over legal positions in
eligible existing routes. The preview retains the base plan's algorithm and identity, returns
before/after dataset hashes and assigned weights, and reports `MINIMAL_CHANGE`; `FULL_REPLAN` is
only a validated fallback with explicit scope and moved-order metadata.

### Verification

- OpenAI-off test proves deterministic REST continuity.
- Google/TDX error tests prove explicit fallback/warnings.
- Test collection with zero provider keys passes all keyless tests and marks live tests skipped.
- A credential-output capture and repository scan prove secret values are never emitted or committed.
- Agent Evals prove correct tool routing, evidence grounding, approval boundary, and injection defense.
- Full `pytest`, `ruff`, `mypy`, OpenAPI/endpoint contract, secret scan, Benchmark, and Golden suite
  pass. P0 and the OpenAI Agent remain `IN_PROGRESS` until the implementation gate is explicitly
  closed after reviewing the evidence; passing tests alone do not change that status.
- The final P0 evidence report must include the exact pytest pass/skip count, the three conditional
  skip reasons, competition acceptance names, demo output status, and a clean Git status. Missing
  Browser/TDX credentials remain frontend/P1 conditions and do not convert mock tests into live
  passes.

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
| Time-limited local search drifts across machines | unstable Golden metrics | fixed solution limit/order/matrix; canonical-run qualification; time reported separately |
| Partial solution hides dropped work | unsafe/incomplete dispatch | explicit disjunction reconciliation + shared independent Validator |
| Urgent full reshuffle surprises dispatcher | operational instability | minimum-change tiers; labelled full-replan fallback and before/after diff |
| Missing API Keys fail CI/local work | blocked development | always-on keyless suite; conditional live skip/fallback |
| Agent hallucinated numbers | misleading explanation | evidence schema and Eval; no numeric source in prompt |
| Plan race/stale preview | wrong confirmation | immutable versions + optimistic concurrency |
| Provider cost loop | denial of wallet | quotas, cache, timeouts, retries, Agent step/token limits |

## Stop/Review Checkpoints

- End Day 1: frontend contract review.
- End Day 2: deterministic invariant and state-machine review.
- Before any live key usage: secret restrictions, quota/budget, and provider terms review.
- Before any deployment/Git push: separate Conditional LGTM.
