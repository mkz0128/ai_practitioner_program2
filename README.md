# AI 智慧配送路線與載重規劃 Agent

一個調度員可以用講話指揮的配送控制塔。系統會排班，但核心價值是：**在每個時間點提供數個帶有明確代價的選項，由調度員決定。**

單一 OpenAI Agent 負責理解自然語言並調用具明確 Schema 的工具。資料驗證、重量彙總、車輛分配、路線最佳化、時段約束與狀態管理，全部由確定性程式執行。**LLM 不產生任何數字。** 所有方案由調度人員確認。

## 六項功能

| # | 功能 |
|---|---|
| F1 | 上傳訂單 → 吃不同格式 → 缺欄反問 → OR-Tools 排班 |
| F2 | 提出司機限制 → 記入規則 → 以後排班自動套用 |
| F3 | **上車前**臨時插單 → 動態方案卡＋對話修改 → 調度員選擇 |
| F4 | **上車後**臨時插單 → 動態方案卡＋對話修改 → 調度員選擇 |
| F5 | **已發車**時既有訂單須提前 → 重排該車剩餘站點 |
| F6 | 配送偏差記錄 → 回饋為排班參數修正 |

三個配送階段不是三套演算法，是**同一個求解器搭配三組不同的鎖**。隨時間推進，既成事實增加，可變動的決策變數逐階減少。

## 文件

| 內容 | 檔案 |
|---|---|
| **產品規格（唯一）** | `spec-driven/ACTIVE_SPEC.md` |
| **進度 NOW／TODO／DONE** | `docs/progress.md` |
| 專案規則（每次載入） | `CLAUDE.md` |
| 流程規則 | `AGENTS.md` |
| 安全與核准政策 | `.agent/guardrails.md` |
| 產品工作流程 | `.agent/skills/` |

v1 的規格、進度與驗證紀錄已於 2026-09-09 刪除。目前狀態一律以上述文件為準。

## 目前狀態

規格為 v2，**尚未開始實作**。取得 `APPROVE_V2` 前不修改 Feature Code。

後端既有的 OR-Tools 求解、獨立 Validator、方案差異計算、SQLite 版本與稽核**保留不動**。前端 `frontend/` 將全數重寫。

## 技術棧

CPython 3.12.13 · FastAPI 0.141.1 · Pydantic 2.13.5 · OpenAI Agents SDK 0.22.0 · OR-Tools 9.15.6755 · SQLAlchemy 2.0.52 / SQLite · pytest 9.1.1 · ruff 0.16.5 · mypy 2.3.1

前端將改用 Tailwind CSS + shadcn/ui（移除 MUI 與 emotion）。

版本固定於 `pyproject.toml`；Windows Python 3.12 解析結果記錄於 `requirements.lock`。模型固定 `gpt-5-mini`，不得靜默升級。

## 本機指令

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m mypy src
```

啟動後端：

```powershell
$env:CORS_ALLOWED_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"
.\.venv\Scripts\python.exe -m uvicorn src.api.main:app --reload --host 127.0.0.1 --port 8000
```

Swagger 位於 http://127.0.0.1:8000/docs ，readiness 位於 `/ready`。

## 外部服務

**開發期間 Google Routes 與 Maps 一律停用**，全面使用 `SIMULATED`：不設定 `GOOGLE_ROUTES_SERVER_API_KEY` 與 `VITE_GOOGLE_MAPS_BROWSER_API_KEY`，`route_provider_preference` 明確傳 `SIMULATED`。介面持續顯示「模擬資料」標示，不得表述為 Live。全部功能完成後再接回驗收。

TDX 不啟用。

`.env` 永不提交。絕不將 `OPENAI_API_KEY` 或任何 server key 暴露至 browser bundle。

## 安全邊界

- 單一 Agent，不使用 handoff、multi-Agent、A2A、AP2。
- LLM 不執行重量加總、合法性檢查、車輛指派、路線排序、時段檢查與狀態轉換。
- 所有方案必須通過獨立 Validator；未通過不得確認。
- Preview 不可變且不覆寫既有版本；人工確認為唯一生效途徑。
- `DISPATCH_ENABLED` 預設 `false`。
- 不使用真實客戶姓名、電話或完整地址。
