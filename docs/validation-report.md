# 規格驗證報告

## 狀態快照

```yaml
validated_on: 2026-09-03
scope: specification_harness_algorithm_benchmark_contracts_feature_code_agent_e2e_api_contract_demo_flow_competition_acceptance
feature_code_present: true
implementation_gate: APPROVE_IMPLEMENTATION
implementation_status: phase_2_feature_implementation
backend_p0_status: done
openai_agent_status: done
frontend_integration_status: live_control_tower_verified
overall_project_status: in_progress
git_repository: true
```

## 本輪檢查

本輪以不輸出 credential 的方式執行真實整合驗證；OpenAI、Google Routes 與 Browser Maps 使用已設定的開發憑證，TDX 憑證未設定並標示為可選。任何 mock、simulated 或 skipped 結果均未列為 Live PASS。

| 檢查 | 預期證據 | 狀態 |
|---|---|---|
| 必要檔案存在 | 路徑清單 | 通過 — 24 項必要產物 |
| Golden Dataset JSON 可解析 | JSON parser | 通過 |
| Observability 設定可解析 | JSON parser（相容 YAML 1.2 的 JSON 語法） | 通過 |
| TOML 可解析 | Python `tomllib` | 通過 |
| 直接相依版本符合 lock | comparison script | 通過 — 16 個 direct pins |
| Python 3.12 相依解析 | pip dry-run report | 通過 — 無安裝、無衝突 |
| Spec／API／Harness 術語一致 | 13-endpoint cross-file checks | 通過 |
| Markdown 結構 | 16 個檔案的 code fence 成對檢查 | 通過 |
| Secret patterns | repository text scan | 通過 — 未偵測到 |
| Workbook 工作表／欄位契約 | artifact inspect | 通過 — 四張精確工作表與標題 |
| Demo 筆數與總重量 | artifact inspect/calculation | 通過 — 40 orders、80 packages、4 vehicles、5 zones、365 kg |
| Demo 分布 | deterministic audit | 通過 — AM 20、PM 20、Z4 112 kg |
| Workbook 公式錯誤 | artifact match scan | 通過 — 未偵測到 |
| Workbook 視覺品質 | 8 張工作表 render/view、修正、重新 render | 通過 |
| Feature gate | 已記錄精確核准；僅核准後允許 `src/` implementation | 通過 — `APPROVE_IMPLEMENTATION` |
| Git 基準安全 | repository-local identity、空遠端、26 檔 secret/action/deployment scan | 通過 |
| 演算法規格覆蓋 | Baseline、CVRPTW dimensions、strategies、limits、partial/failure policy | 通過 |
| 公平 Benchmark 契約 | 相同 fixture/matrix identity、12 項指標、公式、可重現控制 | 通過 |
| API Key 測試分層 | always-on keyless、conditional live、缺 key skip/fallback、secret redaction | 通過 |
| Golden Dataset 擴充 | JSON parse 與 GD-013–GD-030 traceability | 通過 — 共 30 個案例 |
| Responses API 參數診斷 | `gpt-5-mini` direct text 與 strict function request；malformed Chat envelope regression | 通過 — 正確 requests PASS；歷史 HTTP 400 `missing_required_parameter` 已在不輸出 secret 下說明 |
| OpenAI Agents SDK E2E | `Runner.run` + strict deterministic tools + independent Validator + evidence-only final answer | 通過 — live opt-in daily dispatch PASS；7 個 provider-neutral SDK scenarios PASS |
| API contract 覆蓋 | 文件 method/path 與 FastAPI routes 比對及安全 response exercise | 通過 — 13 defined／13 implemented／13 exercised |
| 40-order Demo flow | import → validation → plan → provider fallback → explanation → confirm → order 41 preview/diff；不 dispatch | 通過 — base version 未變更 |
| Observability 與 cost guard | Redacted JSONL trajectory events、correlation IDs、fail-closed Agent limits、regression tests | 通過 — `src/observability`、3 個 boundary/redaction tests |
| OpenAPI snapshot | stable hash 與精確 13-path set | 通過 — `docs/openapi-snapshot.sha256` 與 snapshot test |
| 前端乾淨安裝／啟動 | 全新 CPython 3.12.13 venv 安裝 `requirements.lock` 並啟動 FastAPI | 通過 — health `200`、Swagger `/docs` `200`、OpenAPI `200` |
| 前端 API／CORS 介面 | 13 個 OpenAPI paths 與明確 allowed-origin preflight | 通過 — 13 paths；允許 `http://localhost:5173` |
| Demo workbook 交付路徑 | repository-relative fixture 存在且可讀 | 通過 — `data/samples/demo-delivery-40-orders.xlsx` |
| 競賽欄位錯誤 | 缺少 address/time/weight cells 指出 order/package/field 並要求人工複核 | 通過 — executable acceptance fixture |
| Plan evidence reasons | 每個 assigned stop 都有 deterministic zone/weight/load/time/distance evidence | 通過 — Plan API acceptance test |
| Urgent preview diff | 從 before/after plans 計算 reassignment、sequence、load 與 distance/time deltas | 通過 — order-41 Demo assertion 與 diff builder |
| 中文核心功能 Demo | 單一指令列出 40/4 routes、重新分配、例外、完整 preview diff 與人工 checkpoint | 通過 — `scripts/run_p0_demo.py` 結束碼 0；無 Dispatch/deploy |
| Urgent base-plan identity | Demo preview 使用相同 OR-Tools plan ID/version/dataset/algorithm 且 before 為 365 kg | 通過 — regression test 與 Demo output |
| Minimum-change insertion | 合法既有路線插入保留未受影響路線，ORD-041 僅影響一台車 | 通過 — `MINIMAL_CHANGE`、Validator valid |
| 對外內容清理 | 已追蹤 Markdown／JSON／YAML／TOML 移除私人交付時程與個人工作安排 | 通過 — 僅保留技術識別字與程式碼既有字串 |
| 文件中文化與格式 | 說明文字使用繁體中文；Markdown links、code fences 與結構可解析 | 通過 |

## 最新 Live Integration 驗證（2026-09-03）

| 閘門 | 狀態 | 真實證據 |
|---|---|---|
| OpenAI Agent | `LIVE PASS` | `/api/v1/agent/chat` 實際回傳 `runner_result_type=RunResult`；strict `explain_assignment` tool 呼叫 1 次；回答僅引用 tool evidence。 |
| Google Routes Matrix → OR-Tools | `LIVE PASS` | 40 單匯入後取得 41×41 `provider_mode=GOOGLE`、`matrix_version=google-routes-v1`；同一 Matrix 建立 OR-Tools plan，40/40 assigned、Validator `valid=true`。 |
| Google route geometry | `LIVE PASS` | `/map-data` 回傳 4 條非 simulated geometry，provider 為 `GOOGLE`。 |
| ORD-041 urgent preview | `LIVE PASS` | 以同一 plan version／dataset 基準，incremental Matrix 延伸成功；`MINIMAL_CHANGE`、40 → 41 assigned、365 → 367 kg、0 → 0 unassigned、單一車輛受影響；preview Validator 通過；未 Dispatch。 |
| Google Maps Browser | `LIVE PASS` | 使用 Browser key 在瀏覽器載入臺北道路地圖、DEPOT-001、40 個編號 Marker 與 4 條 Google geometry 路線；Playwright 觀察到地圖控制項與 Google attribution。 |
| TDX OAuth／路況／route risk | `OPTIONAL／NOT_CONFIGURED` | `TDX_CLIENT_ID` 與 `TDX_CLIENT_SECRET` 未設定；API 回傳 `CREDENTIALS_MISSING`，不以 mock 代替且不阻塞本輪。 |
| 完整 Playwright Live E2E | `LIVE PASS` | `frontend/tests/e2e/live-control-tower.spec.ts` 以真實 OpenAI／Google 流程完成無資料對話、Excel、Live Matrix、地圖、Agent 多輪、ORD-041 preview、人工確認、任務頁與路線頁；監測 Dispatch request 為 0。 |

本輪完整後端 keyless suite 為 `36 passed, 3 skipped`；另外以條件環境執行 OpenAI／Responses／Google live gate 為 `5 passed`。前端 typecheck、lint、Vitest `2 passed`、build 與 Playwright regression `2 passed`。Ruff、mypy 與 tracked-file secret scan 均通過。未輸出或提交任何 credential，未執行 Dispatch、部署或正式環境操作。

## 相依套件解析證據

- 解析使用的 Runtime：CPython 3.12.13。
- Resolver：pip 26.2.1 `--dry-run --ignore-installed --report`。
- 結果：所有 direct 與 transitive requirements 均可解析；未安裝套件。
- Lock 目標：目前 Windows x86-64 開發環境。若要 Linux 部署，仍需另行完成 Linux lock／wheel 驗證。

## 外部參考檢視

- OpenAI 官方指引支援 Agent orchestration／tool use 與目前模型設定；模型由環境設定驅動。
- Google Compute Route Matrix 需要 field masks，並提供 status／condition／distance／duration 欄位。
- Google 建議限制金鑰權限；Browser 與 Server credentials 分離。
- TDX 官方 Swagger 說明 Client ID／Secret 存取與 road traffic v2 data services。
- Depot address geocode 的來源 URL／日期已記錄於 `ACTIVE_SPEC.md`。
- OR-Tools 官方 routing options 定義 first-solution strategies、`GUIDED_LOCAL_SEARCH`、`solution_limit`、`time_limit` 與 solver termination statuses。
- OR-Tools 官方 CVRP／VRPTW 指引支援 Capacity 與 Time Dimensions、每個節點的 time-window constraints、waiting slack 與 depot-bounded routes。
- OR-Tools routing-task 指引支援從既有 routes warm-start；dropped-visits 指引要求明確 penalties 與 dropped-node reporting。

## 演算法與 Benchmark 規格驗證

| 控制項 | 鎖定決策 | 結果 |
|---|---|---|
| Baseline | First-Fit Eligible Vehicle + time-feasible Nearest Neighbor | 已出現在 architecture、requirements、plan 與 GD-013 |
| Optimized model | OR-Tools CVRPTW with Capacity／Time Dimensions and allowed vehicles | 已具備 |
| Search | `PARALLEL_CHEAPEST_INSERTION` + `GUIDED_LOCAL_SEARCH` | 已具備 |
| Limits | 10-second hard cap + 1,000-solution cap | 已具備 |
| Hard constraints | unsplittable、capacity、zone、AM/PM、lunch、180-second service、depot return | 已具備 |
| Output trust | Baseline 與 Optimized 均要求 independent Validator | 已具備 |
| Partial/failure | 明確 solver status、unassigned reconciliation、不可確認的無效方案 | 已具備 |
| Urgent order 41 | minimum-change tiers；只有 fallback preview 才標記 `FULL_REPLAN` | 已具備 |
| Fair input | 相同 40 orders、4 vehicles、5 zones、depot 與 simulated matrix hash | 已具備 |
| Live traffic | 排除於 canonical／Golden Benchmark 數值 | 已具備 |
| Reproducibility | pins、hashes、integer units、stable ordering、fixed parameters、run protocol | 已具備 |
| Credentials | keyless 永遠可執行；live conditional；不輸出 secret values | 已具備 |

## Runtime 驗證

- FastAPI import／health／readiness、Excel upload、plan creation、map payload、confirmation、dispatch lifecycle、urgent preview 與 structured explanation tests 均通過。
- Deterministic parser、package aggregation、Baseline、OR-Tools CVRPTW、shared simulated matrix、independent Validator、Benchmark、SQLite repository、urgent preview、structured evidence 與 provider fallback tests 均通過。
- Keyless suite：`36 passed, 3 skipped (conditional Agent/Responses/Google live tests)`；`ruff check src tests scripts` 通過；`mypy src` 通過，共 27 個 source files。
- Agents SDK scenario suite：`7 passed`；使用 `gpt-5-mini` 的 explicit live `Runner.run`、strict `plan_dispatch` 與 Validator：`1 passed`。
- Explicit direct Responses smoke：`1 passed`（text 加 strict function call、`gpt-5-mini`；bounded caps 256／512）。
- API contract：`13 / 13 / 13`（defined／implemented／exercised）；Demo flow：`1 passed`，刻意在 dispatch 前停止。
- OpenAPI snapshot：精確 13-path set 與 SHA-256 snapshot 相符；redacted observability 與 `RunBudget` limit tests 通過。
- 前端交付檢查：全新的 CPython 3.12.13 temporary environment 安裝 `requirements.lock`；FastAPI 提供 `/health`、`/docs`、`/openapi.json`；OpenAPI 暴露全部 13 個契約 paths；允許來源的 OPTIONS preflight 回傳 `Access-Control-Allow-Origin: http://localhost:5173`。
- 競賽驗收：Z4 的 112 kg 合法分散，未集中超過 100 kg 的 `VEH-002`；缺少 `location_label`／`time_slot`／`weight_kg` 時回傳 entity／field paths 與人工複核旗標；`TIME_WINDOW_CONFLICT` 與 `UNASSIGNABLE` 經 independent Validator reconciliation；order 41 產生非空 sequence／load changes 與計算後差異。
- Demo 指令：`.venv\\Scripts\\python.exe scripts/run_p0_demo.py` 成功完成，以中文輸出每台車的訂單／重量／使用率／理由證據、重新分配、例外、完整 preview diff 與人工確認提示；未呼叫 Dispatch 或 deployment。
- 修正後 urgent Demo 證據：OR-Tools initial plan before = 40 assigned／365 kg，車輛載重 `93/97/152/23`；order 41 插入 `VEH-003`，既有訂單換車數為 0，該路線 4 筆 sequence records，載重 `152 -> 154 kg`，距離 `+137 m`、時間 `+17 s`。Base 與 preview algorithm 均為 ORTOOLS，並明確回傳 dataset hashes。
- Canonical simulated run（10-second cap）：Baseline `183,955m / 23,023s`、2 unassigned；OR-Tools `161,257m / 20,185s`、0 unassigned；無 Validator violations；最近量測 solve times 為 Baseline `0.584ms`、OR-Tools `5,985.454ms`，僅供報告，不作跨機器 exact value。
- Live preflight：OpenAI Chat text／strict tool `PASS`；Google Routes matrix `PASS`；TDX `SKIPPED`（後續擴充）。刻意錯誤的 Responses tool envelope 重現 HTTP 400 `missing_required_parameter`；修正 `input`、top-level `tools`、`strict` 與 `max_output_tokens` 後，`gpt-5-mini` requests 通過。未輸出 key、header 或完整 request。
- Browser key 仍屬前端依賴；無 key 時保留明確 Google server fallback。Frontend Integration 的歷史 snapshot 曾為 `PENDING`，本輪已完成 Live control tower 與 browser E2E；TDX 仍為可選未設定。
- 本輪僅進行文件中文化與對外內容清理；未修改程式、API、演算法、測試邏輯，亦未執行 Dispatch、deployment 或正式環境操作。

## 人工驗收決策

| 領域 | 狀態 | 已接受證據 |
|---|---|---|
| Backend P0 | `DONE` | 合法超重重新分配；40-order OR-Tools plan 零違規；欄位級錯誤；計算後 urgent diff；independent Validator 通過。 |
| OpenAI Agent | `DONE` | Agents SDK end-to-end tool invocation、strict deterministic planning／evidence tools、evidence-only response 與 regression coverage 已由人工驗收。 |
| Frontend Integration（歷史人工決策） | `PENDING` | 歷史記錄；本輪已提供 local control tower，現況請看下方最新驗證。 |
| Overall Project | `IN_PROGRESS` | Backend 與 Agent gates 已完成，但前端整合尚未完成。 |

### 保留的 urgent-insert 證據

- Initial OR-Tools plan：40 assigned orders、總重 365 kg、車輛載重 `93/97/152/23 kg`、zero unassigned。
- `ORD-041` preview mode：`MINIMAL_CHANGE`；既有訂單換車數 `0`；僅影響 `VEH-003`。
- Before／after：`365 kg → 367 kg`、`0 → 0` unassigned、距離 `+137 m`、duration `+17 s`。
- Independent Validator：before 與 after plans 均為 `PASS`。
- 未執行 Dispatch、deployment 或正式環境操作。

## 最終結果

Specification／Harness readiness：**PASS**。Implementation gate 因明確的 `APPROVE_IMPLEMENTATION` 而開啟；deterministic core 與 FastAPI 已實作，`feature_code_allowed: true`。Backend P0、OpenAI Agent 與 Frontend Live control tower 均已通過本輪驗收；TDX 為 `OPTIONAL／NOT_CONFIGURED`，因此 Overall Project 維持 **IN_PROGRESS**。未執行 dispatch 或 deployment。

## 本輪前端控制塔與 Provider 驗證（2026-09-03）

| 閘門 | 結果 | 證據 |
|---|---|---|
| Google Matrix wiring | `LIVE PASS` | `tests/test_live_provider_wiring.py` 與 Live flow 證明 strict Google Matrix、matrix hash/version 與同次 OR-Tools 注入 |
| Google route geometry | `LIVE PASS` | `src/providers/google_routes.py` 與 `/map-data` 回傳 4 條非 simulated geometry |
| TDX OAuth／route risk | `OPTIONAL／NOT_CONFIGURED` | `src/providers/tdx.py` 已有 adapter；本環境未設定 credentials，不以 mock 代替 Live |
| React control tower | `LIVE PASS` | `frontend/` API client、Google Maps、Agent／preview／confirm UI 與任務／路線工作區 |
| Frontend quality gates | `PASS` | `pnpm install --frozen-lockfile`、`pnpm run typecheck`、`pnpm run lint`、`pnpm run test -- --run`（2 passed）、`pnpm run build`、Playwright Chromium（2 passed） |
| Backend quality gates | `PASS` | `pytest` 36 passed／3 skipped、`ruff check src tests scripts`、`mypy src` 27 files |
| Secret／deployment scan | `PASS` | tracked high-confidence secret patterns 0；`.github/workflows` 不存在；未執行 Dispatch／部署 |

前端 Browser map 在 `VITE_GOOGLE_MAPS_BROWSER_API_KEY` 缺少時刻意顯示 `SIMULATED` fallback；本分支已在 Browser key 存在時完成 Google Maps Live 與完整 browser-to-live-provider E2E。TDX 仍為可選未設定項目，Overall Project 維持 `IN_PROGRESS`。

Playwright 截圖：`docs/screenshots/01-empty-control-tower.png`、`02-imported-plan.png`、`03-map-and-vehicles.png`、`04-agent-blocked.png`、`05-urgent-preview.png`、`06-human-confirmation.png`。測試以 REST endpoint 的 keyless simulated provider 執行；截圖不含 secrets。

## 本輪最新 Live 交付證據（2026-09-03）

- Credential preflight：`OPENAI_API_KEY`、`GOOGLE_ROUTES_SERVER_API_KEY`、`VITE_GOOGLE_MAPS_BROWSER_API_KEY` 均為 `CONFIGURED`；TDX 兩項憑證為 `OPTIONAL／NOT_CONFIGURED`。實際值未輸出、未記錄、未提交。
- Agent 對話：無資料提問與同一 `Conversation ID` 的多輪流程均回傳 `runner_result_type=RunResult`；`plan_dispatch`、`highest_load_vehicle`、`explain_assignment`、`preview_urgent_insert`、`prepare_confirmation` 均由 strict tools 實際執行，回答只引用 evidence。
- Google 路線與排程：40 張訂單匯入後，`provider_mode=GOOGLE` 的 41×41 Matrix 進入同一次 OR-Tools 求解；40/40 已安排、365 kg、獨立 Validator 通過。`map-data` 回傳 4 條非 simulated geometry。
- Browser 地圖：Live Playwright 顯示臺北道路、Google attribution、DEPOT-001、40 個 Marker、4 色道路 Polyline，並可依車輛篩選；畫面不顯示 raw JSON 或 provider code。
- ORD-041：Agent 自動使用結構化 fixture 呼叫 preview，REST 提案以同一 plan 基準建立 `MINIMAL_CHANGE`；40 → 41 張、365 → 367 kg、換車 0 張、僅一台車受影響，Validator 通過；前端顯示距離與時間差異並完成人工確認。
- 瀏覽器流程：`frontend/tests/e2e/live-control-tower.spec.ts` 通過，涵蓋無資料聊天、Excel 匯入、Live Matrix、Map、Agent 多輪、插單差異、人工確認、配送任務與配送路線工作區；全程 Dispatch request `0`。
- 最新截圖：`docs/screenshots/live-01-empty-chat.png`、`live-02-google-map-plan.png`、`live-03-agent-evidence.png`、`live-04-urgent-diff.png`、`live-05-human-confirmed.png`、`live-06-delivery-tasks.png`、`live-07-route-tracking.png`，均為 1440×900 且未含 secrets。

## 第二組隨機資料與連續插單驗收（2026-09-04）

本輪新增的 workbook 不沿用既有訂單 ID，並由固定 seed 產生：

| 欄位 | 實際結果 |
|---|---|
| 檔案 | `data/samples/random-dispatch-seed-260904.xlsx` |
| 生成器 | `scripts/generate_random_fixture.mjs` |
| seed | `260904` |
| 訂單／package | `40／79` |
| 總重量 | `322.8 kg` |
| SHA-256 | `44d81b9ac0112e1c147bf40ccbbfb2aa72997cee55f42a449c04f32e9cf35544` |
| 基礎 provider／algorithm | `SIMULATED／ORTOOLS`（40/40、Validator 通過） |

連續插單由 `scripts/run_randomized_insert_audit.py` 執行，所有數值皆由 planner／Validator 計算；壓力測試使用 keyless simulated provider，未宣稱 Google Live：

| 案例 | 結果 | 版本 | 影響摘要 | Validator |
|---|---|---|---|---|
| `TMP-260904-01` 同區低重量 | `MINIMAL_CHANGE` | V1 → V2 | 1 台車、換車 0、順序 1、距離 +12 m、時間 +1 s | 通過 |
| `TMP-260904-02` 高優先窄時段 | `MINIMAL_CHANGE` | V2 → V3 | 1 台車、換車 0、順序 16、距離 +418 m、時間 +53 s | 通過 |
| `TMP-260904-03` 容量壓力 | `FULL_REPLAN` | V3 → V4 | 4 台車、換車 22、順序 42、距離 +3,973 m、時間 +497 s | 通過 |
| `TMP-260904-04` 全車容量不足 | `UNASSIGNED` | V4 → V4 | 未安排；原方案未變更 | 通過 |
| 既有 ID 重複 | `REJECTED` | V4 → V4 | `DUPLICATE_ID`；未污染方案 | 通過 |
| 必填欄位缺漏 | `REJECTED` | V4 → V4 | `MISSING_REQUIRED_FIELD:location_label`；未污染方案 | 通過 |

新增 `preview_structured_urgent_insert` strict tool，將任意結構化訂單轉成 Canonical Schema，並只引用 deterministic preview／OR-Tools／Validator evidence；既有 `preview_urgent_insert` 保持相容。確認後會更新 SQLite plan state 與 current-version pointer，前端重新整理可依 localStorage reference 重新載入 plan／map。

固定 seeds `260904`–`260913` 共 10 組壓力測試均為 `SIMULATED PASS`：輸入 hash 可重現、Validator violations（overload／cross_zone／duplicate／time_window）均為 0；完整細節見 `docs/randomized-acceptance-report.json`。本輪沒有新增 Google Live 請求，既有 Google Live 證據仍依前節標示。

## 剩餘缺口稽核與第二組瀏覽器驗收（2026-09-04）

### 以程式與測試證據核對的狀態

| 項目 | 狀態 | 證據與尚缺內容 |
|---|---|---|
| 任意 `.xlsx` 匯入與欄位級驗證 | `DONE` | parser／field-level tests、第二組 workbook 匯入；非 `.xlsx`、空檔與缺欄會回傳可讀錯誤並要求人工複核。 |
| 附件＋文字單次送出 | `DONE` | Live／randomized Playwright：同一則使用者訊息包含檔案與文字，僅一次匯入請求。 |
| 純附件、無附件對話 | `PARTIAL` | 元件已提供附件-only 預設意圖與無資料 `assistant_help`；本輪瀏覽器主閘門以附件＋文字為主，純附件仍需獨立產品回歸案例。 |
| 多輪上下文 | `DONE` | Live Playwright 與 session history／plan pointer 驗證。 |
| 任意結構化臨時訂單與連續插單 | `DONE`（simulated） | strict `preview_structured_urgent_insert`、API regression、固定 seed 5 類案例；Google Live 僅執行代表性流程。 |
| Plan 版本、人工確認與失敗不污染 | `DONE` | SQLite current pointer regression、V1→V4 chain、失敗案例版本維持不變。 |
| Google Matrix 快取／來源追蹤 | `DONE`（Live 代表性流程） | matrix version/hash、incremental extension 與 provider mode evidence；壓力測試不重複呼叫付費 provider。 |
| Validator、地圖／車輛／順序／差異同步 | `DONE`（Live／simulated 分開） | Validator violations=0；既有 Google Live map gate 與 randomized screenshots。 |
| 缺欄、超重、時段衝突、重複與無法安排 | `DONE` | competition acceptance、structured API validation、randomized impossible/duplicate/missing cases。 |
| 人工確認後不得 Dispatch | `DONE` | Playwright request gate：Dispatch requests=0；確認只更新 plan state。 |
| API 契約與前端錯誤狀態 | `DONE` | 13/13/13 contract coverage、OpenAPI snapshot、錯誤 envelope 與 UI fallback。 |
| 部署前設定 | `BLOCKED` | 尚未執行正式部署；Linux runtime、TDX credentials 與正式環境設定仍需人工／環境準備。 |

### 新隨機資料與連續插單證據

- 檔案：`data/samples/random-dispatch-seed-260904.xlsx`；seed：`260904`；40 orders／79 packages／322.8 kg；SHA-256：`44d81b9ac0112e1c147bf40ccbbfb2aa72997cee55f42a449c04f32e9cf35544`。
- 基礎方案：`SIMULATED／ORTOOLS`，40/40 assigned，Validator 通過；每次 chained preview 使用最新已確認版本。
- `TMP-260904-01`：`MINIMAL_CHANGE`，V1→V2，1 台車，換車 0，順序 1，+12 m／+1 s，Validator 通過。
- `TMP-260904-02`：`MINIMAL_CHANGE`，V2→V3，1 台車，換車 0，順序 16，+418 m／+53 s，Validator 通過。
- `TMP-260904-03`：`FULL_REPLAN`（容量壓力），V3→V4，4 台車，換車 22，順序 42，+3,973 m／+497 s，Validator 通過。
- `TMP-260904-04`：`UNASSIGNED`（全車容量不足），維持 V4；無法安排原因已保留，Validator 通過。
- 重複 ID 與缺少 `location_label`：`REJECTED`，維持 V4，未污染方案；Validator 仍通過既有方案。
- 固定 seeds `260904`–`260913` 的 10 組壓力測試均為 `SIMULATED PASS`，輸入 hash 可重現，overload／cross-zone／duplicate／time-window violations 均為 0。
- 每一筆鏈式結果均在 JSON 保存 `before_vehicle_loads` 與 `vehicle_loads`（含 planned load、capacity 與 utilization），並保留 provider mode、matrix hash、Validator 與未安排原因。
- `scripts/generate_random_fixture.mjs` 連續重跑兩次的 SHA-256 均為 `44d81b9ac0112e1c147bf40ccbbfb2aa72997cee55f42a449c04f32e9cf35544`；XLSX 正規化器固定 ZIP 順序、關係識別字與時間戳，確保可重現。

### 瀏覽器驗收與重試修正

- `frontend/tests/e2e/randomized-insert-flow.spec.ts`：`2 passed`；完成新 workbook 拖放、附件＋文字單次送出、純附件預設匯入意圖、simulated OR-Tools／Validator、連續三筆任意 ID 插單、人工確認、refresh hydration、Console errors=0、Dispatch requests=0。
- 前端路線 provider 在此第二組壓力流程由測試明確固定為 `SIMULATED` 以控制成本；不可與既有 Google Routes／Google Maps `LIVE PASS` 混稱。TDX 維持 `OPTIONAL／NOT_CONFIGURED`。
- `/api/v1/agent/chat` 對無副作用的 `Runner.run` 增加一次有限重試，以吸收暫時性 provider 502；不改變 tool evidence、strict schema、錯誤封裝或重試上限。
- 新增截圖：`docs/screenshots/random-01-attached.png`、`random-02-base-plan.png`、`random-03-insert-1.png`、`random-04-insert-2.png`、`random-05-final-plan.png`、`random-06-attachment-only.png`；均為 1440×900 且未含 secrets。

### 本輪品質閘門

- Backend：`pytest 41 passed, 3 skipped`；skipped 為明確條件式 OpenAI Agent、Responses API、Google Live tests，分別需要環境旗標／匯出 credential；`ruff check . PASS`；`mypy src PASS`。
- Frontend：既有 TypeScript typecheck、ESLint、Vitest、Vite build 與代表性 Google Live Playwright 維持通過；第二組 randomized Playwright `2 passed`。
- Secret／安全：`.env`、plaintext source、`.venv` 與 `scripts/node_modules` 均排除；未輸出、記錄或提交任何 credential；未執行 Dispatch、部署、正式環境操作或 force push。

## 競賽命題最終盤點與 Render 公開驗收（2026-09-05）

本節以實際 Render 公開網址與目前程式／測試結果為準；歷史快照不覆蓋本節證據。驗收網址：`https://ai-dispatch-control-tower.onrender.com/`。測試資料皆為合成資料，未讀取、輸出或提交任何憑證。

| 競賽要求 | 實際證據 | 狀態 | 缺口或修正 |
|---|---|---|---|
| 官方 40 單匯入與四表驗證 | 公開 `import-excel`：40 orders／80 packages／4 vehicles／5 zones，`is_valid=true` | `PUBLIC LIVE PASS` | 無；另有固定 seed 隨機 workbook 供非付費壓力測試 |
| Google Matrix → OR-Tools → Validator | 公開 plan：`provider_mode=GOOGLE`、40/40、365 kg、ORTOOLS、Validator valid=true；Matrix hash/version 一致 | `PUBLIC LIVE PASS` | 無；未使用 simulated fallback |
| 車輛容量、服務區域、順序與理由 | 公開頁面顯示四車負載／使用率、40 個站點順序與 evidence-grounded reason | `PUBLIC LIVE PASS` | 修正 Agent evidence 的 `vehicle_count` 只計實際有單車輛 |
| Google Maps 真實道路地圖 | 公開瀏覽器顯示臺北道路、Google attribution、DEPOT-001、40 markers 與 4 條 `is_simplified=false` geometry | `PUBLIC LIVE PASS` | 無 |
| Agent 對話與 deterministic tool | `/api/v1/agent/chat` HTTP 200；多輪 tool `highest_load_vehicle`；prompt injection 僅回 `assistant_help`，不虛構數字 | `PUBLIC LIVE PASS` | 未顯示 private reasoning |
| ORD-041 臨時插單 | 公開 preview V1→V2、`MINIMAL_CHANGE`、40→41、365→367 kg、換車 0、1 台車受影響、Validator 通過 | `PUBLIC LIVE PASS` | preview 保持 `PROPOSED`，等待調度員確認；本輪未代替使用者確認 |
| 13 支 REST API／Swagger／CORS | OpenAPI 實際 13 paths；Swagger 200；localhost preflight 200／GET,POST | `PUBLIC LIVE PASS` | Dispatch path 僅核對契約，未呼叫 |
| 缺漏欄位與安全錯誤 envelope | 新增 RequestValidationError handler，回傳 `field_errors`、`requires_manual_review=true` 且不回傳 raw input；新增 regression test | `LIVE PASS` | Render 自動部署新 commit 後需再確認版本已更新 |
| 例外情境（超重／時段／重複／無法安排） | 本機 deterministic competition／randomized acceptance tests；公開 preview 對容量不足回傳明確 `URGENT_INSERT_UNASSIGNABLE` | `SIMULATED PASS` | 公開網站未執行會造成狀態污染的多次確認鏈 |
| 人工確認與 Dispatch 安全邊界 | 公開 UI 顯示待人工確認；本輪無 Dispatch request；未執行正式環境操作 | `PUBLIC LIVE PASS` | 需由實際調度員在畫面按確認 |
| TDX 路況 | 本環境 credentials 未設定 | `BLOCKED` | 加分功能；`OPTIONAL／NOT_CONFIGURED`，不影響競賽最低要求 |

### 公開 40 單實測摘要

| 項目 | 結果 |
|---|---|
| Render URL | `https://ai-dispatch-control-tower.onrender.com/` |
| 訂單／車輛 | 40／4；未安排 0 |
| 總重量 | 365.0 kg |
| 各車負載 | VEH-001 116.0／120.0 kg（96.7%）；VEH-002 98.0／100.0 kg（98.0%）；VEH-003 151.0／160.0 kg（94.4%）；VEH-004 0.0／110.0 kg（0.0%） |
| Validator | `valid=true`；overload／cross_zone／duplicate／time_window 均為 0 |
| 路線 | 4 條 Google geometry；40 stops；非 straight-line placeholder |

### 品質閘門

- 新增 regression tests：欄位級錯誤 envelope 與 Agent evidence vehicle count；目標測試 `10 passed`。`ruff`、`mypy src` 通過。
- 前端：`pnpm install --frozen-lockfile`、TypeScript、ESLint、Vitest（2 tests）、Vite production build 通過。
- 完整 pytest 在本機以空白 OpenAI key（避免使用本機舊憑證）執行為 `41 passed、3 skipped`；另有 1 個既有 Agent API 測試因 OpenAI 未設定回傳 503，屬環境條件，不冒稱 Live PASS。3 個 skipped 為明確條件式 live gates：Agents SDK、Google live key、Responses smoke。
- Secret scan、GitHub Actions／部署風險檢查未發現新增 secret 或 workflow；全程 Dispatch requests=0。

## 公開驗收補充與最終缺口稽核（2026-09-05）

本節是本輪最後一次公開檢查的摘要；數字僅引用 Render 回應、瀏覽器 DOM／地圖證據與可重現測試，不以舊截圖取代實際驗收。

| 競賽要求 | 實際證據 | 狀態 | 缺口或修正 |
|---|---|---|---|
| Render 健康檢查與 OpenAPI | `/health`、`/ready` 回傳成功；`/openapi.json` 實際列出 13 條 path，Swagger 可載入 | `PUBLIC LIVE PASS` | Dispatch endpoint 僅核對契約，刻意不呼叫 |
| 官方 40 單匯入與排程 | 公開 `.xlsx` 匯入 40 orders／80 packages／4 vehicles／5 zones；Google Matrix 進入 OR-Tools；40/40、365 kg、Validator valid | `PUBLIC LIVE PASS` | 無 |
| Google Maps | 公開瀏覽器顯示臺北道路與地名、Google attribution、DEPOT-001、40 個編號 Marker、4 色非 simulated geometry；可依車輛篩選 | `PUBLIC LIVE PASS` | 修正前端狀態列，使 runtime Browser key 已設定時不再誤顯示「未設定」 |
| Agent 與證據 | `/api/v1/agent/chat` 公開回傳 `RunResult`；`plan_dispatch`／`highest_load_vehicle` 由 strict tool 執行；回答引用 plan／Validator 數值；prompt injection 不繞過規則 | `PUBLIC LIVE PASS` | 無 private reasoning；本機無 credential 的相依測試仍明確列為 skipped |
| ORD-041 Preview | 同一 OR-Tools plan 基準建立 `MINIMAL_CHANGE` preview，40→41、365→367 kg、換車 0、1 台車受影響、Validator 通過 | `PUBLIC LIVE PASS` | 預覽維持待人工確認；未執行 Dispatch |
| 超重、重複、缺欄與無法安排 | 本機 deterministic acceptance／randomized tests 通過；公開 Google mode 的 500 kg 插單回傳 `FULL_REPLAN` 且明確列為 1 筆 unassigned，既有版本維持不變；重複 ID 回傳 422 | `SIMULATED PASS` | 時段衝突以 deterministic provider 測試驗證；公開網站未為製造衝突而污染方案 |
| 前端任務與路線工作區 | 公開瀏覽器實際切換「配送任務／路線追蹤」；表格、車輛載重、順序、40 stops、地圖與 Google 路線一致 | `PUBLIC LIVE PASS` | 無 |
| CSV 輸入 | 現行 API 契約與 parser 僅接受四表 `.xlsx`；本輪依競賽最低要求實測 `.xlsx` | `BLOCKED` | 若競賽明確要求單檔 CSV，需另定 vehicles／zones 的輸入契約；本輪不捏造預設資料 |
| TDX 路況 | Render／本機未設定 `TDX_CLIENT_ID`、`TDX_CLIENT_SECRET` | `BLOCKED` | 屬加分功能，不列入競賽最低合格判定 |

### 公開方案與安全證據

- 公開基礎方案：40 張訂單、4 台車，VEH-001 116／120 kg（96.7%）、VEH-002 98／100 kg（98.0%）、VEH-003 151／160 kg（94.4%）、VEH-004 0／110 kg（0%）；未安排 0，Validator 的 overload／cross-zone／duplicate／time-window 皆為 0。
- 公開瀏覽器 console 僅有 Google Maps API 的 deprecation warning，未發現未處理 error；全程未送出 Dispatch request（0）。
- Secret scan：追蹤檔案高信心 pattern 0、追蹤的非 example env 0、GitHub Actions workflow 0；任何 key 均未輸出、記錄或提交。
- 本輪程式修正：`src/agent/runtime.py` 的 vehicle count 僅計實際承載車輛；`src/api/main.py` 的 malformed payload 與 urgent planner edge case 均以安全欄位級／manual-review envelope 回應；前端 StatusBar 改由 runtime config 的 presence 顯示 Browser key 狀態。

### 品質閘門（本輪）

- Backend：`43 passed, 3 skipped, 1 failed`（唯一失敗是刻意清空本機 OpenAI key 後，既有 API test 預期 200 而收到安全的 503；不冒稱 Live）；skipped 為 Agents SDK、Google live key、Responses smoke 的條件式 gates。`ruff check src tests scripts PASS`、`mypy src PASS`。
- Frontend：`pnpm install --frozen-lockfile`、TypeScript、ESLint、Vitest `2 passed`、Vite production build PASS。
- Render 公開網址：健康檢查、13-path OpenAPI／CORS、40 單 Google→OR-Tools→Validator、Agent、Google Maps 與 ORD-041 preview 均有實際回應；TDX 為 `OPTIONAL／NOT_CONFIGURED`。
