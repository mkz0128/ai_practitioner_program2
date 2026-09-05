# 變更紀錄

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
