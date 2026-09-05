# AI 智慧配送路線與載重規劃 Agent

本系統是一套可解釋的 AI 配送調度 Copilot。單一 OpenAI Agent 負責理解自然語言並調用具明確 Schema 的工具；資料驗證、重量彙總、車輛分配、路線最佳化、配送時段約束及狀態管理，均由確定性程式執行，確保結果可驗證、可解釋且可追溯。所有最終配送方案仍由調度人員確認。

已收到 `APPROVE_IMPLEMENTATION`；目前已啟用本機 Feature Code 實作。Render 部署設定限定於 `feat/frontend-control-tower` 的 Free 測試服務，不啟用 Actions、不合併 `main`、不執行 Dispatch。

## 真實來源

- 產品規格：`spec-driven/ACTIVE_SPEC.md`
- 本輪進度與問題：`docs/project-status.md`
- 最近一次驗證證據：`docs/validation-report.md`
- 安全與人工核准：`.agent/guardrails.md`
- API 合約：`docs/api-contract.md`
- 架構決策：`docs/architecture.md`
- 實作計畫：`docs/implementation-plan.md`
- 工作流程：`.agent/skills/daily-dispatch.md`、`.agent/skills/urgent-order-insertion.md`

## 每輪進度管理

每輪開始先讀 Active Spec、Project Status、Validation Report，再讀 Guardrails、Developer Contract 與相關 Skill。`project-status.md` 同時只能有一個 `NOW`，`NEXT` 最多三項；所有新問題先依類型進入 `OPEN ISSUES`，真正阻止工作的條件才進入 `BLOCKED`。完成後必須更新 `DONE THIS ROUND` 與 `LAST VALIDATION`。

不得另外建立 `NOW.md`、`TODO.md`、`DONE.md` 或第二套進度真實來源。

## 鎖定技術棧

- CPython 3.12.13
- FastAPI 0.141.1 / Pydantic 2.13.5
- OpenAI Agents SDK 0.22.0
- OR-Tools 9.15.6755
- SQLAlchemy 2.0.52 / SQLite
- pandas 3.0.5 / openpyxl 3.1.5
- pytest 9.1.1 / ruff 0.16.5 / mypy 2.3.1

直接相依套件版本固定於 `pyproject.toml`；Windows Python 3.12 的解析結果記錄在 `requirements.lock`。核准的本機 `.venv` 依此 lock 安裝，且不修改全域 Python。

## Workbook 契約

輸入 workbook 必須恰好包含四張工作表：`orders`、`packages`、`vehicles` 與 `zones`。

Excel 中的 list delimiter 只有 pipe character `|`。例如：

- `service_zone_codes`: `Z1|Z2|Z3`
- `covered_cities`: `新北市|臺北市`
- `covered_districts`: `板橋|新莊|三重`
- `tdx_city_codes`: `NWT|TPE`
- `adjacent_zone_codes`: `Z2|Z3`

REST response 一律以 JSON arrays 暴露這些值；delimiter strings 不會穿越 API boundary。

## 外部 Provider 模式

- 預設 Demo 模式：`SimulatedRouteProvider` 加上可重現的 simulated congestion。
- Google Routes：`AUTO` plan 會在 `GOOGLE_ROUTES_SERVER_API_KEY` 存在時以 strict adapter 取得 Matrix，並將同一份 Matrix 傳入 OR-Tools；缺少 key 時明確使用 `SIMULATED`，已設定 key 但 provider 失敗時回傳 `PROVIDER_UNAVAILABLE`，不靜默 fallback。Map data 也會以 Google Routes 取得 route geometry。
- TDX：後端已提供 OAuth、traffic event projection 與 route-risk correlation adapter；沒有 `TDX_CLIENT_ID`／`TDX_CLIENT_SECRET` 時回傳 `CREDENTIALS_MISSING`，不可將 simulated 或 status-only 結果標示為 live。
- OpenAI 不可用時：REST import、validation、planning、confirmation 與 queries 仍可使用；只有 `/agent/chat` 降級。

本機 `.env` 僅供已核准的開發環境使用，永不提交；`.env.example` 只保留空白變數與 `gpt-5-mini` 預設模型。

## 本機指令

以下指令用於執行本機 implementation 與 keyless validation gates：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m mypy src
# Explicit live Agent gate; omit for the always-on keyless suite
$env:RUN_LIVE_AGENT_E2E='1'; .\.venv\Scripts\python.exe -m pytest tests/test_agent_e2e.py -q; Remove-Item Env:RUN_LIVE_AGENT_E2E
```

Keyless suite 包含使用 `ScriptedModel` 的實際 Agents SDK runner、strict deterministic tools 與 prompt-injection guardrails。存在 credentials 時，live gate 使用 `gpt-5-mini`；缺少 Browser／TDX credentials 的環境會明確顯示 fallback 或 `OPTIONAL／NOT_CONFIGURED`，不以此冒充 Live PASS。Backend P0、OpenAI Agent runtime、Google Routes 與 Browser map 已通過本機 Live 驗收；TDX 仍為可選外部依賴，整體專案仍為 `IN_PROGRESS`。

## 前端交付快速開始

完成 CPython 3.12 安裝後，以下指令即可建立乾淨的 Windows checkout。請先確認
`python --version` 顯示 `3.12.x`（Windows `py -3.12` launcher 也可使用）。指令均在 repository root 執行，不會修改全域 Python 或 Git 設定。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock
$env:CORS_ALLOWED_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"
.\.venv\Scripts\python.exe -m uvicorn src.api.main:app --reload --host 127.0.0.1 --port 8000
```

開啟 [Swagger UI](http://127.0.0.1:8000/docs)、原始 schema
`http://127.0.0.1:8000/openapi.json`，或 readiness
`http://127.0.0.1:8000/ready`。

前端控制塔位於 `frontend/`；在後端啟動後執行 `pnpm install --frozen-lockfile` 與
`pnpm dev --host 127.0.0.1`，即可於 `http://127.0.0.1:5173` 操作。主要畫面截圖與其測試狀態保存在 `docs/screenshots/`；`live-*.png` 為真實 Google Maps／Agent Live 流程，其他歷史截圖若標示 simulated 則不代表外部 provider `LIVE PASS`。

### 前端環境變數

前端只需要知道以下變數：

```dotenv
VITE_API_BASE_URL=
VITE_GOOGLE_MAPS_BROWSER_API_KEY=
```

`VITE_GOOGLE_MAPS_BROWSER_API_KEY` 為選用項目，使用前必須限制於精確的 frontend origins 與 Maps JavaScript API。後端 `.env` 使用
`CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173`。絕不可將
`OPENAI_API_KEY`、`GOOGLE_ROUTES_SERVER_API_KEY`、`TDX_CLIENT_ID` 或 `TDX_CLIENT_SECRET` 暴露至 browser bundle；browser key 與 server key 不同。

## Demo workbook 與一鍵檢查

標準的虛構 workbook 是 [data/samples/demo-delivery-40-orders.xlsx](data/samples/demo-delivery-40-orders.xlsx)。
它恰好包含四張工作表（`orders`、`packages`、`vehicles`、`zones`）、40 張訂單、80 個 package、4 台車、5 個區域，總重 365 kg。執行中文且不 dispatch 的 walkthrough：

```powershell
.\.venv\Scripts\python.exe scripts/run_p0_demo.py
```

此 walkthrough 會匯入 workbook、建立 OR-Tools plan、顯示超重重新分配與一個例外、預覽 `ORD-041`，並在 Dispatch 或 deployment 前停止。

## 最短 API 串接流程

將 `api = $env:VITE_API_BASE_URL`（或等效的前端 runtime 設定），依序呼叫：

1. `POST /api/v1/datasets/import-excel` with the demo workbook as multipart `file`.
2. `GET /api/v1/datasets/{dataset_id}/validation`; stop and display all field errors if invalid.
3. `POST /api/v1/plans` with `{"dataset_id":"DS-*","algorithm":"ORTOOLS"}`.
4. `GET /api/v1/plans/{plan_id}` 與 `GET /api/v1/plans/{plan_id}/map-data`，繪製 cards/map。
5. 可選擇以 `plan_id`、`plan_version` 與 order ID 呼叫 `POST /api/v1/agent/chat`，取得只引用 evidence 的說明。
6. 出發前有 urgent order 時，呼叫 preview endpoint 並呈現 diff；人工檢視精確版本後才能確認。
7. `POST /api/v1/plans/{plan_id}/confirm` 是人工核准 checkpoint。Demo 不呼叫 `/dispatch`；實際操作人員僅能在明確確認後呼叫。

每個 response 都包含 `X-Request-ID`；mutation/error body 也包含 `request_id`。IDs 與 versions 為 opaque 值，必須原樣傳回。

## 端點範例（原有 13 條契約路由＋5 條進階路由）

完整 schema 與 status-code matrix 請參考 [docs/api-contract.md](docs/api-contract.md)。以下精簡範例展示每條路由的前端 request 與 response shape。

| Method 與 path | Request | Successful response（縮略） |
|---|---|---|
| `GET /health` | none | `{"status":"ok","service":"ai-delivery-dispatch-agent","request_id":"REQ-*"}` |
| `GET /ready` | none | `{"status":"ready","components":{"database":"ready","optimizer":"ready","openai":"degraded","google_routes":"disabled","tdx":"disabled"}}` |
| `POST /api/v1/datasets/import-excel` | `multipart/form-data`，field `file=demo-delivery-40-orders.xlsx` | `201 {"dataset_id":"DS-*","status":"VALIDATED","counts":{"orders":40,"packages":80,"vehicles":4,"zones":5},"total_weight_kg":365.0}` |
| `GET /api/v1/datasets/{dataset_id}` | path `dataset_id=DS-*` | `{"dataset_id":"DS-*","status":"VALIDATED","counts":{"orders":40,"packages":80,"vehicles":4,"zones":5},"total_weight_kg":365.0}` |
| `GET /api/v1/datasets/{dataset_id}/validation` | path `dataset_id=DS-*` | `{"dataset_id":"DS-*","validation":{"is_valid":true,"error_count":0,"warning_count":0,"errors":[],"warnings":[]}}` |
| `POST /api/v1/plans` | `{"dataset_id":"DS-*","algorithm":"ORTOOLS","route_provider_preference":"AUTO","traffic_mode":"AUTO","simulation_seed":20260901}` | `201 {"plan_id":"PLAN-*","version":1,"state":"PROPOSED","algorithm":"ORTOOLS","summary":{"assigned_order_count":40,"assigned_weight_kg":365.0}}` |
| `GET /api/v1/plans/{plan_id}` | optional query `?version=1` | `{"plan_id":"PLAN-*","version":1,"state":"PROPOSED","vehicles":[...],"unassigned_orders":[],"validation":{"valid":true}}` |
| `GET /api/v1/plans/{plan_id}/map-data` | optional query `?version=1` | `{"plan_id":"PLAN-*","version":1,"provider_mode":"SIMULATED","depot":{...},"routes":[...]}` |
| `POST /api/v1/plans/{plan_id}/urgent-insert/preview` | `{"base_plan_version":1,"order":{...},"packages":[...]}` | `200 {"base_version":1,"preview_version":2,"mode":"MINIMAL_CHANGE","diff":{...},"requires_human_confirmation":true}` |
| `POST /api/v1/plans/{plan_id}/confirm` | `{"version":2,"confirmation":"CONFIRM_PLAN","dispatcher_reference":"demo-dispatcher"}` | `200 {"plan_id":"PLAN-*","version":2,"state":"CONFIRMED","audit_event_id":"AUD-*"}` |
| `POST /api/v1/plans/{plan_id}/dispatch` | `{"version":2,"confirmation":"MARK_DISPATCHED"}` | `200 {"plan_id":"PLAN-*","version":2,"state":"DISPATCHED","audit_event_id":"AUD-*"}`；Demo 不呼叫 |
| `POST /api/v1/agent/chat` | `{"session_id":"SESSION-001","message":"為什麼 ORD-032 改派？","context":{"plan_id":"PLAN-*","plan_version":2,"order_id":"ORD-032"}}` | `200 {"message":"...","evidence":[{"tool":"explain_assignment","data":{...}}],"requires_human_confirmation":false}` |
| `GET /api/v1/providers/status` | none | `{"providers":[{"name":"simulated_routes","status":"healthy","mode":"SIMULATED"},...]}` |

Import endpoint 是唯一的 multipart route，其餘 request／response body 均為 JSON。完整 urgent payload 與 Plan/Map shape 請依 `docs/api-contract.md` 的範例實作，不要在 client 自行創造欄位。

## 三條前端展示流程

### 40 單初始排程

匯入固定 workbook，驗證 `40/80/4/5` 數量與 365 kg，再建立 OR-Tools plan。呈現每台車的 orders、sequence、package／weight totals、utilization、AM/PM 合法性、deterministic recommendation reason 與 Validator result。Routes 從 `DEPOT-001` 出發並返回；plan 為 `PROPOSED`，必須清楚顯示等待確認。

### 超重重新分配

Fixture 刻意將 112 kg 集中在 Z4；`VEH-002` 上限為 100 kg，因此 client 必須顯示分配至合資格車輛（例如 `VEH-003`）的合法重新分配，不得顯示超載 route，也不得靜默丟棄 order。若 order 為 `UNASSIGNABLE` 或 `TIME_WINDOW_CONFLICT`，請顯示 exception／evidence 欄位。

### `ORD-041` urgent insertion

使用初始 response 的精確 `plan_id`、`version=1`、dataset identity 與 OR-Tools algorithm 作為 `base_plan_version`；不得重建 Baseline「before」plan。Preview 為 immutable 且 non-mutating，回傳 `mode=MINIMAL_CHANGE`、before／after algorithm 與 dataset hash、assigned weight、unassigned IDs、per-vehicle loads 與 computed diff。已驗收的 fixture evidence 為 365 → 367 kg、existing vehicle moves `0`、僅影響 `VEH-003`、距離 `+137 m`、時間 `+17 s`。人工檢視後才能確認回傳的 preview version。

## Agent 對話流程

將附有 plan/order context 的自然語言問題送至 `/api/v1/agent/chat`。Agent 可呼叫 allowlisted deterministic planning／evidence tool，且只能根據回傳 evidence 作答。不得自行計算 weights、捏造 route numbers、confirm 或 dispatch。OpenAI 不可用時顯示 `AGENT_UNAVAILABLE`，並維持 deterministic REST UI 可用。

## 地圖資料格式

`GET /map-data` 回傳：

```json
{
  "plan_id": "PLAN-*", "version": 1, "provider_mode": "SIMULATED",
  "depot": {"depot_id": "DEPOT-001", "latitude": 25.0131533, "longitude": 121.4599675},
  "routes": [{
    "vehicle_id": "VEH-001", "color": "#2563EB", "encoded_polyline": "simulated:...",
    "is_simplified": true,
    "stops": [{"sequence": 1, "order_id": "ORD-001", "latitude": 25.011, "longitude": 121.465, "eta": "2026-09-02T08:24:00+08:00"}],
    "legs": [{"from_sequence": 0, "to_sequence": 1, "distance_m": 3500, "duration_s": 720}]
  }],
  "warnings": [{"code": "SIMULATED_ROUTE_DATA", "message": "非 Google 即時資料。"}]
}
```

`provider_mode=SIMULATED` 必須顯示「模擬資料」badge；polyline 不是 GPS。Google server credentials 與 raw provider headers 絕不能放入 browser。

## 錯誤與例外

請依穩定的 `error.code` 分支處理，顯示 `message`，將 `field_errors` 附在相應的表單欄位，並保留 `request_id` 供支援追蹤：

```json
{
  "error": {
    "code": "DATASET_VALIDATION_FAILED",
    "message": "工作簿驗證失敗。",
    "field_errors": [{"path": "orders[3].location_label", "code": "MISSING_FIELD", "message": "..."}],
    "request_id": "REQ-*",
    "details": {"affected_ids": ["ORD-004"], "retryable": false}
  },
  "request_id": "REQ-*"
}
```

重要 codes 包含 `DATASET_VALIDATION_FAILED`、`MANUAL_REVIEW`、`TIME_WINDOW_CONFLICT`、
`UNASSIGNABLE`、`PLAN_NOT_FOUND`、`PLAN_VERSION_CONFLICT`、`PLAN_NOT_CONFIRMABLE`、
`PLAN_ALREADY_DISPATCHED`、`URGENT_ORDER_INVALID`、`URGENT_INSERT_UNASSIGNABLE`、
`AGENT_UNAVAILABLE` 與 `LIMIT_REACHED`。不可 retry non-retryable validation/state errors，也不可自行填入缺漏值。已 dispatched 的 plan 為 read-only，不能接受 urgent insertion。

## API、Swagger 與 CORS 交付檢查

後端已保留並測試原有 13 組契約 method/path，另提供 5 組進階路由；FastAPI 在 `/openapi.json` 與 `/docs` 發布目前共 18 組 paths。CORS 使用 `CORS_ALLOWED_ORIGINS` 的明確 allowlist；請設定精確的 frontend origin(s)，不可永久使用 `*`。允許來源的 browser preflight 會取得 CORS headers；未列出的 origin 不得視為允許。

## 範圍排除

本版本不包含 production deployment、live TMS/ERP/GPS、WebSocket、vehicle-in-motion insertion、depot return for pickup、real fleet control、multi-Agent、A2A 或 AP2。

## Render Free 測試部署

Repository 已提供單一 Web Service 的 Production Docker 設定：`Dockerfile`、`.dockerignore` 與 `render.yaml`。前端 Vite bundle 與 FastAPI API 會在同一個 container／origin 提供服務，啟動時使用 Render 注入的 `$PORT`，健康檢查為 `/health`，並以單一 Uvicorn worker 執行。

Render Blueprint 固定部署 `feat/frontend-control-tower`、`singapore` region 與 `free` plan。請在 Render Dashboard 連結本 Repository 後，依 `render.yaml` 建立服務；`OPENAI_API_KEY`、`GOOGLE_ROUTES_SERVER_API_KEY`、`VITE_GOOGLE_MAPS_BROWSER_API_KEY` 與 `DEMO_ACCESS_PASSWORD` 必須以 Render Secret 設定，TDX 變數可留空。YAML 不含任何秘密值。

公開展示服務啟用 `DEMO_ACCESS_PASSWORD` 時，`/health`、Swagger 與登入端點保持可讀，其餘 `/api/v1/*` 端點需先登入；密碼不會進入前端 bundle。SQLite 使用 `/tmp/dispatch.db`，服務休眠、重啟或重新部署後資料可能重置，需重新匯入 Excel。Render 公開驗收必須確認沒有 localhost 請求，且全程不呼叫 `/dispatch`。

目前程式與本機健康／SPA／展示登入 smoke checks 已完成；公開部署仍需 Render 登入／GitHub OAuth，以及確認已輪替且可安全使用的 Provider keys。未完成公開部署前，不宣稱 Render Live PASS。
