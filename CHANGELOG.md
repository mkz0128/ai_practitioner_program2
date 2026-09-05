# 變更紀錄

## 2026-09-06 — 明晚 Demo 穩定性與公開線性驗收

- 公開 Render 以同一個 Chromium 會話從空白首頁完整跑完 Excel、40／40、4／4、Google 地圖、Agent、拖拉換車、取消、ORD-041、人工確認、三策略、延遲與版本，結果 `1 passed`；未處理錯誤與正式派車請求皆為 0。
- 視覺驗收發現車輛停用與延遲回答仍可能顯示 JSON／英文內部欄位；已 regression-first 改為證據導向的繁體中文摘要，並補強 ORD-041 差異摘要與未知 JSON fail-closed 顯示。
- 最新品質結果：Backend `219 passed、28 skipped`；112-case corpus `115 passed`；OpenAI Live Runner `24 passed`；Frontend Vitest `20 passed`，TypeScript、ESLint、Vite build、Ruff、mypy 與 secret scan 均通過。
- Commit `550f736` 已在 Render 顯示 Live；公開網站再由空白首頁完整演練一次，結果 `1 passed`（4.6 分鐘），Console／page error 與正式派車請求皆為 0。
- 修正固定 ORD-041 在不同即時交通結果下偶爾退化為全面重排：示範單改與既有合成站點同位置，並新增 `MINIMAL_CHANGE`、單車影響與零既有訂單換車回歸斷言；Render `7769a97` 公開完整流程 `1 passed`（5.1 分鐘）。
- 修正均衡策略只壓低最大載重、未同時拉近低載重車輛的目標落差；Capacity 終點加入平均需求軟界線，公開結果的載重差由 `18 kg` 改善為 `8 kg`，小於最穩定方案的 `24 kg`，並新增瀏覽器數值斷言。
- regression-first 修正空白首頁把「尚未使用」誤顯示為 Google 路線故障；Google Maps 的「已連線」只在地圖實際載入後成立，TDX 依本輪範圍顯示「本版本未啟用」。
- 修正有 validated dataset 的自然語言「請匯入這份訂單並建立今天的配送方案」被 Agent 誤選為臨時插單缺欄流程；真實 `gpt-5-mini` `Runner.run` 已選用 strict `plan_dispatch`。
- 車輛清單可展開所有訂單，保留真正的 drag-and-drop 與「移至其他車輛」無障礙替代操作；不完整 Preview 現在會停用「套用變更」並顯示白話原因。
- 新增可重複的 `playwright.public.config.ts` 與公開網站單一路徑驗收，從空白首頁涵蓋 Excel、40／40、4／4、地圖、Agent、拖拉、ORD-041、三策略、延遲、版本、人工確認、Console 與零正式派車請求。
- 本機品質閘門：Backend `216 passed、28 skipped`、Ruff、mypy；Frontend TypeScript、ESLint、Vitest `16 passed`、production build；Playwright core `2 passed`、第二組隨機資料／純附件 `2 passed`。24 個明確 Live Runner 語料另行實跑為 `24 passed`。
- 新增 `docs/demo-runbook.md`，統一競賽流程、亮點流程、現場十題、按鈕驗收與外部服務備用流程；TDX 移至未來可選擴充，不阻塞本輪。

## 2026-09-05 — 公開 ORD-041、Google 與人工確認最終回歸

- `preview_urgent_insert` 在 Agents SDK 選定工具後，可從 deterministic 示範資料註冊表解析 ORD-041；任意新訂單仍使用 strict structured schema，不新增 Regex 或關鍵字意圖路由。
- 新增「沒有 pending context 也能解析文件化示範訂單」回歸測試；完整後端為 `216 passed、28 skipped`，Ruff、mypy 與 secret scan 通過。
- Render `cb53615` 公開驗收通過 40／40 Google Matrix→OR-Tools、真實 Google 地圖、三策略同 Matrix、拖拉換車 Preview、ORD-041 40→41、人工確認及 10／20／30 分鐘延遲預覽。
- 公開 Agent 回傳 `RunResult` 與 strict tool evidence；Prompt injection 被拒絕，Console 未處理錯誤與正式派車請求皆為 0。TDX 因憑證未設定維持外部阻塞。

## 2026-09-05 — 公開驗收前的控制塔與 Provider 狀態修正

- 方案明細新增搜尋、車輛／時段篩選與每頁十筆分頁，並將插單與換車統一呈現為「變更差異」。
- 拖拉換車的 Playwright 案例現在等待實際 `/reassign/preview` 回應，驗證後端差異、取消與人工確認邊界，而非只檢查前端外觀。
- 三策略比較可帶入目前 `plan_id`／`version`，重用該版本的同一份 Matrix，避免重複呼叫 Provider 或混用資料來源。
- Provider 狀態分開表示 `configured`、`connected`、`failed` 與 `disabled`；Key 存在不再直接顯示「已連線」。
- 補強正式派車規則繞過語句的 Prompt injection guardrail；此 regex 僅做安全阻擋，不參與一般意圖或工具選擇。

## 2026-09-05 — 公開 Agent 空資料安全修正

- 修正公開網站尚未匯入訂單時，Agent 誤選規劃型工具會把零車輛資料送入 OR-Tools，導致 Render 程序中止與後續 HTTP 502 的問題。
- 所有會進入求解器的 Agent 工具現在先做程式層資料就緒檢查；資料不足時回覆需附加 Excel 或使用範例，不執行求解器，也不建立待確認方案。
- 新增八條空資料集 strict-tool 回歸測試；完整後端測試為 `212 passed、28 skipped`，無失敗。

## 2026-09-05 — 正式方案護欄與單一控制塔

- 一般建立、重新規劃與 Agent 排程一律使用 OR-Tools；快速初步方案僅保留於比較，不能成為可確認方案。
- Plan API 分開回傳方案完整性、規則檢查與可確認性；未安排、缺欄、provider 不完整或規則違規皆會停用確認。
- 固定 40 單 regression 證明正式方案為 40／40 且使用 4／4 台；快速初步方案的 38／40 不再出現在正式工作流。
- 將前端整理為單一「今日配送規劃」控制塔，移除重複頁名、假地圖、主畫面技術代碼及 Raw JSON；保留地圖失敗時的可用清單檢視。
- 車輛清單加入真正的換車 Preview 拖放與鍵盤替代操作；成功候選仍須人工確認，失敗不改變目前方案。
- 新增 112 筆 Agent 對話語料、24 筆真實 OpenAI Runner 代表性驗收及正式方案／安全錯誤 regression。

## 2026-09-05 — 三策略指標與 Provider 錯誤分類

- 修正 `BALANCED` 的 OR-Tools 成本函數，改以 Capacity dimension span 平衡載重；`FASTEST`、`BALANCED`、`STABLE` 的公開指標排序新增回歸測試。
- 策略比較 API 與前端新增 `primary_goal`／`tradeoff`，避免以名稱誤解方案取捨。
- 新增 `request_missing_fields` strict Agent tool，臨時訂單資訊不足時會明確追問必要欄位。
- Google Routes HTTP 錯誤改為安全分類，保留 `PROVIDER_UNAVAILABLE` 行為，不輸出回應內容或憑證。
- 最新 deterministic suite：`82 passed、4 skipped`；公開 Render simulated plan 通過，Google AUTO Live 仍因 `PROVIDER_UNAVAILABLE` 阻塞。

## 未發布 — 2026-09-03

### 2026-09-05 實作閘門更新（歷史快照）

- 擴充 Single Agent strict tools 與 deterministic services；新增三個真正不同的 OR-Tools objective（`FASTEST`、`BALANCED`、`STABLE`），並以回歸測試驗證三組結果 fingerprint 不同且均通過 Validator。
- 規劃型 Agent tools 維持 strict deterministic invocation，並記錄 HTTP live gate 在本機 ASGI harness 觸發 OR-Tools 原生 abort；狀態保留為 `BLOCKED`，未宣稱完成。
- 本輪 OpenAI Responses 與 direct Agents SDK live gate 各 1 passed；Google Routes live gate 實際回傳 `GOOGLE_HTTP_403`，未使用 fallback。Browser key 與 TDX credentials 未設定。
- 最新本機品質結果：後端 `56 passed、4 skipped`，Ruff／mypy 通過；前端 TypeScript／ESLint／Vitest（3 tests）／Vite production build 通過。未執行 Dispatch、部署或正式環境操作，未提交任何 secrets。

### 2026-09-05 通用 Agent 與進階功能

- `/api/v1/agent/chat` 以 `Runner.run`、strict allowlist tools 與結構化 dataset context 編排配送請求；Agent 執行 `plan_dispatch` 後由 API 保存不可變 plan version。
- 新增 `FASTEST`、`BALANCED`、`STABLE` 三策略比較、延遲風險預覽、車輛／時段／優先順序／凍結站點預覽、通用換車預覽與批次臨時插單 strict tool。
- `DISPATCH_ENABLED=false` 預設 fail-closed；confirm／restore 重新執行 Validator，禁止不完整或有未安排訂單的方案確認。
- 前端附件匯入不再直接建立方案；附件與自然語言訊息會在同一輪交給 Agent，並新增拖拉換車預覽 UI。
- 擴充 Unicode 正規化 Prompt injection guardrail 與 evidence grounding；新增 `tests/test_top5_features.py` 與 strict multiple urgent regression。

### 2026-09-05 最新工作樹驗證

- 後端完整 deterministic suite：`78 passed、4 skipped`；四個 skipped 僅是明確 opt-in 的 OpenAI Responses、Agents SDK、HTTP Agent 與 Google Routes gates。
- OpenAI Responses 與 direct Agents SDK live gate 各 `1 passed`；Google Routes live gate 實際回傳 `GOOGLE_HTTP_403`，未啟用 fallback。HTTP Agent gate 在 Windows OR-Tools 原生邊界觸發 `Fatal Python error: Aborted`，標記為 `BLOCKED`。
- 三種策略、延遲風險、凍結站點、通用換車／批次插單、版本與結構化 session pointer 均有 deterministic regression coverage；前端 TypeScript、ESLint、Vitest `3 passed`、Vite build 與 Playwright regression `2 passed、3 skipped`。
- 本輪維持 `DISPATCH_ENABLED=false`，Dispatch requests `0`；未執行部署、正式環境操作或 force push，未提交任何 secrets。

### 2026-09-05 競賽公開驗收補充

- 以 Render 公開網址重新核對健康檢查、13 條 API 契約、40 單 Google Matrix → OR-Tools → Validator、OpenAI Agent、Google Maps 與 ORD-041 preview。
- 修正前端服務狀態列：Browser key 由 runtime config 設定時，Google Maps 狀態顯示為已設定，不再誤報未設定。
- 修正 OR-Tools 路線結果重建：以求解器原始順序計算路線指標，避免合法車輛路線被最近鄰重排誤判為不可行；新增回歸測試。
- Agent 回應若為工具 JSON，前端改以 evidence-first 繁體中文摘要呈現，避免 Raw JSON 出現在主要對話畫面；新增 Vitest 回歸測試。
- 新增公開驗收與競賽缺口紀錄；CSV（目前四表 `.xlsx` 契約）與 TDX Live 仍明確標示為阻塞／加分項，不冒稱完成。
- 保持 Dispatch requests 為 0；未執行正式環境操作、付費資源、force push 或合併 `main`。

### 2026-09-05 公開驗收修正

- Render 公開網址完成競賽核心流程查證：官方 40 單、Google Matrix → OR-Tools、Validator、Google Maps、OpenAI Agent 與 ORD-041 preview。
- 修正 Agent 方案證據的 `vehicle_count`，只計算實際承載訂單的車輛，避免空車造成摘要誤導。
- 新增 API malformed payload 的欄位級錯誤 envelope 與 `requires_manual_review` 標記；不回傳未信任的 raw input。
- TDX 維持 `OPTIONAL／NOT_CONFIGURED`；未執行 Dispatch、正式環境操作或付費資源建立。

### 新增

- Workbook 缺漏欄位錯誤可精確定位 order／package／field，並帶有 manual-review markers。
- 以 deterministic evidence 產生涵蓋 zone、weight、load、time 與 matrix 順序的 Plan stop recommendations。
- 計算 urgent-insert 的 reassignment、sequence、vehicle-load 與 distance/time deltas。
- 新增可執行的競賽驗收 tests 與中文 `scripts/run_p0_demo.py` preview walkthrough。
- 新增 GD-026–GD-030 Golden Dataset cases，涵蓋 field validation、evidence、urgent diff、Demo 與 Validator gates。
- 完成已追蹤說明文件的繁體中文化與對外內容清理，統一產品定位並移除內部交付規劃描述；未變更程式、API、演算法或測試邏輯。
- `/api/v1/agent/chat` 的無資料流程改由 OpenAI Agents SDK `Runner.run` 呼叫 strict `assistant_help`；ORD-041 preview evidence 改用同一基準 plan 的 deterministic `MINIMAL_CHANGE` diff。
- 前端聊天快捷問題改為真正送入 Agent；Agent preview evidence 會驅動 immutable REST preview 與人工確認流程，主畫面來源資訊改為白話文字。
- 新增 `frontend/tests/e2e/live-control-tower.spec.ts`，以真實 OpenAI／Google provider 驗證無資料聊天、40 單匯入、Google Maps、Agent 多輪、ORD-041、人工確認、配送任務與配送路線；新增 7 張 1440×900 截圖。

### 安全與狀態

- 歷史人工驗收曾將 Backend P0、OpenAI Agent 與 Frontend Live control tower 標記為 `DONE`；本輪重新驗證後，HTTP Agent／Google／Browser 依目前環境分別標記 `BLOCKED`，TDX 為 `OPTIONAL／NOT_CONFIGURED`，Overall Project 維持 `IN_PROGRESS`。
- 保留驗收 evidence：合法 overload redistribution、40-order OR-Tools zero-violation plan、`ORD-041` `MINIMAL_CHANGE`、existing-order vehicle moves 為 0、僅 `VEH-003` 受影響、`+137 m`、`+17 s` 與 independent Validator `PASS`。
- Demo 不執行 Dispatch、deployment 或 formal environment 操作。
- Urgent insertion 比較精確的 OR-Tools base plan，預設使用 validated `MINIMAL_CHANGE`；full replan 必須明確回傳 mode、reason 與 movement scope。

## 0.1.0-spec — 2026-09-01

### 新增

- 可解釋 AI 配送調度 Copilot 的 canonical product specification。
- Single-Agent architecture 與兩個 workflow Skills。
- REST API 與 frontend handoff contracts。
- Deterministic validation、optimization、plan versioning 與 fallback requirements。
- Version-locked Python toolchain 與 resolved dependency lock。
- 專案專用的 observability、denial-of-wallet、security、Evals 與 human approval rules。
- 四工作表 input template 與固定 seed 的 40-order Demo dataset plan。

### Security

- Feature implementation 在收到 `APPROVE_IMPLEMENTATION` 前維持鎖定。
- 禁止 production、secrets、PII、deployment、external writes 與冒用使用者 confirmation。
