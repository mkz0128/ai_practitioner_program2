# AI 智慧配送路線與載重規劃 Agent

三天 MVP 的定位是「可解釋的配送調度 Copilot」：以單一 OpenAI Agent 理解自然語言並操作嚴格 schema 的 function tools；所有資料驗證、重量計算、分車、路線、時段和狀態轉移都由確定性程式負責。

已收到 `APPROVE_IMPLEMENTATION`；目前已啟用本機 Feature Code 實作，並維持不部署、不啟用 Actions、不接觸正式環境的安全邊界。

## Sources of Truth

- 產品規格：`spec-driven/ACTIVE_SPEC.md`
- 本輪進度與問題：`docs/project-status.md`
- 最近一次驗證證據：`docs/validation-report.md`
- 安全與人工核准：`.agent/guardrails.md`
- API 合約：`docs/api-contract.md`
- 架構決策：`docs/architecture.md`
- 三天計畫：`docs/implementation-plan.md`
- 工作流程：`.agent/skills/daily-dispatch.md`、`.agent/skills/urgent-order-insertion.md`

## Round Progress Management

每輪開始先讀 Active Spec、Project Status、Validation Report，再讀 Guardrails、Developer Contract 與相關 Skill。`project-status.md` 同時只能有一個 `NOW`，`NEXT` 最多三項；所有新問題先依類型進入 `OPEN ISSUES`，真正阻止工作的條件才進入 `BLOCKED`。完成後必須更新 `DONE THIS ROUND` 與 `LAST VALIDATION`。

不得另外建立 `NOW.md`、`TODO.md`、`DONE.md` 或第二套進度真實來源。

## Locked Stack

- CPython 3.12.13
- FastAPI 0.141.1 / Pydantic 2.13.5
- OpenAI Agents SDK 0.22.0
- OR-Tools 9.15.6755
- SQLAlchemy 2.0.52 / SQLite
- pandas 3.0.5 / openpyxl 3.1.5
- pytest 9.1.1 / ruff 0.16.5 / mypy 2.3.1

Direct pins are in `pyproject.toml`; the Python 3.12 Windows resolution is in `requirements.lock`. No dependency was installed during the specification round.

## Workbook Contract

Both input workbooks contain exactly four sheets: `orders`, `packages`, `vehicles`, and `zones`.

The only list delimiter in Excel is the pipe character `|`. Examples:

- `service_zone_codes`: `Z1|Z2|Z3`
- `covered_cities`: `新北市|臺北市`
- `covered_districts`: `板橋|新莊|三重`
- `tdx_city_codes`: `NWT|TPE`
- `adjacent_zone_codes`: `Z2|Z3`

REST responses always expose these values as JSON arrays; delimiter strings never cross the API boundary.

## External Provider Modes

- Default demo mode: `SimulatedRouteProvider` plus reproducible simulated congestion.
- Google Routes: optional, server-side key, strict field mask, timeout, cache policy review, graceful fallback.
- TDX: optional P0 health/status integration; real road-to-zone congestion mapping is P1.
- OpenAI unavailable: REST import, validation, planning, confirmation, and queries remain available; only `/agent/chat` degrades.

本機 `.env` 僅供已核准的開發環境使用，永不提交；`.env.example` 只保留空白變數與 `gpt-5-mini` 預設模型。

## Planned Local Commands

These commands run the local implementation and keyless validation gates:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m mypy src
```

## Scope Exclusions

No production deployment, live TMS/ERP/GPS, WebSocket, vehicle-in-motion insertion, depot return for pickup, real fleet control, multi-Agent, A2A, or AP2 is included in this MVP.
