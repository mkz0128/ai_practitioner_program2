# Specification Validation Report

## Snapshot

```yaml
validated_on: 2026-09-01
scope: specification_harness_algorithm_benchmark_contracts_feature_code_and_keyless_tests
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
| Feature gate false | exact pattern and no-`src/` check | Passed |
| Git baseline safety | repository-local identity, empty remote, 26-file secret/action/deployment scan | Passed |
| Algorithm specification coverage | Baseline, CVRPTW dimensions, strategies, limits, partial/failure policy | Passed |
| Fair Benchmark contract | identical fixture/matrix identity, 12 metrics, formulas, reproducibility controls | Passed |
| API Key test layers | always-on keyless, conditional live, missing-key skip/fallback, secret redaction | Passed |
| Golden Dataset extension | JSON parse and GD-013–GD-018 traceability | Passed — 18 total cases |

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
- Keyless suite: `14 passed, 1 skipped (conditional live provider)`; `ruff check src tests`: passed; `mypy src`: passed across 20 source files.
- Canonical simulated run: Baseline `183,955m / 23,023s`, 2 unassigned; OR-Tools `161,257m / 20,185s`, 0 unassigned; no validator violations.
- Live preflight: OpenAI Chat text/strict tool `PASS`; initial Responses request `BadRequestError` (not counted as pass); Google Routes matrix `PASS`; TDX `SKIPPED`.
- Full Agent natural-language orchestration, frontend contract snapshots, and bounded request tracing remain staged follow-up work; no claim is made that they are complete.

## Final Result

Specification/Harness readiness: **PASS**. Implementation gate is open by the explicit `APPROVE_IMPLEMENTATION`; deterministic core and FastAPI first slice are implemented with `feature_code_allowed: true`.
