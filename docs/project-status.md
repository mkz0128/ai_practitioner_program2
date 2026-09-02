# Project Status

## CURRENT PHASE

- 階段：`PHASE_2_FEATURE_IMPLEMENTATION`
- Feature code allowed：`true`
- Required implementation command：`APPROVE_IMPLEMENTATION`
- Backend P0 status：`DONE`
- OpenAI Agent status：`DONE`
- Frontend Integration status：`PENDING`
- Overall Project status：`IN_PROGRESS`

## NOW

- 文件中文化與對外內容清理：掃描已追蹤說明文件、移除內部交付規劃語句並維持既有技術規則；不得修改程式、API、演算法、測試邏輯，不得 P1、dispatch 或 deploy。

## NEXT

1. 依文件化的 local API 與 OpenAPI snapshot 完成 frontend integration。
2. 驗收中文 Demo flow 與 evidence display。
3. Optional P1 TDX mapping 與 Google Browser-key 工作；兩者都不阻塞 backend P0。

## BLOCKED

- TDX live smoke test 因缺少 `TDX_CLIENT_ID` 與 `TDX_CLIENT_SECRET` 而 skip；不阻塞 P0。

## OPEN ISSUES

- `EXT-001 — External Provider Issue`：Google Browser key 尚未設定；server key 已設定，而 P0 Benchmark 維持 simulated 與 deterministic。
- `EXT-002 — External Provider Issue`：local environment 尚未設定 TDX credentials；core planning 仍可使用。
- `ENV-001 — Environment Issue`：dependency lock 已在 Windows CPython 3.12 驗證；未來 Linux deployment 前仍需進行 Linux wheel／lock verification。
- `SCOPE-001 — Deferred P1`：Google live geometry／traffic 與 TDX mapping 為選用能力；canonical Benchmark 使用 simulated data。
- `AGENT-001 — Regression record`: an earlier Responses request used the Chat Completions nested function envelope and returned HTTP 400 `missing_required_parameter`; correct top-level Responses parameters now pass. Retained as regression evidence; OpenAI Agent is DONE by human acceptance.
- `API-001 — Acceptance`：全部 13 條 contract routes 與 40-order preview flow 通過 automated checks；Demo gate 刻意不執行 dispatch。
- `P0-AC-001 — Competition Acceptance`：field-level import errors、evidence-grounded Plan reasons、計算後的 order-41 diff、overload redistribution 與 independent Validator evidence 均可執行且已人工驗收；Backend P0 為 DONE。
- `P0-URG-002 — Regression`：先前 Demo 將 OR-Tools initial output 與 Baseline preview 比較；修正已完成，aligned OR-Tools regression 通過，ORD-041 使用 `MINIMAL_CHANGE`。

## DONE THIS ROUND

- 已接受明確的 `APPROVE_IMPLEMENTATION` 命令，僅開放 local Feature Code 工作。
- 完成 credential preflight，未讀取或記錄任何值；OpenAI 與 Google Routes 已設定，Browser 與 TDX 未設定。
- 將 phase gate 同步為 `PHASE_2_FEATURE_IMPLEMENTATION`／`IMPLEMENTATION_IN_PROGRESS`。
- 取得 local `.venv` dependency installation 的範圍化 L2 核准。
- 建立專案 `.venv`，並以 bundled CPython 3.12 runtime 依 `requirements.lock` 安裝所有套件。
- 新增 deterministic workbook parser、strict domain schemas、package weight aggregation、fixed simulated matrix、Baseline、OR-Tools CVRPTW、independent Validator、Benchmark metrics 與 FastAPI health／import／plan／lifecycle／provider endpoints。
- 新增 keyless import／planning／benchmark／API tests，重現並修正 strict validation 下的 spreadsheet enum coercion。
- 建立 commit `710742fe3da21a8b3863c8aeccf5a2c5d394e343`（`feat: implement deterministic dispatch core`）並推送至唯一的 `origin/main`。
- 新增 SQLite datasets／plans／audit tables、immutable `(plan_id, version)` rows 與 repository tests。
- 新增 non-mutating version 2 urgent-order preview flow、validation、diff 與 current-version protection。
- 新增 allowlisted deterministic `explain_assignment` tool path，回傳不含 chain-of-thought 或 secret context 的 structured evidence。
- 建立 commit `6b64f54`（`feat: add persistent versions and urgent previews`）並推送至 `origin/main`。
- 新增具 strict field mask、timeout、redacted failure categories 與 simulated fallback 的 Google Routes adapter；新增 TDX P0 status adapter 與 conditional live-test marker。
- 新增 SQLite restart hydration 與獨立 current-version pointer，使 urgent previews 在 process restart 後仍保持 immutable。
- 建立 commit `3c7170d`（`feat: add provider fallback and restart hydration`）並推送至 `origin/main`。
- 新增實際的 Agents SDK runtime（`Runner.run`、strict planning／evidence tools、guardrail 與 `ScriptedModel` E2E scenarios），涵蓋 daily dispatch、highest-load、unassigned explanation、urgent preview、missing-data、injection 與 no-LLM-math cases。
- 新增全部文件化 API paths 的 executable coverage，以及 40-order import → validation → plan → provider fallback → explanation → confirm → order-41 preview／diff flow；流程在 dispatch 前停止。
- 在不輸出 secrets 的前提下重現 Responses HTTP 400 regression，修正 `gpt-5-mini` request shape，並驗證 direct text、strict function call 與 explicit live Agent E2E。
- 新增 `src/observability` redacted JSONL trajectory events、correlation／run metadata、fail-closed 8-turn／12-tool／30k-token／120-second／repeated-call budgets 與 boundary／redaction tests。
- 新增 13-path OpenAPI SHA-256 snapshot 與 exact-path regression test；更新 frontend handoff 的 local FastAPI startup 與 no-dispatch integration 說明。
- 將 canonical model 文件修正為 `gpt-5-mini`，並保留既有 Responses schema regression，不變更 model tier。
- 實作 redacted JSONL trajectory recording 與 fail-closed Agent budgets（turn／tool／token／wall-clock／repeated-call），加入 correlation fields 與 tests。
- 新增 OpenAPI SHA-256 snapshot regression coverage，並更新 frontend handoff 的 local FastAPI startup command 與 no-dispatch integration sequence。
- 新增 deterministic field-level workbook errors，缺少 order／package values 與 columns 時傳遞 `requires_manual_review`。
- 新增來自 validated domain／matrix data 的 Plan API evidence-grounded recommendation reasons；不涉及 LLM numeric generation。
- 新增 computed urgent preview diff，涵蓋 reassignment、sequence、per-vehicle load／utilization 與 distance/time deltas。
- 新增 Z4 capacity redistribution、missing fields、time conflicts、all-capacity exhaustion、Validator reconciliation 與 Plan API evidence 的 executable competition acceptance tests。
- 新增 `scripts/run_p0_demo.py`，提供中文 40-order／4-vehicle preview walkthrough，並在 Dispatch／deployment 前停止。
- Golden Dataset 擴充至 GD-026–GD-030，涵蓋 field review、deterministic reasons、urgent diff、Demo 與 Validator gates。
- 修正 Demo，使其建立單一 OR-Tools initial `plan_id/version/dataset`，並以相同 identity 執行 urgent preview。
- 實作 deterministic `MINIMAL_CHANGE` insertion，保留不受影響 vehicle assignments 與相對順序；full replan 現在暴露明確 mode／reason／scope metadata。
- 新增 before／after algorithm、dataset hash、assigned weight、unassigned IDs 與 per-vehicle load evidence，以及防止 Baseline／OR-Tools 交叉比較的 regression test。
- 記錄人工驗收：Backend P0 與 OpenAI Agent 為 `DONE`；Frontend Integration 為 `PENDING`，Overall Project 為 `IN_PROGRESS`。
- 完成 frontend delivery check：clean CPython 3.12.13 venv 安裝 `requirements.lock`，FastAPI 啟動，Swagger／OpenAPI 提供服務，13 條 paths 存在，allowed-origin CORS preflight 回傳設定的 origin。
- 文件化 frontend environment variables、API request／response index、最短串接流程、Demo workbook path、overload／ORD-041／Agent flows、map format 與 error envelope。
- 完成已追蹤文件的繁體中文化與對外內容清理；產品定位統一為可解釋的 AI 配送調度 Copilot，未修改程式、API、演算法或測試邏輯。
- 完成內部排程關鍵字掃描；說明文件與設定未保留不屬於產品的交付規劃描述，技術識別字與程式碼中的既有字串依範圍保留並記錄。

## LAST VALIDATION

- 日期：`2026-09-03 Asia/Taipei`
- Credential preflight：OpenAI model/key 與 Google Routes server key `CONFIGURED`；Browser key 與 TDX credentials `MISSING`；未讀取或記錄值。
- Live smoke：OpenAI Chat text/strict tool `PASS`；初始錯誤 Responses request 回傳 `BadRequestError` 並保留為 regression case；修正後 Responses text/strict tool `PASS`；Google Routes matrix `PASS`；TDX `SKIPPED`。
- Dependencies：locked install `PASS`；最新 keyless `pytest` 為 33 passed、3 個 conditional tests skipped（3 個上游 OR-Tools deprecation warnings）；`ruff` `PASS`；`mypy src` `PASS`，涵蓋 26 個 source files。
- Canonical simulated Benchmark：Baseline distance/time `183,955m/23,023s`、2 unassigned；OR-Tools `161,257m/20,185s`、0 unassigned；distance improvement `12.339%`、driving-time improvement `12.327%`、utilization-gap improvement `23.909%`。
- 最新 canonical Benchmark run（10-second solver cap）：兩個方案均有效，overload/cross-zone/duplicate/time-window violations 為零；OR-Tools solve time `5,985.454ms`（僅 wall-clock 指標，不是跨機器 Golden value）。
- Security：`.env`、plaintext source 與 `.venv` 均被忽略；tracked checks `NO`；secret pattern scan `PASS`；GitHub Actions directory `NONE`。
- Git finalization：實作與 status pushes 後，`origin/main` 與 local `HEAD` 相符；tracked working tree clean。
- Phase gate：因已取得精確核准，`feature_code_allowed: true`；未執行 deployment、Actions、force push 或 production access。
- Plaintext credential source：已由 Git exclusion 保護並標記可由使用者刪除；從未加入 Git。
- 最新 keyless validation：`33 passed, 3 skipped`；Agents SDK scenarios `7 passed`；explicit live Agent E2E `1 passed`；direct Responses smoke `1 passed`；API contract `13 defined / 13 implemented / 13 exercised`；OpenAPI snapshot `PASS`；Demo flow 加 competition acceptance `6 passed`，並在 dispatch 前停止。
- Skipped tests 為刻意的條件測試：`test_agents_sdk_daily_dispatch_calls_deterministic_planning_tool` 需要 `RUN_LIVE_AGENT_E2E=1`；`test_live_google_requires_explicit_environment_key` 需要匯出的 Google Routes credential；`test_responses_gpt5_mini_text_and_strict_tool_smoke` 需要 `RUN_LIVE_RESPONSES_SMOKE=1`。
- 最新品質閘門：`ruff check src tests scripts` `PASS`；`mypy src` `PASS`（26 files）；secret scan `PASS`；無 Actions/deploy workflow；本輪 commit 後 working tree 應維持 clean。
- Responses 診斷：歷史 malformed tool envelope → `BadRequestError`／HTTP 400／`missing_required_parameter`；以 `gpt-5-mini` 修正 top-level `input`、`tools[].name`、`tools[].parameters`、`tools[].strict` 與 `max_output_tokens` 後，direct text 與 strict tool `PASS`；未升級 model。
- 核心功能工程清單：deterministic core、API contract、Agent SDK E2E、observability/cost guard、OpenAPI snapshot 與 Demo flow 均有通過的 automated evidence；人工驗收已記錄，Backend P0 與 OpenAI Agent 為 DONE。
- 競賽核心功能清單：所有 requested executable cases 與一鍵 Demo 均通過；Backend P0 與 OpenAI Agent 依人工驗收為 `DONE`。Frontend Integration 維持 `PENDING`；Overall Project 維持 `IN_PROGRESS`。
- Urgent preview 修正與驗收證據：aligned OR-Tools before/after 為 365 kg → 367 kg、0 → 0 unassigned；`MINIMAL_CHANGE` 僅影響 `VEH-003`，既有訂單換車數為 `0`，距離 `+137 m`、時間 `+17 s`，independent Validator 通過。
- 未執行 Dispatch、deployment 或 production operation。
- 最新前端交付驗證：clean-install/startup `PASS`；Swagger `/docs` `200`；`/openapi.json` `200` 且有 13 paths；CORS preflight `PASS`（`http://localhost:5173`）；Demo workbook path 存在於 `data/samples/demo-delivery-40-orders.xlsx`。
