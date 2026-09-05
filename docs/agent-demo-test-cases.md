# Agent 對話驗收案例

## 測試資料集

機器可讀案例位於 `tests/fixtures/agent_dialogue_cases.json`，由
`scripts/generate_agent_dialogue_cases.py` 產生。資料集固定為 112 題，欄位包含使用者原句、
前置狀態、預期 strict tool、參數限制、證據來源、是否允許 Preview、是否需人工確認、
HTTP 狀態與禁止行為。

| 類型 | 題數 |
|---|---:|
| 一般說明與能力詢問 | 8 |
| 解釋分車與路線原因 | 12 |
| 查詢載重、訂單、車輛 | 12 |
| 車輛故障／停用 | 12 |
| 資料不完整的臨時單 | 12 |
| 資料完整的臨時插單 | 12 |
| 延遲模擬 | 8 |
| 凍結站點 | 8 |
| 三種策略比較 | 8 |
| 手動換車／順序變更 | 8 |
| 模糊、無效或矛盾要求 | 8 |
| Prompt injection | 4 |
| 合計 | 112 |

112 題的自動化契約測試為 `tests/test_agent_dialogue_corpus.py`。這一層驗證 strict tool
allowlist、Preview／人工確認邊界與禁止正式派車，屬於 `MOCK PASS`，不可冒充 LLM Live。

## 24 題 OpenAI Live Runner 閘門

`tests/test_live_agent_dialogue_corpus.py` 會逐題呼叫 OpenAI Agents SDK `Runner.run`，並驗證
LLM 所選 strict tool、deterministic evidence、ToolCallItem 與 no-dispatch allowlist。代表案例涵蓋：

- 四種能力／欄位／載重／插單說明。
- 載重最高車輛、`ORD-001` 分配及未安排查詢。
- 最快／均衡／穩定三策略比較。
- 10、20、30 分鐘延遲。
- `VEH-003` 正式 ID、口語「三號車」故障與恢復。
- 訂單時段、優先級、前五站凍結與解除凍結。
- 指定換車、版本查詢與人工確認說明。
- 資料不足的急單與任意 `TMP-901` 結構化急單。
- 正式方案建立。

執行方式：

```powershell
$env:RUN_LIVE_AGENT_CORPUS='1'
.\.venv\Scripts\python.exe -m pytest tests/test_live_agent_dialogue_corpus.py -q
```

憑證缺少時必須 `SKIPPED`；模型或服務失敗時必須失敗並顯示安全錯誤分類，不得改用固定回答。

## 安全判定

- Prompt injection 由 input guardrail 攔截，regex 僅用於安全模式與格式驗證，不參與配送意圖選擇。
- 配送意圖與工具選擇由 `Runner.run` 完成。
- 所有重量、車輛、距離、時間、時段、風險與方案合法性由 deterministic tool 計算。
- Agent allowlist 沒有正式派車工具；所有變更只建立 Preview，需由調度員確認。
- 回答中的數字與 ID 必須通過 `evidence_grounded_answer`。
