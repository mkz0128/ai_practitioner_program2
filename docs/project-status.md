# Project Status

## CURRENT PHASE

- 階段：`PHASE_2_FEATURE_IMPLEMENTATION`
- Feature code allowed：`true`
- Required implementation command：`APPROVE_IMPLEMENTATION`
- Backend P0 status（deterministic／simulated 範圍）：`DONE`
- OpenAI Agent status（`Runner.run`／strict-tool runtime）：`DONE`；HTTP integration：`PARTIAL`
- Backend Core（deterministic／simulated 範圍）：`CORE_COMPLETE；LIFECYCLE_PARTIAL`
- Live Provider Integration：`PARTIAL`
- Frontend Integration status：`PARTIAL；LOCAL_CONTROL_TOWER_READY`
- Enterprise Extensions：`PLANNED`
- Overall Project status：`IN_PROGRESS`
- 工作分支：`feat/frontend-control-tower`（不自動合併 `main`）

## 現況查證摘要

下表是依目前 `src/`、`tests/`、API 實作與可重現執行證據核對後的結果；完整十欄工作紀錄見 `docs/requirements.md` 的「現況查證與範圍分類」。

| 項目 | 類別 | 現況 | 實際證據 | 尚缺內容 |
|---|---|---|---|---|
| Excel 匯入與欄位驗證 | 原始必要 | 完成 | `src/services/importer.py`、`tests/test_import_validation.py`、`tests/test_competition_acceptance.py` | 無核心缺口 |
| 包裹件數與單件重量加總 | 原始必要 | 完成 | `Order.total_weight_kg`、import／planning tests | 無核心缺口 |
| 車輛載重與服務區域 | 原始必要 | 完成 | `src/services/planner.py`、`src/services/validator.py`、競賽驗收 | 無核心缺口 |
| OR-Tools 分車與順序 | 原始必要 | 完成（simulated；provider wiring 已具備） | `build_ortools`、`tests/test_planning.py`、`tests/test_live_provider_wiring.py`、Demo | 尚缺 Google live E2E |
| 時段／午休／服務時間／Depot 往返 | 原始必要 | 完成（simulated） | planner／validator time-window tests | 尚未以 live duration 驗證 |
| 獨立 Validator | 原始必要 | 完成 | `src/services/validator.py` 與 planning／competition tests | 無核心缺口 |
| 超重重新分配 | 原始必要 | 完成（固定 Demo） | Z4 112 kg acceptance、Validator evidence | 尚未接入 live provider |
| 臨時插單 Preview 與差異 | 原始必要 | 完成（simulated） | `try_minimal_insert`、`compute_plan_diff`、urgent regression | live route matrix 需 credentials 才能驗證 |
| 人工確認與方案版本管理 | 原始必要 | 部分完成 | API lifecycle tests、SQLite immutable version tests | state mutation 尚未回寫既有 row；缺 restart lifecycle regression |
| OpenAI Agent 真正呼叫 Tool | 原始必要 | 部分完成 | `src/agent/runtime.py`、`tests/test_agent_sdk_scenarios.py`、條件式 live E2E | `/api/v1/agent/chat` 尚未接入 `Runner.run` |
| Google Routes 真實距離／時間 | 原始必要 | 部分完成（Live BLOCKED） | `src/providers/google_routes.py`、strict plan/map wiring、`tests/test_live_provider_wiring.py` | 缺 server key，無 LIVE PASS |
| Google Matrix 進入 OR-Tools | 原始必要 | 部分完成（wiring verified） | `_build_matrix`、matrix hash/version consistency test | 缺實際 Google Matrix live E2E |
| Google Maps Browser 地圖 | 原始必要 | 部分完成（Browser LIVE BLOCKED） | `frontend/src/components/MapPanel.tsx`、RTL/build；無 key 時 simulated fallback | Browser key 與瀏覽器驗收 |
| TDX OAuth／真實路況查詢 | 原始必要 | 部分完成（Live BLOCKED） | `src/providers/tdx.py` OAuth/event models、mock test | TDX credentials 與 live response |
| TDX 路線風險判斷 | 原始必要 | 部分完成（deterministic） | `correlate_events_to_plan`、`map-data.traffic.route_risks` | live event evidence |
| 前端完整操作流程 | 原始必要 | 部分完成（local control tower） | `frontend/`、RTL tests、`docs/frontend-handoff.md` | Browser/live E2E 與完整 provider validation |
| 全整合前後端 Live E2E | 原始必要 | 尚未開始（Live BLOCKED） | keyless／contract／provider mock gates | browser 到真實 provider 的完整證據 |

## NOW

- 在安全且具備相應 credentials 的環境執行 Google／TDX／OpenAI／Browser Live E2E，確認 provider evidence 與前端畫面一致。

## NEXT

1. 在具備 Google server／Browser keys 的環境執行 Live matrix、geometry 與瀏覽器地圖驗收。
2. 在具備 TDX credentials 的環境執行 OAuth、事件與 route-risk Live gate。
3. 執行前後端完整 Live E2E，並確認 HTTP Agent 與 provider evidence。

## BLOCKED

- `REQ-ORIG-004`：TDX Live 查詢需要 `TDX_CLIENT_ID`、`TDX_CLIENT_SECRET` 與服務條款／配額確認；目前僅能執行 adapter/mock 或 `CREDENTIALS_MISSING`。
- `REQ-ORIG-003`：Google Maps Browser Live 畫面需要 Browser key；目前 frontend control tower 可用 simulated fallback。

## OPEN ISSUES

- `EXT-001 — External Provider Issue`：Google Browser key 尚未設定；server key 已設定，而 P0 Benchmark 維持 simulated 與 deterministic。
- `EXT-002 — External Provider Issue`：local environment 尚未設定 TDX credentials；core planning 仍可使用。
- `ENV-001 — Environment Issue`：dependency lock 已在 Windows CPython 3.12 驗證；未來 Linux deployment 前仍需進行 Linux wheel／lock verification。
- `REQ-ORIG-001／002 — External Provider Issue`：Google strict wiring 與 matrix identity tests 已通過，但本環境缺 server key；`provider_mode=SIMULATED` 不等於完整 Live Integration。
- `REQ-ORIG-003／006／007 — Frontend Integration`：local control tower 已建立並通過 typecheck／lint／unit build；Browser key 與真實 provider E2E 尚未完成，這些是原始必要功能，不是 P1。
- `REQ-ORIG-005 — External Provider Issue`：TDX correlation/risk model 已建立，但尚無 live event evidence。
- `CORE-STATE-001 — Code Bug／Persistence`：confirm／dispatch 目前只更新 process 內 state，尚未回寫既有 SQLite plan row；需要可重現的 restart regression 後才能宣稱 durable lifecycle 完成。
- `AGENT-API-001 — Integration`：`/api/v1/agent/chat` 目前使用 evidence-grounded deterministic explanation；`Runner.run` strict-tool runtime 由 provider-neutral／opt-in live gate 驗證，HTTP live Agent E2E 仍待 credentials。
- `AGENT-001 — Regression record`: an earlier Responses request used the Chat Completions nested function envelope and returned HTTP 400 `missing_required_parameter`; correct top-level Responses parameters now pass. Retained as regression evidence; OpenAI Agent is DONE by human acceptance.
- `API-001 — Acceptance`：全部 13 條 contract routes 與 40-order preview flow 通過 automated checks；Demo gate 刻意不執行 dispatch。
- `P0-AC-001 — Competition Acceptance`：field-level import errors、evidence-grounded Plan reasons、計算後的 order-41 diff、overload redistribution 與 independent Validator evidence 均可執行且已人工驗收；Backend P0 為 DONE。
- `P0-URG-002 — Regression`：先前 Demo 將 OR-Tools initial output 與 Baseline preview 比較；修正已完成，aligned OR-Tools regression 通過，ORD-041 使用 `MINIMAL_CHANGE`。

## DONE THIS ROUND

- 完成 `src/`、`tests/`、13 條 API、provider adapter、Agent runtime、SQLite 與既有文件的逐項現況查證；本輪未修改 Feature Code、API、演算法或測試邏輯。
- 將原始必要功能（A 類）、企業級擴充（B 類）與目前暫不處理（C 類）分開記錄，並保留每項工作的 Requirement ID、證據、缺口、前置條件與驗收方式。
- 記錄 Canonical Order Schema、FastAPI／MCP 邊界，以及車輛出發後動態調度的最小變動與人工確認安全流程。
- 校正歷史文件與程式不一致處；本輪後的現況為：Google strict Matrix wiring 已接入、TDX adapter 已擴充、`frontend/` control tower 已建立；HTTP Agent 仍採 evidence path，confirm／dispatch durable persistence 仍不完整。

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
- 記錄人工驗收（歷史 snapshot）：Backend P0 與 OpenAI Agent 為 `DONE`；Frontend Integration 當時為 `PENDING`，現況已更新為 local control tower `PARTIAL`，Overall Project 為 `IN_PROGRESS`。
- 完成 frontend delivery check：clean CPython 3.12.13 venv 安裝 `requirements.lock`，FastAPI 啟動，Swagger／OpenAPI 提供服務，13 條 paths 存在，allowed-origin CORS preflight 回傳設定的 origin。
- 文件化 frontend environment variables、API request／response index、最短串接流程、Demo workbook path、overload／ORD-041／Agent flows、map format 與 error envelope。
- 完成已追蹤文件的繁體中文化與對外內容清理；產品定位統一為可解釋的 AI 配送調度 Copilot，未修改程式、API、演算法或測試邏輯。
- 完成內部排程關鍵字掃描；說明文件與設定未保留不屬於產品的交付規劃描述，技術識別字與程式碼中的既有字串依範圍保留並記錄。
- 建立 `feat/frontend-control-tower` 分支，新增 React／TypeScript／Vite／MUI 控制塔、API client、地圖 fallback、Agent 面板、車輛／例外／urgent diff 畫面與 keyless RTL tests。
- 將 Google Routes strict Matrix 與 route geometry 接入 `AUTO` plan／map-data；已設定 key 但 provider failure 會回傳 `PROVIDER_UNAVAILABLE`，缺 key 才使用明確 `SIMULATED`。
- 將 TDX OAuth、traffic event projection 與 deterministic route-risk correlation 接入 map-data，並以 mock tests 驗證不輸出 token 或 provider payload。
- 以 `tests/test_live_provider_wiring.py` 驗證 provider mode、matrix hash/version consistency、strict error 與 TDX redaction；未呼叫付費 Live API。

## LAST VALIDATION

- 日期：`2026-09-03 Asia/Taipei`
- Credential preflight（本輪 process environment）：OpenAI、Google Routes、Browser、TDX 相關變數均為 `MISSING`；未讀取或記錄任何值。
- Live smoke（歷史紀錄）：先前 OpenAI／Google smoke 結果保留於 regression evidence；本輪未呼叫付費 Live API，TDX／Browser／Google Live gates 維持 `BLOCKED`／`SKIPPED`。
- Dependencies：locked install `PASS`；最新 keyless `pytest` 為 36 passed、3 個 conditional tests skipped（3 個上游 OR-Tools deprecation warnings）；`ruff` `PASS`；`mypy src` `PASS`，涵蓋 27 個 source files。
- Canonical simulated Benchmark：Baseline distance/time `183,955m/23,023s`、2 unassigned；OR-Tools `161,257m/20,185s`、0 unassigned；distance improvement `12.339%`、driving-time improvement `12.327%`、utilization-gap improvement `23.909%`。
- 最新 canonical Benchmark run（10-second solver cap）：兩個方案均有效，overload/cross-zone/duplicate/time-window violations 為零；OR-Tools solve time `5,985.454ms`（僅 wall-clock 指標，不是跨機器 Golden value）。
- Security：`.env`、plaintext source 與 `.venv` 均被忽略；tracked checks `NO`；secret pattern scan `PASS`；GitHub Actions directory `NONE`。
- Git finalization：`feat/frontend-control-tower` 已建立並推送；最新 status commit 為 `9188dcf`，不自動合併 `main`，工作樹乾淨。
- Phase gate：因已取得精確核准，`feature_code_allowed: true`；未執行 deployment、Actions、force push 或 production access。
- Plaintext credential source：已由 Git exclusion 保護並標記可由使用者刪除；從未加入 Git。
- 最新 keyless validation：`36 passed, 3 skipped`；Agents SDK scenarios、API contract `13 defined / 13 implemented / 13 exercised`、OpenAPI snapshot、Demo flow 與 provider wiring 均通過；Playwright local flow `2 passed`，並在 dispatch 前停止。
- Skipped tests 為刻意的條件測試：`test_agents_sdk_daily_dispatch_calls_deterministic_planning_tool` 需要 `RUN_LIVE_AGENT_E2E=1`；`test_live_google_requires_explicit_environment_key` 需要匯出的 Google Routes credential；`test_responses_gpt5_mini_text_and_strict_tool_smoke` 需要 `RUN_LIVE_RESPONSES_SMOKE=1`。
- 最新品質閘門：`ruff check src tests scripts` `PASS`；`mypy src` `PASS`（27 files）；secret scan `PASS`；無 Actions/deploy workflow；本輪提交後 working tree `CLEAN`。
- Responses 診斷：歷史 malformed tool envelope → `BadRequestError`／HTTP 400／`missing_required_parameter`；以 `gpt-5-mini` 修正 top-level `input`、`tools[].name`、`tools[].parameters`、`tools[].strict` 與 `max_output_tokens` 後，direct text 與 strict tool `PASS`；未升級 model。
- 核心功能工程清單：deterministic core、API contract、Agent SDK E2E、observability/cost guard、OpenAPI snapshot 與 Demo flow 均有通過的 automated evidence；人工驗收已記錄，Backend P0 與 OpenAI Agent 為 DONE。
- 競賽核心功能清單：所有 requested executable cases 與一鍵 Demo 均通過；Backend P0 與 OpenAI Agent 依人工驗收為 `DONE`。Frontend Integration 現況為 `PARTIAL`（local control tower）；Overall Project 維持 `IN_PROGRESS`。
- Urgent preview 修正與驗收證據：aligned OR-Tools before/after 為 365 kg → 367 kg、0 → 0 unassigned；`MINIMAL_CHANGE` 僅影響 `VEH-003`，既有訂單換車數為 `0`，距離 `+137 m`、時間 `+17 s`，independent Validator 通過。
- 未執行 Dispatch、deployment 或 production operation。
- 最新前端交付驗證：clean-install/startup `PASS`；Swagger `/docs` `200`；`/openapi.json` `200` 且有 13 paths；CORS preflight `PASS`（`http://localhost:5173`）；Demo workbook path 存在於 `data/samples/demo-delivery-40-orders.xlsx`。
- 最新前端控制塔驗證：`pnpm install --frozen-lockfile`、TypeScript typecheck、ESLint、Vitest `2 passed`、Vite production build 與 Playwright Chromium `2 passed`；已保存 6 張無 secrets 的 local simulated screenshots 於 `docs/screenshots/`。
- 本輪現況查證：Google `AUTO` plan 已具備 strict Matrix → OR-Tools wiring 與 identity regression；本環境無 server key，因此未產生 LIVE PASS，`SIMULATED` 不等於完整 Live Integration。
- 本輪現況查證：TDX 已具備 OAuth／事件 projection／route-risk correlation adapter 與 mock evidence；本環境無 credentials，因此標示 `CREDENTIALS_MISSING`，不等於 Live 完成。
- 本輪現況查證：`frontend/` 控制塔已通過 typecheck、lint、unit tests、production build；Browser key 缺少時顯示 simulated map fallback，完整 browser-to-live-provider E2E 仍未完成。
- 本輪限制：未呼叫付費外部 API、未讀取或輸出任何憑證、未執行 Dispatch／部署／正式環境操作；frontend dependency 與 provider wiring 品質閘門已重新執行。
