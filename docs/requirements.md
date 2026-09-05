# 需求與覆蓋範圍

## 2026-09-05 正式方案驗收補充

| Requirement ID | 類別 | 工作內容 | 現況 | 實際證據 | 尚缺內容 | 負責角色 | 前置條件 | 驗收方式 | Fallback |
|---|---|---|---|---|---|---|---|---|---|
| FR-PLAN-008 | 原始必要 | 一般正式方案只能使用 OR-Tools | 完成 | `src/agent/runtime.py`、`src/api/main.py`、`tests/test_formal_plan_guardrails.py` | 無 | 後端 | 合法 Dataset | API 與 Agent 正式 plan 皆為 ORTOOLS；Baseline confirm 回傳拒絕 | Baseline 僅能比較 |
| FR-PLAN-009 | 原始必要 | 完整性與規則合法性分開 | 完成 | `_plan_payload`、`DetailsPanel.tsx`、正式方案 regression | 公開最新版本待重驗 | 共同 | Plan、方案檢查證據 | 40／40 與方案檢查分開顯示；38／40 不可確認 | 不完整方案保留人工處理原因 |
| FR-UI-004 | 原始必要 | 單一控制塔與白話狀態 | 完成 | `frontend/src/App.tsx`、各 Panel、RTL／Playwright、`docs/screenshots/public-final/` | 無核心缺口 | 前端 | REST API | 公開畫面無重複頁名、主畫面 Raw JSON 或假地圖 | 地圖失敗保留列表 |
| FR-AGENT-004 | 原始必要 | 多語句 strict tool 選擇驗收 | 完成（本機） | 112 筆 fixture；24 個真實 Runner 案例 | 公開 12 案例待部署後執行 | 共同 | OpenAI credential | 工具、參數、結果及回答依據全部可驗證 | 無 key 回傳 503 |

本文件將已核准的產品需求拆解為可追溯的 requirements；若文字不一致，以 `ACTIVE_SPEC.md` 為準。

## 功能需求

| ID | 需求 | 驗證 |
|---|---|---|
| FR-IMP-001 | 匯入一個恰好包含四張具名工作表的 `.xlsx`。 | Workbook unit tests；import endpoint contract |
| FR-IMP-002 | 缺少 `location_label`、`time_slot` 或 package `weight_kg` 時，回傳 entity／field-specific `MISSING_REQUIRED_FIELD` error 與 `requires_manual_review`。 | `tests/test_competition_acceptance.py` field-level fixture |
| FR-IMP-003 | 彙總每張訂單的 package count 與 package weight，並保留可追溯的訂單總重量。 | `tests/test_import_validation.py`；`Order.total_weight_kg` |
| FR-VAL-001 | 驗證 IDs、relationships、counts、weights、coordinates、zones、slots、vehicle status/load。 | Validation suite；GD-003/004/010/011/012 |
| FR-PLAN-001 | 建立 deterministic initial 40-order dispatch plan。 | Optimizer／validator tests；GD-001 |
| FR-PLAN-002 | 同一 order 的所有 packages 保留在同一台 vehicle。 | Invariant test；AC-001 |
| FR-PLAN-003 | 每張 order 恰好指派一次，或分類為 unassigned。 | Invariant test；AC-001/003 |
| FR-PLAN-004 | 強制 capacity、availability 與 service-zone constraints。 | Constraint tests；GD-002/010/012 |
| FR-PLAN-005 | 強制 AM/PM、lunch、三分鐘 service 與 depot start/end。 | Time-dimension tests；GD-005 |
| FR-PLAN-006 | 依序最佳化 feasibility、travel time/distance，再平衡載重。 | Fixed-matrix objective tests |
| FR-PLAN-007 | 在可確認前，以 independent validation 檢查 solver output。 | Validator mutation/fault-injection tests |
| FR-BAS-001 | 使用穩定 input／tie ordering 提供 deterministic First-Fit Eligible Vehicle + Nearest Neighbor Baseline。 | GD-013；exact fixed-matrix snapshot |
| FR-BAS-002 | Baseline 保留 unsplittable orders，並強制 availability、capacity、service zone、time/lunch/service 與 depot return。 | Baseline invariant suite；GD-013 |
| FR-BAS-003 | Baseline 將每張無法合法安排的 order 輸出至 `unassigned_orders`；遺漏是 critical failure。 | Dropped-order reconciliation test |
| FR-OPT-001 | 以 OR-Tools CVRPTW 建模 optimized plan，包含 Capacity／Time Dimensions、hard AM/PM windows、lunch、180-second service、eligibility 與 depot start/end。 | Dimension／constraint tests；GD-014 |
| FR-OPT-002 | 使用 `PARALLEL_CHEAPEST_INSERTION` 再使用 `GUIDED_LOCAL_SEARCH`；canonical 40-order Benchmark 受 10 秒與 1,000 solutions 限制。 | Search-parameter contract test |
| FR-OPT-003 | 使用 deterministic integer dominance 依序最小化 unassigned count、total travel time、utilization gap；distance 獨立回報。 | Objective-priority tests |
| FR-OPT-004 | 分類 solver failure／timeout／infeasible states；只暴露明確且經獨立驗證的 partial solutions。 | Status mapping and partial-solution tests；GD-015 |
| FR-BENCH-001 | Baseline 與 Optimized 使用相同版本的 simulated matrix、40 orders、4 vehicles、5 zones 與 depot snapshot。 | Input-hash equality test；GD-014 |
| FR-BENCH-002 | 回報 distance、driving time、vehicle load/utilization、utilization gap、unassigned count、四類 violation counts、solve time 與 improvement percentages。 | Benchmark schema/formula tests |
| FR-BENCH-003 | 固定 Golden values 排除 Google live traffic；live comparison 僅驗證 invariants／ranges。 | Provider-mode rejection test |
| FR-URG-005 | Order 41 優先使用 minimum-change replanning；只有 bounded minimal-change 失敗後，才允許明確標示的 full-replan preview。 | Move-count／scope／diff tests；GD-018 |
| FR-EXP-001 | 只能使用 structured tool evidence 解釋 assignments。 | Agent eval；reason schema tests |
| FR-EXP-002 | 每個已分配 Plan stop 都暴露 zone eligibility、weight、post-load/utilization、time legality 與 matrix distance/order basis 的 deterministic evidence。 | Plan API evidence acceptance test |
| FR-MAP-001 | 回傳 depot、stops、coordinates、route polyline、color、sequence、ETA 與 leg metrics。 | Map-data response snapshot |
| FR-URG-001 | 將恰好一張出發前 urgent order 預覽為新的 immutable version。 | GD-006；lifecycle tests |
| FR-URG-002 | 回傳 before/after assignment、sequence、distance/time、load 與 conflict diff。 | Preview contract tests |
| FR-URG-006 | Urgent preview 計算非 placeholder 的 reassignment、sequence、load 與 distance/time deltas，並獨立驗證 candidate。 | Demo flow 與 order-41 acceptance test |
| FR-URG-007 | Urgent preview 比較精確的 base algorithm/version/dataset identity，並回傳 before／after hashes、assigned weight、unassigned IDs 與 per-vehicle loads。 | OR-Tools base regression test |
| FR-URG-003 | 要求對精確 plan/version 進行明確人工確認。 | Transition tests；AC-002 |
| FR-URG-004 | `DISPATCHED` 後拒絕 automatic insertion。 | GD-007；AC-006 |
| FR-STATE-001 | 持久化並 audit `DRAFT→VALIDATED→PROPOSED→CONFIRMED→DISPATCHED`。 | State-machine tests |
| FR-AGENT-001 | 一個 Agent 透過 strict tools 支援配送查詢、規劃、突發事件、風險與版本等自然語言 intents。 | Tool-routing Evals |
| FR-AGENT-002 | Agents SDK Agent 在回答 daily dispatch、load、unassigned 與 urgent-preview requests 前，必須呼叫 deterministic planning／evidence tool。 | `tests/test_agent_sdk_scenarios.py`；live opt-in E2E |
| FR-AGENT-003 | 缺少 structured data 時必須提出 clarifying question；prompt injection 不得觸發禁止 action；final text 只能重述 tool evidence。 | SDK guardrail 與 evidence tests |
| FR-API-001 | 提供最小 REST endpoints 與可用的 OpenAPI／Swagger。 | OpenAPI snapshot 與 endpoint integration tests |
| FR-API-002 | 回傳單一穩定 error envelope 與 request ID。 | Representative 4xx/5xx contract tests |
| FR-API-003 | `docs/api-contract.md` 所列原有 13 條 paths 與目前 5 條進階 paths 全部註冊並由 contract／OpenAPI tests 執行；Demo flow 在 dispatch 前停止。 | `tests/test_api_contract.py`；`tests/test_openapi_snapshot.py`；`tests/test_demo_flow.py` |

## 非功能與安全需求

| ID | 需求 | 驗證 |
|---|---|---|
| NFR-REL-001 | 沒有 OpenAI 時 core REST 仍可運作。 | OpenAI failure test |
| NFR-REL-002 | Google／TDX failure 必須明確降級，且不破壞 core planning。 | GD-009；provider fake tests |
| NFR-SEC-001 | logs／traces／context／Git 不得包含 secrets、PII、完整 workbook 或 chain-of-thought。 | Redaction tests 與 repository scan |
| NFR-SEC-002 | CORS origins 來自 environment；不得永久使用 wildcard。 | Settings／ready tests |
| NFR-SEC-003 | Untrusted chat／cells／provider text 不得覆寫 guardrails 或 approval。 | GD-008 injection tests |
| NFR-OBS-001 | 在不含 prompts、workbook contents 或 secrets 的情況下，關聯 request、dataset、plan/version 與 Agent run IDs。 | `JsonlEventRecorder` redaction 與 event-schema tests |
| NFR-COST-001 | 以 fail-closed `LIMIT_REACHED` 強制 8-turn、12-tool、30k-token、120-second 與 repeated-call limits。 | `RunBudget` boundary tests 與 Agent runtime integration |
| NFR-MNT-001 | Domain／optimizer／validator 不得 import Agent／LLM modules。 | Architecture dependency test |
| NFR-VER-001 | Python／dependencies／models 使用已審查的 locks／config。 | Lock consistency 與 config tests |
| NFR-REP-001 | Canonical Benchmark 固定 runtime／OR-Tools、fixture／matrix hash、integer units、ordering、tie-breakers、search parameters、process model、warm-up 與 measured-run protocol。 | Repeated-run route／metric equality；GD-014 |
| NFR-TEST-001 | Keyless simulated/mock tests 永遠可在沒有 network／credentials 時執行，並作為必要 CI/local gate。 | Keyless provider suite；GD-016 |
| NFR-TEST-002 | Live integration tests 僅在 provider-specific environment variables 存在時執行；否則 skip 或 fallback，不得失敗。 | Missing-key collection／execution test；GD-017 |
| NFR-SEC-004 | Tests 與 providers 絕不將 secrets 讀入 output、assertions、logs、traces、snapshots、fixtures 或 Git。 | Output-capture redaction 與 repository scan |

## 現況查證與範圍分類

下表依目前 `src/`、`tests/` 與 API 實際行為判定狀態。A 類是原始必要功能，不能改列為 P1；B 類是企業級擴充；C 類是本階段明確暫不處理。

| Requirement ID | 類別 | 工作內容 | 現況 | 實際證據 | 尚缺內容 | 負責角色 | 前置條件 | 驗收方式 | Fallback |
|---|---|---|---|---|---|---|---|---|---|
| FR-IMP-001／FR-IMP-002 | 原始必要 | Excel 四表匯入與 order／package／field 欄位驗證 | 完成 | `src/services/importer.py`；`tests/test_import_validation.py`、`tests/test_competition_acceptance.py` | 無核心缺口 | 後端 | `.xlsx` fixture | 40 orders／80 packages 可匯入；缺欄位回傳欄位級錯誤與 `requires_manual_review` | 無效資料拒絕，不猜測 |
| FR-IMP-003 | 原始必要 | 包裹件數與每張訂單重量加總 | 完成 | `Order.total_weight_kg`；import／planning tests | 無核心缺口 | 後端 | 合法 packages | 件數、重量與 fixture 總重一致 | 欄位錯誤進入人工複核 |
| FR-PLAN-004 | 原始必要 | 車輛載重、可用狀態與服務區域限制 | 完成 | `src/services/planner.py`、`src/services/validator.py`；競賽驗收 | 無核心缺口 | 後端 | vehicle／zone data | 零超載、零跨區、`UNASSIGNABLE` 明確列出 | 不合法訂單列入 `unassigned_orders` |
| FR-PLAN-001／FR-OPT-001 | 原始必要 | OR-Tools 分車與配送順序 | 完成（可接 simulated 或 Google Matrix） | `build_ortools`；`tests/test_planning.py`、`tests/test_top5_features.py` | 當前環境是否具備 Google 憑證需另行驗證 | 後端 | `MatrixResult` | Capacity／Time Dimensions、三種 objective 與 Validator 通過 | provider 失敗時明確回報，不宣稱 Live |
| FR-OPT-002 | 原始必要 | 三種可解釋方案 | 完成（本機 deterministic） | `src/services/planner.py`、`POST /api/v1/plans/compare`、`tests/test_top5_features.py` | 公開 Google Live 驗收仍受 provider 權限阻塞 | 後端／前端 | 同一 Dataset 與 Matrix | `FASTEST` 時間最佳、`BALANCED` 載重差最小、`STABLE` 最小時段餘裕最大，三者皆經獨立 Validator | Provider 失敗不得以 fallback 冒稱 Live |
| FR-PLAN-005 | 原始必要 | AM／PM、午休、每站 3 分鐘與 `DEPOT-001` 往返 | 完成（僅 simulated matrix） | planner／validator；time-window acceptance | 尚未以 live travel duration 驗證 | 後端 | 固定矩陣與時段 | 零 time-window violations，路線回到 depot | `TIME_WINDOW_CONFLICT` |
| FR-PLAN-007 | 原始必要 | 獨立 Validator | 完成 | `src/services/validator.py`；各 planning／competition tests | 無核心缺口 | 後端 | Plan 與 matrix | 每個可確認 plan 先通過 Validator | 失敗則不可確認 |
| FR-BAS-001／FR-BAS-003 | 原始必要 | 超重重新分配與 unassigned reconciliation | 完成（固定 Demo） | Z4 112 kg acceptance；Baseline／OR-Tools evidence | 尚未接入 live provider | 後端 | 40-order fixture | `VEH-002` 不超過 100 kg，合法使用 `VEH-003` | `UNASSIGNABLE` |
| FR-URG-001／FR-URG-006／FR-URG-007 | 原始必要 | 臨時插單 Preview、最小變動與前後差異 | 完成（固定 simulated matrix） | `try_minimal_insert`、`compute_plan_diff`；Demo regression | live route matrix 尚未接入 | 後端 | 未出發 plan、合法新訂單 | `MINIMAL_CHANGE`、before／after、Validator evidence | 無合法插入才 `FULL_REPLAN` |
| FR-STATE-001 | 原始必要 | 人工確認與方案版本管理 | 完成（SQLite 執行期持久化） | `confirm_plan`、`list_plan_versions`、`restore_plan`、SQLite repository tests | Render Free 跨重啟永久保存仍受檔案系統限制 | 後端 | 精確 `plan_id`／version、人工人工確認 | 每次復原建立新版本並重新 Validator；Dispatch 預設停用 | stale version 拒絕 |
| FR-AGENT-001 | 原始必要 | 單一 Agent 支援 daily dispatch、載重、unassigned、urgent preview 與資料澄清及通用事件工具 | 完成（runtime 與 HTTP orchestration） | `src/agent/runtime.py`、`src/api/main.py::agent_chat`、`tests/test_agent_sdk_scenarios.py` | 真實 OpenAI 服務需當前憑證才能標示 Live | 後端／共同 | Agents SDK runtime | 每則對話進入 `Runner.run`；strict tool evidence 回覆 | 無 key 時明確 503 |
| FR-AGENT-002／FR-AGENT-003 | 原始必要 | OpenAI Agent 真正呼叫 deterministic Tool | 完成（可執行；Live 依環境） | `/api/v1/agent/chat` → `run_dispatch_agent` → `Runner.run`；`tests/test_agent_sdk_scenarios.py` | 公開環境若缺 key 必須標示 BLOCKED，不能以 mock 取代 | 後端／共同 | OpenAI credentials（僅 live gate） | Agent tool call trace、Validator evidence、evidence grounding | 缺 key 回傳 503 |
| REQ-ORIG-001 | 原始必要 | Google Routes 真實 distance／duration | 部分完成（strict wiring；當前 Live 需憑證） | `src/providers/google_routes.py`、`_build_matrix`、provider wiring tests | 需在當前環境重新取得 provider response 才能標示 Live | 後端 | Google server key、terms／quota review | real matrix response 可追蹤且失敗明確；不得以 simulated 宣稱 live | 缺 key 明確標示 `SIMULATED`；已設定 key 失敗回傳 provider error |
| REQ-ORIG-002 | 原始必要 | Google Routes Matrix 真正進入 OR-Tools | 完成（可執行 strict path；Live 依憑證） | `_build_matrix`、`create_plan`、matrix hash/version consistency test | 公開驗收仍需當前 provider evidence | 後端 | REQ-ORIG-001 | 同一 MatrixResult identity 傳入 solver 並由 Validator 通過 | provider 失敗不得靜默降級 |
| REQ-ORIG-003 | 原始必要 | Google Maps Browser 顯示地圖、Marker、路線 | 完成 | `frontend/src/components/MapPanel.tsx` 與 Render 公開 Playwright：實際 Google map、站點與四車道路 polyline | 無核心缺口 | 前端 | Browser key、frontend origin | 瀏覽器實際顯示 Google map／Marker／polyline | 無 key 時保留列表並顯示未設定，不冒稱 Live |
| REQ-EXT-TDX-001 | 未來可選擴充 | TDX OAuth、真實路況與道路事件查詢 | 本版本未啟用 | 既有 `src/providers/tdx.py` 與 mock tests 保留 | 本輪不申請憑證、不做 Live 驗收 | 後端 | 未來產品決策與 TDX credentials | 若未來啟用，須以真實 response 與授權錯誤驗收 | 主畫面顯示「本版本未啟用」，不阻塞核心 Demo |
| REQ-EXT-TDX-002 | 未來可選擴充 | TDX 指出受影響路線與配送風險 | 本版本未啟用 | 既有 `correlate_events_to_plan` 與 mock coverage 保留 | 尚未排入本輪 | 後端／共同 | REQ-EXT-TDX-001、路線資料 | 未來須讓風險可追溯至真實 TDX evidence | 不參與本輪完成判定 |
| REQ-ORIG-006 | 原始必要 | 前端完整顯示訂單、車輛、載重、路線與 Agent | 完成（控制塔 UI；Provider 狀態依環境） | `frontend/`、RTL tests、`docs/frontend-handoff.md` | 當前公開環境仍需再次確認 credentials 與瀏覽器流程 | 前端 | REST API、Browser key | 三條操作流程與 evidence 畫面可在瀏覽器完成 | provider 降級狀態必須明確顯示 |
| REQ-ORIG-007 | 原始必要 | Google／OR-Tools／OpenAI Agent／前端整合驗證 | 完成 | backend／frontend tests、`tests/test_top5_features.py`、Render 公開空白首頁單次線性 Playwright | 無核心缺口 | 共同 | Google／OpenAI credentials | 瀏覽器到真實 provider 的完整流程通過且正式派車 requests 為 0 | Live 失敗須明確標示，不以 simulated 取代 |

### 企業級擴充功能（B 類）

下列 9 項為企業 TMS 對照後的擴充，與 A 類原始必要功能分開管理，現況均為 `PLANNED`：

1. ERP／WMS／電商訂單整合層。
2. 車輛出發後的路況與 ETA 持續監控。
3. 路況改變後的動態重新試算。
4. 例外控制塔。
5. 準時優先、距離優先、最小變動等多方案比較。
6. 完整 Why／What-if 排程診斷。
7. 客戶 ETA 與延遲通知預覽。
8. 計畫與實際結果比較。
9. 成本、油耗與碳排儀表板。

### 目前暫不處理（C 類）

1. 正式 ERP／WMS 客製串接。
2. 司機 App。
3. GPS 硬體。
4. 電子簽收。
5. 3D 裝載。
6. 多配送中心。
7. 外包車隊與承運商計價。
8. 正式簡訊發送。
9. 正式環境部署。

## 已核准需求覆蓋

| 正式主題 | 功能／決策 | Tests | 主要檔案 |
|---|---|---|---|
| Orders／areas／windows／packages／weights | 四工作表 workbook 與 domain validation | workbook suite | `ACTIVE_SPEC.md` §4 |
| Vehicle max/current load 與 service zones | Hard candidate 與 capacity constraints | GD-002/010/012 | `ACTIVE_SPEC.md` §3/5 |
| Explainable assignment/order | Evidence schema 與 Agent explanation | Agent evidence Eval | `api-contract.md` |
| Overweight／time conflict／unassignable | 穩定 exception codes 與 partial plan | GD-003/005/012 | `api-contract.md` |
| Urgent order 41 | 出發前 versioned preview／diff | GD-006/007 | `urgent-order-insertion.md` |
| Human confirmation | Plan state machine 與 audit event | lifecycle tests | `guardrails.md` |
| Single Agent | 一個 Agent，不使用 handoff／A2A／AP2 | architecture test | `architecture.md` |
| Deterministic algorithms | Services／function tools；不使用 LLM arithmetic | unit／invariant tests | `developer.md` |
| Baseline comparator | First-Fit Eligible Vehicle + Nearest Neighbor | GD-013 | `architecture.md` ADR-004 |
| OR-Tools CVRPTW | Capacity／Time Dimensions、明確 search strategy／limits、Validator | GD-014/015 | `architecture.md` ADR-004 |
| Fair Benchmark | 相同 fixed matrix／data；version/hash 與 metric formulas | GD-014 | `architecture.md` ADR-005 |
| API Key test layering | Always-on keyless suite；conditional live suite；secret redaction | GD-016/017 | `architecture.md` ADR-006 |
| Depot／zones／vehicles | 固定參考資料 | fixture validation | `ACTIVE_SPEC.md` §3 |
| 40 orders／350–380 kg／concentration | Fixed-seed sample | sample audit | demo workbook |
| Working hours／lunch／service time | Hard time dimensions | time tests | `ACTIVE_SPEC.md` §5 |
| Google Routes | Provider interface、field mask、split keys、fallback | provider tests | `architecture.md` |
| TDX | 既有 provider adapter 保留；本版本不啟用，列為未來可選擴充 | 既有 mock/provider tests，不納入本輪 Live gate | `implementation-plan.md`、`architecture.md` |
| SQLite | Versioned persistence／audit | repository tests | `architecture.md` |
| REST／OpenAPI／CORS | Contract-first API | 13-route contract tests plus OpenAPI hash snapshot | `api-contract.md`、`openapi-snapshot.sha256` |
| Observability／cost | Structured logs、tracing、limits | schema／limit tests | `observability.config` |
| Golden／red team | Concrete algorithm、provider、Agent、injection 與 API contract cases | Eval runner | `golden-dataset.json` |

## 驗收矩陣

| 案例 | 必要 evidence |
|---|---|
| Z4 concentration (112 kg) | Baseline 不得讓 100 kg 的 VEH-002 超載；至少一張 Z4 order 合法分配至 VEH-003；Validator 通過 |
| Missing workbook cells | 分別回傳 order／package／field paths 與 manual-review flags |
| Time-window conflict | 穩定的 `TIME_WINDOW_CONFLICT` reason 與 validator-safe partial plan |
| Capacity exhaustion | 穩定的 `UNASSIGNABLE` reason、明確 order ID，且不得靜默遺失 |
| Order 41 preview | 視情況回傳非空的 sequence／load／reassignment data 與計算後 metric deltas |
| Chinese demo | `scripts/run_p0_demo.py` 列出所有 evidence 與 approval checkpoint，且不 Dispatch／deploy |

## 功能狀態分類

### 核心 deterministic 功能

固定 simulated matrix 範圍內的 Import／validation、package weight aggregation、deterministic planning／validator、route／map payload、overload redistribution、urgent preview／diff、REST／OpenAPI、single Agent runtime／tool layer、provider wiring／status、frontend control tower、tests、README 與 frontend handoff 均已有實作或測試證據。`FR-STATE-001` 的 durable lifecycle persistence、Live Provider E2E 與完整前後端 Live E2E 仍為部分完成或未完成，詳見上方現況表。

### 原始必要功能的整合工作（A 類）

以下能力原本即屬產品必要範圍，不得改列為 P1 或可選功能；本輪只記錄缺口，不開始實作：

1. Google Routes 提供真實 distance／duration。
2. Google Routes Matrix 真正進入 OR-Tools 排程。
3. Google Maps Browser API 在瀏覽器顯示地圖、Marker 與車輛路線。
4. 前端完整顯示訂單、車輛、載重、路線與 Agent。
5. Google、OR-Tools、OpenAI Agent 與前端完成整合驗證及 Live E2E。

TDX OAuth、真實路況與路線風險已移至未來可選擴充，不列入本次競賽 Demo 完成條件。

第 1 至第 6 項已完成 keyless wiring 或 local UI 的部分範圍，但仍需相應 credentials 與瀏覽器證據；第 7 項尚未完成。simulated、mock、fallback 或 skipped test 不能作為 A 類 Live Integration 完成證據。

## 需求變更規則

任何重大變更在實作前都必須更新 Spec ID、受影響的 API schema、Golden case、deterministic tests、migration／rollback impact 與 changelog。
