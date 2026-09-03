# Project Status

## CURRENT PHASE

- 階段：`PHASE_2_FEATURE_IMPLEMENTATION`
- Feature code allowed：`true`
- Required implementation command：`APPROVE_IMPLEMENTATION`
- Backend P0 status（deterministic／simulated 範圍）：`DONE`
- OpenAI Agent status（`Runner.run`／strict-tool runtime）：`DONE`；HTTP integration：`LIVE_PASS`
- Backend Core（deterministic／simulated 範圍）：`CORE_COMPLETE；LIFECYCLE_PARTIAL`
- Live Provider Integration：`GOOGLE_LIVE；BROWSER_LIVE；TDX_OPTIONAL_NOT_CONFIGURED`
- Frontend Integration status：`LIVE_CONTROL_TOWER_VERIFIED`
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
| OR-Tools 分車與順序 | 原始必要 | 完成（Google live Matrix 已接入） | `build_ortools`、`tests/test_planning.py`、`tests/test_live_provider_wiring.py`、本輪 Live flow | Browser／TDX 尚未完成 |
| 時段／午休／服務時間／Depot 往返 | 原始必要 | 完成（simulated） | planner／validator time-window tests | 尚未以 live duration 驗證 |
| 獨立 Validator | 原始必要 | 完成 | `src/services/validator.py` 與 planning／competition tests | 無核心缺口 |
| 超重重新分配 | 原始必要 | 完成（Google live Matrix） | Z4 112 kg acceptance、Validator evidence、本輪 Live plan | 無核心缺口 |
| 臨時插單 Preview 與差異 | 原始必要 | 完成（Google live Matrix；Browser／TDX 待補） | `try_minimal_insert`、`compute_plan_diff`、本輪 ORD-041 Live preview | Browser／TDX 顯示仍待憑證 |
| 人工確認與方案版本管理 | 原始必要 | 部分完成 | API lifecycle tests、SQLite immutable version tests | state mutation 尚未回寫既有 row；缺 restart lifecycle regression |
| OpenAI Agent 真正呼叫 Tool | 原始必要 | 完成（Live PASS） | `src/agent/runtime.py`、`/api/v1/agent/chat`、本輪 `RunResult`／strict tool evidence | 無核心缺口 |
| Google Routes 真實距離／時間 | 原始必要 | 完成（Live PASS） | `src/providers/google_routes.py`、本輪 `provider_mode=GOOGLE` Matrix／geometry | Browser key 另屬前端缺口 |
| Google Matrix 進入 OR-Tools | 原始必要 | 完成（Live PASS） | `_build_matrix`、matrix hash/version、一致的 OR-Tools plan 與 Validator | 無核心缺口 |
| Google Maps Browser 地圖 | 原始必要 | 完成（Browser LIVE PASS） | `frontend/src/components/MapPanel.tsx`、Playwright Live；臺北道路、Marker 與 Google geometry | 無核心缺口 |
| TDX OAuth／真實路況查詢 | 原始必要 | 部分完成（Live BLOCKED） | `src/providers/tdx.py` OAuth/event models、mock test | TDX credentials 與 live response |
| TDX 路線風險判斷 | 原始必要 | 部分完成（deterministic） | `correlate_events_to_plan`、`map-data.traffic.route_risks` | live event evidence |
| 前端完整操作流程 | 原始必要 | 完成（Live Playwright PASS） | `frontend/tests/e2e/live-control-tower.spec.ts`、七張 1440×900 截圖 | TDX 為可選外部依賴 |
| 全整合前後端 Live E2E | 原始必要 | 完成（TDX 排除於本輪） | Excel → Google Matrix → OR-Tools → Map → Agent → ORD-041 → confirm | TDX credentials 尚未設定 |

## NOW

- 完成 AI 調度單次附件＋文字對話流程的交付驗證；維持既有地圖、Provider 與排程核心，不執行 Dispatch／部署。

## NEXT

1. 在具備 TDX credentials 的環境執行 OAuth、事件與 route-risk Live gate。
2. 由前端團隊依 `docs/frontend-handoff.md` 進行日常維護與使用者驗收。
3. 評估是否啟用企業級擴充功能。

## BLOCKED

- `REQ-ORIG-004`：TDX Live 查詢需要 `TDX_CLIENT_ID`、`TDX_CLIENT_SECRET` 與服務條款／配額確認；目前僅能執行 adapter/mock 或 `CREDENTIALS_MISSING`。
- `REQ-ORIG-003`：已以 Browser key 完成 Google Maps Live 瀏覽器驗收；無 key 的環境仍保留明確 simulated fallback。

## OPEN ISSUES

- `EXT-001 — Resolved`：Google Browser key 已設定並通過 Live Playwright；P0 Benchmark 仍固定使用 simulated matrix 以維持可重現。
- `EXT-002 — External Provider Issue`：local environment 尚未設定 TDX credentials；core planning 仍可使用。
- `ENV-001 — Environment Issue`：dependency lock 已在 Windows CPython 3.12 驗證；未來 Linux deployment 前仍需進行 Linux wheel／lock verification。
- `REQ-ORIG-001／002 — External Provider Issue`：本輪 Google server Matrix、geometry 與 OR-Tools 同次求解為 Live PASS；後續仍需保留 quota／錯誤監控。
- `REQ-ORIG-003／006／007 — Frontend Integration`：控制塔已通過 typecheck／lint／unit build 與 Live Playwright；TDX 仍為可選外部依賴，這些是原始必要功能，不是 P1。
- `REQ-ORIG-005 — External Provider Issue`：TDX correlation/risk model 已建立，但尚無 live event evidence。
- `CORE-STATE-001 — Code Bug／Persistence`：confirm／dispatch 目前只更新 process 內 state，尚未回寫既有 SQLite plan row；需要可重現的 restart regression 後才能宣稱 durable lifecycle 完成。
- `AGENT-API-001 — Integration`：`/api/v1/agent/chat` 已使用 `Runner.run` 與 strict tools；本輪 HTTP Live Agent 回傳 `RunResult`、`explain_assignment` evidence。後續僅需持續維護模型／配額監控。
- `AGENT-001 — Regression record`: an earlier Responses request used the Chat Completions nested function envelope and returned HTTP 400 `missing_required_parameter`; correct top-level Responses parameters now pass. Retained as regression evidence; OpenAI Agent is DONE by human acceptance.
- `API-001 — Acceptance`：全部 13 條 contract routes 與 40-order preview flow 通過 automated checks；Demo gate 刻意不執行 dispatch。
- `P0-AC-001 — Competition Acceptance`：field-level import errors、evidence-grounded Plan reasons、計算後的 order-41 diff、overload redistribution 與 independent Validator evidence 均可執行且已人工驗收；Backend P0 為 DONE。
- `P0-URG-002 — Regression`：先前 Demo 將 OR-Tools initial output 與 Baseline preview 比較；修正已完成，aligned OR-Tools regression 通過，ORD-041 使用 `MINIMAL_CHANGE`。

- `LIVE-UI-001 — Live Integration`：Browser key 已載入 Vite；真實 Google Maps 顯示臺北道路、DEPOT-001、40 個 Marker 與四條 Google geometry；Agent／ORD-041／人工確認與兩個前端工作區均由 Playwright 通過，未產生 Dispatch request。

## DONE THIS ROUND

- 完成 `src/`、`tests/`、13 條 API、provider adapter、Agent runtime、SQLite 與既有文件的逐項現況查證；本輪未修改 Feature Code、API、演算法或測試邏輯。
- 將原始必要功能（A 類）、企業級擴充（B 類）與目前暫不處理（C 類）分開記錄，並保留每項工作的 Requirement ID、證據、缺口、前置條件與驗收方式。
- 記錄 Canonical Order Schema、FastAPI／MCP 邊界，以及車輛出發後動態調度的最小變動與人工確認安全流程。
- 校正歷史文件與程式不一致處；本輪後的現況為：Google strict Matrix／geometry 已完成 Live wiring、`/api/v1/agent/chat` 已使用 `Runner.run`、TDX adapter 與 `frontend/` control tower 已保留；confirm／dispatch durable persistence 仍不完整。

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
- 記錄人工驗收（歷史 snapshot）：Backend P0 與 OpenAI Agent 為 `DONE`；Frontend Integration 當時為 `PENDING`。本輪最新狀態為 `LIVE_CONTROL_TOWER_VERIFIED`，Overall Project 仍為 `IN_PROGRESS`。
- 完成 frontend delivery check：clean CPython 3.12.13 venv 安裝 `requirements.lock`，FastAPI 啟動，Swagger／OpenAPI 提供服務，13 條 paths 存在，allowed-origin CORS preflight 回傳設定的 origin。
- 文件化 frontend environment variables、API request／response index、最短串接流程、Demo workbook path、overload／ORD-041／Agent flows、map format 與 error envelope。
- 完成已追蹤文件的繁體中文化與對外內容清理；產品定位統一為可解釋的 AI 配送調度 Copilot，未修改程式、API、演算法或測試邏輯。
- 完成內部排程關鍵字掃描；說明文件與設定未保留不屬於產品的交付規劃描述，技術識別字與程式碼中的既有字串依範圍保留並記錄。
- 建立 `feat/frontend-control-tower` 分支，新增 React／TypeScript／Vite／MUI 控制塔、API client、地圖 fallback、Agent 面板、車輛／例外／urgent diff 畫面與 keyless RTL tests。
- 將 Google Routes strict Matrix 與 route geometry 接入 `AUTO` plan／map-data；已設定 key 但 provider failure 會回傳 `PROVIDER_UNAVAILABLE`，缺 key 才使用明確 `SIMULATED`。
- 將 TDX OAuth、traffic event projection 與 deterministic route-risk correlation 接入 map-data，並以 mock tests 驗證不輸出 token 或 provider payload。
- 以 `tests/test_live_provider_wiring.py` 驗證 provider mode、matrix hash/version consistency、strict error 與 TDX redaction；本輪另完成真實 Google／OpenAI Live flow，未輸出任何 credential。
- 修正 `/api/v1/agent/chat` 使用 `Runner.run` 與 strict `explain_assignment` evidence，並以 bounded Google Matrix cache／incremental extension 避免 ORD-041 重複取得完整矩陣。
- 修正 Browser key 缺少時的地圖標示，並將 Playwright Agent 等待時間調整為符合真實 Runner latency。
- 依附件 A／B 的企業物流產品視覺方向完成前端 UX 重整：新增窄版圖示導覽、精簡工具列、淺灰背景、白色面板、KPI 卡片、狀態標籤與黑色主要操作按鈕。
- 建立三個可切換的前端工作區：AI 調度（聊天＋地圖）、配送任務（搜尋表格＋訂單詳情）與路線追蹤（大面積地圖＋右側任務清單）。所有資料仍來自既有 API，未新增後端或企業級功能。
- 將 Agent 證據與插單差異改為白話摘要與比較卡片，移除主要畫面的 Raw JSON、provider 技術代碼與內部模式代碼；必要的模式值仍保留在收合證據與後端驗收資料中，並保留人工確認邊界。
- 建立 `Sidebar`、`TaskTable`、`OrderDetailPanel` 與 `RouteTaskList` 元件，並讓地圖、車輛、訂單選取可同步高亮。
- 完成 1440×900 視覺檢查截圖：`C:\Users\User\AppData\Local\Temp\ai-dispatch-redesign-1440x900.png`、`ai-dispatch-redesign-imported-1440x900.png`、`ai-dispatch-redesign-tasks-1440x900.png`、`ai-dispatch-redesign-tracking-1440x900.png`；Browser key 缺少時明確顯示示意路線，未宣稱 Google Maps Live。

## LAST VALIDATION

- 日期：`2026-09-04 Asia/Taipei`
- Credential preflight（早期 keyless process environment 歷史紀錄）：當時未匯出 OpenAI、Google Routes、Browser、TDX 變數；最新 Live process 已安全載入 OpenAI、Google Routes 與 Browser，TDX 仍為可選未設定，且未讀取或記錄任何值。
- Live smoke（前次環境紀錄）：OpenAI Agent、Responses strict tool 與 Google Routes Matrix／geometry 為 `LIVE PASS`；Browser／TDX 當時因 credentials 缺少而 `BLOCKED`。本輪 Browser 已完成 Live，TDX 為可選未設定。
- Dependencies：locked install `PASS`；最新 keyless `pytest` 為 36 passed、3 個 conditional tests skipped（3 個上游 OR-Tools deprecation warnings）；`ruff` `PASS`；`mypy src` `PASS`，涵蓋 27 個 source files。
- Canonical simulated Benchmark：Baseline distance/time `183,955m/23,023s`、2 unassigned；OR-Tools `161,257m/20,185s`、0 unassigned；distance improvement `12.339%`、driving-time improvement `12.327%`、utilization-gap improvement `23.909%`。
- 最新 canonical Benchmark run（10-second solver cap）：兩個方案均有效，overload/cross-zone/duplicate/time-window violations 為零；OR-Tools solve time `5,985.454ms`（僅 wall-clock 指標，不是跨機器 Golden value）。
- Security：`.env`、plaintext source 與 `.venv` 均被忽略；tracked checks `NO`；secret pattern scan `PASS`；GitHub Actions directory `NONE`。
- Git finalization：`feat/frontend-control-tower` 已建立並推送；本輪 status commits 均已同步至 origin，不自動合併 `main`，工作樹乾淨。
- Phase gate：因已取得精確核准，`feature_code_allowed: true`；未執行 deployment、Actions、force push 或 production access。
- Plaintext credential source：已由 Git exclusion 保護並標記可由使用者刪除；從未加入 Git。
- 最新 keyless validation：`36 passed, 3 skipped`；條件式 OpenAI／Responses／Google Live gate `5 passed`；Agents SDK scenarios、API contract `13 defined / 13 implemented / 13 exercised`、OpenAPI snapshot、Demo flow 與 provider wiring 均通過；Playwright regression `2 passed`，並在 dispatch 前停止。
- Skipped tests 為刻意的條件測試：`test_agents_sdk_daily_dispatch_calls_deterministic_planning_tool` 需要 `RUN_LIVE_AGENT_E2E=1`；`test_live_google_requires_explicit_environment_key` 需要匯出的 Google Routes credential；`test_responses_gpt5_mini_text_and_strict_tool_smoke` 需要 `RUN_LIVE_RESPONSES_SMOKE=1`。
- 最新品質閘門：`ruff check src tests scripts` `PASS`；`mypy src` `PASS`（27 files）；secret scan `PASS`；無 Actions/deploy workflow；本輪提交後 working tree `CLEAN`。
- Responses 診斷：歷史 malformed tool envelope → `BadRequestError`／HTTP 400／`missing_required_parameter`；以 `gpt-5-mini` 修正 top-level `input`、`tools[].name`、`tools[].parameters`、`tools[].strict` 與 `max_output_tokens` 後，direct text 與 strict tool `PASS`；未升級 model。
- 核心功能工程清單：deterministic core、API contract、Agent SDK E2E、observability/cost guard、OpenAPI snapshot 與 Demo flow 均有通過的 automated evidence；人工驗收已記錄，Backend P0 與 OpenAI Agent 為 DONE。
- 競賽核心功能清單：所有 requested executable cases 與一鍵 Demo 均通過；Backend P0、OpenAI Agent 與本輪前端 Live 控制塔均通過驗收。TDX 為可選依賴；Overall 維持 `IN_PROGRESS`。
- Urgent preview 修正與驗收證據：aligned OR-Tools before/after 為 365 kg → 367 kg、0 → 0 unassigned；`MINIMAL_CHANGE` 僅影響 `VEH-003`，既有訂單換車數為 `0`，距離 `+137 m`、時間 `+17 s`，independent Validator 通過。
- 未執行 Dispatch、deployment 或 production operation。
- 最新前端交付驗證：clean-install/startup `PASS`；Swagger `/docs` `200`；`/openapi.json` `200` 且有 13 paths；CORS preflight `PASS`（`http://localhost:5173`）；Demo workbook path 存在於 `data/samples/demo-delivery-40-orders.xlsx`。
- 最新前端控制塔驗證：`pnpm install --frozen-lockfile`、TypeScript typecheck、ESLint、Vitest `2 passed`、Vite production build 與 Playwright Chromium regression `2 passed`；另有 Live Playwright `1 passed`，已保存 7 張無 secrets 的 1440×900 screenshots 於 `docs/screenshots/live-*.png`。
- 本輪 Live flow：40 單 Excel 匯入 → 驗證 → Google Routes 41×41 Matrix → OR-Tools → Validator → Google geometry → OpenAI `Runner.run`／strict tool → ORD-041 incremental Matrix preview → `MINIMAL_CHANGE` → 人工確認；全程未執行 Dispatch／部署。計畫與 preview 均未使用 simulated fallback。
- 本輪 Google evidence：`provider_mode=GOOGLE`、`matrix_version=google-routes-v1`、40/40 assigned、365 kg、Validator `valid=true`；Map data 四條路線均為非 simulated geometry。插單前後 365 kg → 367 kg、0 → 0 unassigned，僅影響單一車輛，距離與時間差異由真實 Matrix 計算。
- 本輪 OpenAI evidence：`/api/v1/agent/chat` 回傳 `runner_result_type=RunResult`、tool `explain_assignment`、`tool_calls=1`；回答只引用工具證據。
- 本輪 Browser：`VITE_GOOGLE_MAPS_BROWSER_API_KEY` 已載入並通過 Google Maps Live 瀏覽器驗收；TDX credentials 未設定，標示 `OPTIONAL／NOT_CONFIGURED`，不以 fallback／mock／skipped 宣稱 LIVE PASS。
- 本輪 screenshot：已擷取真實 Google 地圖、Agent evidence、ORD-041 差異、人工確認、配送任務與配送路線畫面；未輸出或提交任何 key。
- 本輪現況查證：TDX 已具備 OAuth／事件 projection／route-risk correlation adapter 與 mock evidence；本環境無 credentials，因此標示 `CREDENTIALS_MISSING`，不等於 Live 完成。
- 本輪現況查證：`frontend/` 控制塔已通過 typecheck、lint、unit tests、production build 與完整 browser-to-live-provider E2E；無 Browser key 的環境仍顯示明確 simulated fallback。
- 本輪限制：未輸出或提交任何憑證、未執行 Dispatch／部署／正式環境操作；TDX 因缺少 credentials 維持 `OPTIONAL／NOT_CONFIGURED`。
- 本輪最新測試：Frontend TypeScript `PASS`、ESLint `PASS`、Vitest `2 passed`、Vite build `PASS`；Backend `pytest 36 passed, 3 conditional skipped`、`ruff check . PASS`、`mypy src PASS`；Live Playwright `1 passed`（真實 OpenAI／Google、停止回覆與 console error gate）。
- 本輪截圖：`docs/screenshots/chat-composer-empty.png`（簡潔初始對話）、`docs/screenshots/chat-composer-attached.png`（附件尚未送出）、`docs/screenshots/chat-composer-completed.png`（單次送出後的 Agent 回覆與真實地圖），均為 1440×900 且未含 secrets。
- 前一輪 Commit：`7185ba97ef66c449ce6eed81d8225207dd7673b0`，已推送至 `origin/feat/frontend-control-tower`；本輪視覺重整另建立新 Commit。
- 本輪前端視覺重整品質閘門：TypeScript typecheck `PASS`；ESLint `PASS`；Vitest `2 passed`；Vite production build `PASS`；Playwright Chromium `2 passed`（local simulated，未執行 Dispatch）。
- 本輪視覺驗收：1440×900 Live 截圖已檢查，版面符合附件 A／B 的淺色企業物流風格；Google Maps 顯示真實臺北道路、控制項、Marker 與彩色 Polyline。
- 本輪安全檢查：未輸出或提交任何 API Key，未修改 API／演算法／測試邏輯，未執行 Dispatch、部署或正式環境操作。

- 本輪最新 Live 驗證：`OPENAI_API_KEY`、`GOOGLE_ROUTES_SERVER_API_KEY`、`VITE_GOOGLE_MAPS_BROWSER_API_KEY` 均為 `CONFIGURED`（只回報狀態，未輸出值）；OpenAI Agent、Google Routes → OR-Tools、Google Maps Browser、Excel、Agent 多輪、ORD-041、人工確認與完整 Chat＋Map Playwright 均 `LIVE PASS`。TDX 為 `OPTIONAL／NOT_CONFIGURED`。
- 本輪新增 `frontend/tests/e2e/live-control-tower.spec.ts`，七張 1440×900 截圖位於 `docs/screenshots/live-*.png`；測試包含任務頁、路線頁、車輛篩選，並確認 Dispatch request 為 0。
- 本輪程式修正：無資料 `/api/v1/agent/chat` 改為真正呼叫 strict `assistant_help`；ORD-041 Agent tool 改用同一基準 plan 的 deterministic `MINIMAL_CHANGE` 與完整 diff evidence；前端聊天 preview 以 Agent evidence 驅動後續 immutable preview；主畫面來源標籤改為白話文字。
- 本輪前端對話體驗：AI 調度改為可直接輸入的 ChatGPT 風格訊息區；`.xlsx` 可由附件按鈕或整個對話區拖放，附件與文字在同一則使用者訊息一次送出，背景完成匯入、驗證、排程、地圖更新與 Agent 回覆。
- 本輪對話安全與可讀性：加入附件檢查、附件移除／重選、附件-only 預設意圖、Enter／Shift+Enter、停止回覆、進度步驟與收合的「查看計算依據」；主畫面不再顯示 Raw JSON、provider code 或內部識別資訊，計算摘要改為繁體中文。
- 本輪插單可靠性修正：urgent preview 的最小變動候選會精確保留既有路線相對順序，避免將合法插入誤判為不可行；Live ORD-041 preview、人工確認與 Dispatch request=0 均通過。
- 本輪瀏覽器驗證：`frontend/tests/e2e/live-control-tower.spec.ts` 實際完成無資料聊天、無效格式恢復、拖放／單次送出、40 單 Live Google Matrix → OR-Tools、Validator、Google Maps、Agent 多輪、ORD-041 preview、人工確認與停止回覆，保存 `chat-composer-empty.png`、`chat-composer-attached.png`、`chat-composer-completed.png`。
