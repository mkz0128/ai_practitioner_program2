# Project Status

## CURRENT PHASE

- Phase: `PHASE_2_FEATURE_IMPLEMENTATION`
- Feature code allowed: `true`
- Required implementation command: `APPROVE_IMPLEMENTATION`
- P0 status: `READY_FOR_HUMAN_REVIEW — not DONE`
- OpenAI Agent status: `READY_FOR_HUMAN_REVIEW — not DONE`

## NOW

- Package final P0 evidence for human review; do not dispatch, deploy, or touch production.

## NEXT

1. Human review of P0 and OpenAI Agent evidence before changing either status to DONE.
2. Frontend integration against the documented local API and OpenAPI snapshot.
3. Optional P1 TDX mapping and Google Browser-key work; neither blocks backend P0.

## BLOCKED

- TDX live smoke test is skipped because `TDX_CLIENT_ID` and `TDX_CLIENT_SECRET` are missing; this does not block P0.

## OPEN ISSUES

- `EXT-001 — External Provider Issue`: Google Browser key is not configured; the server key is configured, while P0 Benchmark remains simulated and deterministic.
- `EXT-002 — External Provider Issue`: TDX credentials are not configured in the local environment. Core planning remains available.
- `ENV-001 — Environment Issue`: The dependency lock is verified for Windows CPython 3.12; Linux wheel/lock verification is required before any future Linux deployment.
- `SCOPE-001 — Deferred P1`: Google live geometry/traffic and TDX mapping remain optional; the canonical Benchmark uses simulated data.
- `AGENT-001 — Regression record`: an earlier Responses request used the Chat Completions nested function envelope and returned HTTP 400 `missing_required_parameter`; correct top-level Responses parameters now pass, but P0/Agent remains open until the regression evidence is reviewed.
- `API-001 — Acceptance`: all 13 contract routes and the 40-order preview flow pass automated checks; dispatch was intentionally not executed in the demo gate.

## DONE THIS ROUND

- Accepted the explicit `APPROVE_IMPLEMENTATION` command and opened local Feature Code work only.
- Completed credential preflight without reading or logging values; OpenAI and Google Routes are configured, Browser and TDX are missing.
- Synchronized the phase gate to `PHASE_2_FEATURE_IMPLEMENTATION` / `IMPLEMENTATION_IN_PROGRESS`.
- Received scoped L2 approval for local `.venv` dependency installation.
- Created the project `.venv` and installed all packages from `requirements.lock` with the bundled CPython 3.12 runtime.
- Added deterministic workbook parser, strict domain schemas, package weight aggregation, fixed simulated matrix, Baseline, OR-Tools CVRPTW, independent Validator, Benchmark metrics, and FastAPI health/import/plan/lifecycle/provider endpoints.
- Added keyless import/planning/benchmark/API tests and reproduced then fixed spreadsheet enum coercion under strict validation.
- Created commit `710742fe3da21a8b3863c8aeccf5a2c5d394e343` (`feat: implement deterministic dispatch core`) and pushed it to the sole `origin/main`.
- Added SQLite datasets/plans/audit tables with immutable `(plan_id, version)` rows and repository tests.
- Added urgent-order preview as a non-mutating version 2 flow with validation, diff, and current-version protection.
- Added an allowlisted deterministic `explain_assignment` tool path that returns structured evidence without chain-of-thought or secret context.
- Created commit `6b64f54` (`feat: add persistent versions and urgent previews`) and pushed it to `origin/main`.
- Added Google Routes adapter with strict field mask, timeout, redacted failure categories, and simulated fallback; added TDX P0 status adapter and conditional live-test marker.
- Added SQLite restart hydration with a separate current-version pointer so urgent previews remain immutable after process restart.
- Created commit `3c7170d` (`feat: add provider fallback and restart hydration`) and pushed it to `origin/main`.
- Added a real Agents SDK runtime (`Runner.run`, strict planning/evidence tools, guardrail, and `ScriptedModel` E2E scenarios) including daily dispatch, highest-load, unassigned explanation, urgent preview, missing-data, injection, and no-LLM-math cases.
- Added executable coverage for all documented API paths and a 40-order import → validation → plan → provider fallback → explanation → confirm → order-41 preview/diff flow; the flow stops before dispatch.
- Reproduced the Responses HTTP 400 regression without emitting secrets, corrected the request shape for `gpt-5-mini`, and verified direct text, strict function call, and explicit live Agent E2E behavior.
- Added `src/observability` redacted JSONL trajectory events, correlation/run metadata, fail-closed 8-turn/12-tool/30k-token/120-second/repeated-call budgets, and boundary/redaction tests.
- Added the 13-path OpenAPI SHA-256 snapshot and exact-path regression test; refreshed the frontend handoff with local FastAPI startup and no-dispatch integration guidance.
- Corrected the canonical model documentation to `gpt-5-mini` and preserved the prior Responses schema regression as a tracked issue without changing model tier.
- Implemented redacted JSONL trajectory recording and fail-closed Agent budgets (turn/tool/token/wall-clock/repeated-call) with correlation fields and tests.
- Added OpenAPI SHA-256 snapshot regression coverage and updated frontend handoff with the local FastAPI startup command and no-dispatch integration sequence.

## LAST VALIDATION

- Date: `2026-09-02 Asia/Taipei`
- Credential preflight: OpenAI model/key and Google Routes server key `CONFIGURED`; Browser key and TDX credentials `MISSING`; values not read or logged.
- Live smoke: OpenAI Chat text/strict tool `PASS`; initial malformed Responses request returned `BadRequestError` and is retained as a regression case; corrected Responses text/strict tool `PASS`; Google Routes matrix `PASS`; TDX `SKIPPED`.
- Dependencies: locked install `PASS`; latest keyless `pytest` 28 passed, 3 conditional tests skipped (3 upstream OR-Tools deprecation warnings); `ruff` `PASS`; `mypy src` `PASS` across 24 source files.
- Canonical simulated Benchmark: Baseline distance/time `183,955m/23,023s`, 2 unassigned; OR-Tools `161,257m/20,185s`, 0 unassigned; distance improvement `12.339%`, driving-time improvement `12.327%`, utilization-gap improvement `23.909%`.
- Latest canonical Benchmark run (10-second solver cap): both plans valid with zero overload/cross-zone/duplicate/time-window violations; OR-Tools solve time `5,037.672ms` (wall-clock metric only, not a cross-machine Golden value).
- Security: `.env`, plaintext source, and `.venv` ignored; tracked checks `NO`; secret pattern scan `PASS`; GitHub Actions directory `NONE`.
- Git finalization: `origin/main` matches local `HEAD` after the implementation and status pushes; tracked working tree is clean.
- Phase gate: `feature_code_allowed: true` because exact approval was received; no deployment, Actions, force push, or production access performed.
- Plaintext credential source: protected by Git exclusion and ready for user deletion; never added to Git.
- Latest keyless validation: `28 passed, 3 skipped`; Agents SDK scenarios `7 passed`; explicit live Agent E2E `1 passed`; direct Responses smoke `1 passed`; API contract `13 defined / 13 implemented / 13 exercised`; OpenAPI snapshot `PASS`; demo flow `1 passed` and stopped before dispatch.
- Skipped tests are intentionally conditional: `test_agents_sdk_daily_dispatch_calls_deterministic_planning_tool` requires `RUN_LIVE_AGENT_E2E=1`; `test_google_routes_live_smoke` requires exported Google Routes credentials; `test_responses_gpt5_mini_text_and_strict_tool_smoke` requires `RUN_LIVE_RESPONSES_SMOKE=1`.
- Latest quality gates: `ruff check .` `PASS`; `mypy src` `PASS` (24 files); secret scan `PASS`; no Actions/deploy workflow; commits `fd2399a`, `e6c30a0`, `3bc0f01`, and `c86aec5` pushed to `origin/main`; working tree clean before this status-only update.
- Responses diagnostic: historical malformed tool envelope → `BadRequestError` / HTTP 400 / `missing_required_parameter`; corrected top-level `input`, `tools[].name`, `tools[].parameters`, `tools[].strict`, and `max_output_tokens` with `gpt-5-mini` → direct text and strict tool `PASS`. No model upgrade permitted or used.
- P0 engineering checklist: deterministic core, API contract, Agent SDK E2E, observability/cost guard, OpenAPI snapshot, and demo flow all have passing automated evidence; only human status sign-off remains.
