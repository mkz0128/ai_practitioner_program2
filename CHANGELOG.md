# 變更紀錄

## 未發布 — 2026-09-03

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

- 人工驗收已將 Backend P0、OpenAI Agent 與 Frontend Live control tower 標記為 `DONE`；TDX 為 `OPTIONAL／NOT_CONFIGURED`，Overall Project 維持 `IN_PROGRESS`。
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
