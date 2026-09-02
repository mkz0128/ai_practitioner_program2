# Specification Validation Report

## Snapshot

```yaml
validated_on: 2026-09-02
scope: specification_harness_algorithm_benchmark_contracts_feature_code_agent_e2e_api_contract_demo_flow_competition_acceptance
feature_code_present: true
implementation_gate: APPROVE_IMPLEMENTATION
implementation_status: phase_2_feature_implementation
git_repository: true
```

## Checks Planned for This Round

| Check | Expected evidence | Status |
|---|---|---|
| Required files exist | path inventory | Passed — 24 required artifacts |
| Golden Dataset JSON parses | JSON parser | Passed |
| Observability config parses | JSON parser (YAML 1.2-compatible JSON syntax) | Passed |
| TOML parses | Python `tomllib` | Passed |
| Direct dependency versions match lock | comparison script | Passed — 16 direct pins |
| Python 3.12 dependency resolution | pip dry-run report | Passed — no install, no conflict |
| Spec/API/Harness terminology | 13-endpoint cross-file checks | Passed |
| Markdown structure | balanced code-fence check across 16 files | Passed |
| Secret patterns | repository text scan | Passed — none detected |
| Workbook sheet/column contract | artifact inspect | Passed — four exact sheets and headers |
| Demo counts and total weight | artifact inspect/calculation | Passed — 40 orders, 80 packages, 4 vehicles, 5 zones, 365 kg |
| Demo distribution | deterministic audit | Passed — AM 20, PM 20, Z4 112 kg |
| Workbook formula errors | artifact match scan | Passed — none detected |
| Workbook visual quality | render/view all 8 sheets, repair, rerender | Passed |
| Feature gate | exact approval recorded; `src/` implementation allowed only after approval | Passed — `APPROVE_IMPLEMENTATION` |
| Git baseline safety | repository-local identity, empty remote, 26-file secret/action/deployment scan | Passed |
| Algorithm specification coverage | Baseline, CVRPTW dimensions, strategies, limits, partial/failure policy | Passed |
| Fair Benchmark contract | identical fixture/matrix identity, 12 metrics, formulas, reproducibility controls | Passed |
| API Key test layers | always-on keyless, conditional live, missing-key skip/fallback, secret redaction | Passed |
| Golden Dataset extension | JSON parse and GD-013–GD-030 traceability | Passed — 30 total cases |
| Responses API parameter diagnostic | `gpt-5-mini` direct text and strict function request; malformed Chat envelope regression | Passed — correct requests PASS; historical HTTP 400 `missing_required_parameter` explained without secret output |
| OpenAI Agents SDK E2E | `Runner.run` + strict deterministic tools + independent Validator + evidence-only final answer | Passed — live opt-in daily dispatch PASS; seven provider-neutral SDK scenarios PASS |
| API contract coverage | Documented method/path pairs vs FastAPI routes and safe response exercise | Passed — 13 defined / 13 implemented / 13 exercised |
| 40-order demo flow | import → validation → plan → provider fallback → explanation → confirm → order 41 preview/diff; no dispatch | Passed — base version remained unchanged |
| Observability and cost guard | Redacted JSONL trajectory events, correlation IDs, fail-closed Agent limits, and regression tests | Passed — `src/observability`, 3 boundary/redaction tests |
| OpenAPI snapshot | Stable hash and exact 13-path set | Passed — `docs/openapi-snapshot.sha256` and snapshot test |
| Competition field errors | Missing address/time/weight cells identify order/package/field and require manual review | Passed — executable acceptance fixture |
| Plan evidence reasons | Every assigned stop contains deterministic zone/weight/load/time/distance evidence | Passed — Plan API acceptance test |
| Urgent preview diff | Reassignment, sequence, load, and metric deltas are calculated from before/after plans | Passed — order-41 demo assertion and diff builder |
| Chinese P0 demo | One command prints 40/4 routes, redistribution, exception, full preview diff, and human checkpoint | Passed — `scripts/run_p0_demo.py` exits 0; no Dispatch/deploy |

## Dependency Resolution Evidence

- Runtime used for resolution: CPython 3.12.13.
- Resolver: pip 26.2.1 `--dry-run --ignore-installed --report`.
- Result: all direct and transitive requirements resolved; no packages installed.
- Lock target: current Windows x86-64 development environment. A separate Linux lock/wheel verification is required before any Linux deployment.

## External Reference Review

- OpenAI official guidance supports Agent orchestration/tool use and current model configuration; model is environment-driven.
- Google Compute Route Matrix requires field masks and exposes status/condition/distance/duration fields.
- Google recommends key restrictions; Browser and Server credentials are split.
- TDX official Swagger describes Client ID/Secret member access and road traffic v2 data services.
- Depot address geocode is recorded with source URL/date in `ACTIVE_SPEC.md`.
- OR-Tools official routing options define explicit first-solution strategies, `GUIDED_LOCAL_SEARCH`, `solution_limit`, `time_limit`, and solver termination statuses.
- OR-Tools official CVRP/VRPTW guidance supports Capacity and Time Dimensions, per-node time-window constraints, waiting slack, and depot-bounded routes.
- OR-Tools official routing-task guidance supports warm-starting from existing routes; the dropped-visits guidance requires explicit penalties and dropped-node reporting.

## Algorithm and Benchmark Specification Verification

| Control | Locked decision | Result |
|---|---|---|
| Baseline | First-Fit Eligible Vehicle + time-feasible Nearest Neighbor | Present in architecture, requirements, plan, and GD-013 |
| Optimized model | OR-Tools CVRPTW with Capacity/Time Dimensions and allowed vehicles | Present |
| Search | `PARALLEL_CHEAPEST_INSERTION` + `GUIDED_LOCAL_SEARCH` | Present |
| Limits | 10-second hard cap + 1,000-solution cap | Present |
| Hard constraints | unsplittable, capacity, zone, AM/PM, lunch, 180-second service, depot return | Present |
| Output trust | independent Validator required for Baseline and Optimized | Present |
| Partial/failure | explicit solver status, unassigned reconciliation, no invalid confirmable plan | Present |
| Urgent order 41 | minimum-change tiers; labelled `FULL_REPLAN` only as fallback preview | Present |
| Fair input | same 40 orders, four vehicles, five zones, depot, and simulated matrix hash | Present |
| Live traffic | excluded from canonical/Golden Benchmark values | Present |
| Reproducibility | pins, hashes, integer units, stable ordering, fixed parameters, run protocol | Present |
| Credentials | keyless always runs; live conditional; secret values never emitted | Present |

## Runtime Verification

- FastAPI import/health/readiness, Excel upload, plan creation, map payload, confirmation, dispatch lifecycle, urgent preview, and structured explanation tests passed.
- Deterministic parser, package aggregation, Baseline, OR-Tools CVRPTW, shared simulated matrix, independent Validator, Benchmark, SQLite repository, urgent preview, structured evidence, and provider fallback tests passed.
- Keyless suite: `33 passed, 3 skipped (conditional Agent/Responses/Google live tests)`; `ruff check src tests scripts`: passed; `mypy src`: passed across 26 source files.
- Agents SDK scenario suite: `7 passed`; explicit live `Runner.run` with `gpt-5-mini`, strict `plan_dispatch`, and Validator: `1 passed`.
- Explicit direct Responses smoke: `1 passed` (text plus strict function call, `gpt-5-mini`; bounded caps 256/512).
- API contract: `13 / 13 / 13` (defined / implemented / exercised); demo flow: `1 passed`, deliberately stopped before dispatch.
- OpenAPI snapshot: exact 13-path set and SHA-256 snapshot matched; redacted observability and `RunBudget` limit tests passed.
- Competition acceptance: Z4's 112 kg is split legally beyond 100 kg VEH-002 (including VEH-003);
  missing `location_label`/`time_slot`/`weight_kg` cells return entity/field paths with manual
  review flags; explicit `TIME_WINDOW_CONFLICT` and `UNASSIGNABLE` cases reconcile through the
  independent Validator; order 41 produces non-empty sequence/load changes and computed deltas.
- Demo command: `.venv\\Scripts\\python.exe scripts/run_p0_demo.py` completed successfully and
  printed Chinese per-vehicle order/weight/utilization/reason evidence, redistribution, exception,
  full preview diff, and a human-confirmation prompt; Dispatch and deployment were not invoked.
- Canonical simulated run (10-second cap): Baseline `183,955m / 23,023s`, 2 unassigned; OR-Tools `161,257m / 20,185s`, 0 unassigned; no validator violations; measured OR-Tools solve time is reported only, not as an exact cross-machine criterion.
- Live preflight: OpenAI Chat text/strict tool `PASS`; Google Routes matrix `PASS`; TDX `SKIPPED` (P1). A deliberately malformed Responses tool envelope reproduced HTTP 400 `missing_required_parameter`; correct `input`, top-level `tools`, `strict`, and `max_output_tokens` requests now pass with `gpt-5-mini`. No key, header, or full request was emitted.
- Browser key remains a frontend concern and is missing; Google server fallback remains explicit. Remaining work is human review of the evidence and any frontend acceptance; no claim is made that P0 or the OpenAI Agent is complete.

## Final Result

Specification/Harness readiness: **PASS**. Implementation gate is open by the explicit `APPROVE_IMPLEMENTATION`; deterministic core and FastAPI first slice are implemented with `feature_code_allowed: true`. All currently actionable P0 engineering checks pass. P0 and the OpenAI Agent remain **READY_FOR_HUMAN_REVIEW / not DONE** pending explicit status sign-off and frontend acceptance; no dispatch or deployment was performed.
