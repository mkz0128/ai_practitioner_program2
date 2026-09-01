# Project Status

## CURRENT PHASE

- Phase: `PHASE_2_FEATURE_IMPLEMENTATION`
- Feature code allowed: `true`
- Required implementation command: `APPROVE_IMPLEMENTATION`
- P0 status: `IN_PROGRESS — not signed off`
- OpenAI Agent status: `IN_PROGRESS — Responses regression is documented; final gate remains open`

## NOW

- Close the Responses/Agents SDK regression evidence and full API/demo acceptance gate without dispatching.

## NEXT

1. Add frontend handoff fixtures and OpenAPI contract snapshots.
2. Add bounded agent usage metrics and redacted request tracing.
3. Human review of live-provider evidence before closing the implementation gate.

## BLOCKED

- TDX live smoke test is skipped because `TDX_CLIENT_ID` and `TDX_CLIENT_SECRET` are missing; this does not block P0.

## OPEN ISSUES

- `EXT-001 — External Provider Issue`: Google Browser key is not configured; the server key is configured, while P0 Benchmark remains simulated and deterministic.
- `EXT-002 — External Provider Issue`: TDX credentials are not configured in the local environment. Core planning remains available.
- `ENV-001 — Environment Issue`: The dependency lock is verified for Windows CPython 3.12; Linux wheel/lock verification is required before any future Linux deployment.
- `SCOPE-001 — Deferred P1`: Google live geometry/traffic and TDX mapping remain optional; the canonical Benchmark uses simulated data.
- `AGENT-001 — Code Bug`: an earlier Responses request used the Chat Completions nested function envelope and returned HTTP 400 `missing_required_parameter`; correct top-level Responses parameters now pass, but P0/Agent remains open until the regression evidence is reviewed.
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

## LAST VALIDATION

- Date: `2026-09-01 Asia/Taipei`
- Credential preflight: OpenAI model/key and Google Routes server key `CONFIGURED`; Browser key and TDX credentials `MISSING`; values not read or logged.
- Live smoke: OpenAI Chat text and strict tool calls `PASS`; initial Responses smoke returned `BadRequestError` and is not counted as pass. Google Routes matrix `PASS`; TDX `SKIPPED`.
- Dependencies: locked install `PASS`; `pytest` 14 passed, 1 conditional live test skipped (3 upstream OR-Tools deprecation warnings); `ruff` `PASS`; `mypy src` `PASS` across 20 source files.
- Canonical simulated Benchmark: Baseline distance/time `183,955m/23,023s`, 2 unassigned; OR-Tools `161,257m/20,185s`, 0 unassigned; distance improvement `12.339%`, driving-time improvement `12.327%`, utilization-gap improvement `23.909%`.
- Latest canonical Benchmark run (10-second solver cap): both plans valid with zero overload/cross-zone/duplicate/time-window violations; OR-Tools solve time `5,037.672ms` (wall-clock metric only, not a cross-machine Golden value).
- Security: `.env`, plaintext source, and `.venv` ignored; tracked checks `NO`; secret pattern scan `PASS`; GitHub Actions directory `NONE`.
- Git finalization: `origin/main` matched local `HEAD` after the implementation push; tracked working tree is clean.
- Phase gate: `feature_code_allowed: true` because exact approval was received; no deployment, Actions, force push, or production access performed.
- Plaintext credential source: protected by Git exclusion and ready for user deletion; never added to Git.
- Latest keyless validation: `24 passed, 3 skipped`; Agents SDK scenarios `7 passed`; explicit live Agent E2E `1 passed`; direct Responses smoke `1 passed`; API contract `13 defined / 13 implemented / 13 exercised`; demo flow `1 passed` and stopped before dispatch.
- Latest quality gates: `ruff check .` `PASS`; `mypy src` `PASS` (21 files); secret scan `PASS`; no Actions/deploy workflow; commit `c86aec5` pushed to `origin/main`; working tree clean before this status-only update.
- Responses diagnostic: historical malformed tool envelope → `BadRequestError` / HTTP 400 / `missing_required_parameter`; corrected top-level `input`, `tools[].name`, `tools[].parameters`, `tools[].strict`, and `max_output_tokens` with `gpt-5-mini` → direct text and strict tool `PASS`. No model upgrade permitted or used.
