# 前端交付說明

後端 implementation 可在本機使用。安裝 CPython 3.12 後，確認 `python --version` 顯示
`3.12.x`，再從 repository root 執行以下乾淨 checkout 流程：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock
$env:CORS_ALLOWED_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"
```

接著啟動 FastAPI：

```powershell
.\.venv\Scripts\python.exe -m uvicorn src.api.main:app --reload --host 127.0.0.1 --port 8000
```

開啟 Swagger `http://127.0.0.1:8000/docs`，或使用固定的 schema
`docs/openapi-snapshot.sha256`。原有 13-route contract 維持相容，另有 5 組進階路由；若目前 18-path OpenAPI 未經刻意更新而變更，snapshot test 會 fail closed。

## 前端環境變數

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_GOOGLE_MAPS_BROWSER_API_KEY=
```

Browser key 為選用項目，必須限制於精確 HTTP referrers 與 Maps JavaScript API。Backend allowlist 為 `CORS_ALLOWED_ORIGINS`，請列出每個精確的 local frontend origin。絕不可將 `OPENAI_API_KEY`、`GOOGLE_ROUTES_SERVER_API_KEY`、`TDX_CLIENT_ID` 或 `TDX_CLIENT_SECRET` 放入 frontend variables 或 bundles。

## 實作現況與必要功能邊界

`frontend/` 現已提供可執行的 React + TypeScript + Vite + MUI control tower。畫面透過 `frontend/src/api.ts` 呼叫原有 13 組 REST routes 與 5 組進階路由，呈現匯入／驗證、車輛載重、ordered stops、Validator、Agent evidence、urgent preview diff、策略比較、延遲風險、版本復原與人工 confirm；不提供自動 Dispatch 或 deployment。RTL、typecheck、lint 與 production build 均可在無外部 key 的環境執行。

`POST /api/v1/plans` 在 `route_provider_preference=AUTO`／`traffic_mode=AUTO` 且有 `GOOGLE_ROUTES_SERVER_API_KEY` 時，strict 取得 Google Matrix 並將同一 hash/version 傳入 OR-Tools；缺 key 時回傳 `SIMULATED` warning，已設定 key 但呼叫失敗則回傳 `PROVIDER_UNAVAILABLE`。`map-data` 對 Google plan 會再取得 encoded route geometry。TDX adapter 已完成 OAuth、事件 projection 與 city／zone／coordinate route-risk correlation；無 credentials 時回傳 `CREDENTIALS_MISSING`。這些 keyless wiring／mock evidence 不等於 Live PASS。

`VITE_GOOGLE_MAPS_BROWSER_API_KEY` 存在時，`MapPanel` 載入 Google Maps JavaScript API、depot／stop Markers 與 Google 路線 polylines；沒有 key 時顯示 deterministic map preview 並明確標示 `SIMULATED`。本分支已在具備 Browser key 的本機環境通過 Live 瀏覽器驗收；TDX 仍為可選外部依賴，mock、fallback 或 skipped test 不得替代 Live 證據。

本輪分支為 `feat/frontend-control-tower`，完成後只推送該分支，不自動合併 `main`。

## 前端安裝與啟動

在 repository root 啟動後端後，再於 `frontend/` 使用 bundled Node／`pnpm`（或團隊核准的 Node 24 + pnpm 11）：

```powershell
cd frontend
pnpm install --frozen-lockfile
Copy-Item .env.example .env.local
pnpm dev --host 127.0.0.1
```

開啟 `http://127.0.0.1:5173`。`VITE_API_BASE_URL` 指向 FastAPI（預設 `http://127.0.0.1:8000`）；Browser key 留白時仍可使用明確標示的 simulated map preview。前端不得設定或打包任何 server-side secret。

品質檢查指令：

```powershell
pnpm run typecheck
pnpm run lint
pnpm run test -- --run
pnpm run build
```

依賴版本固定於 `frontend/package.json` 與 `frontend/pnpm-lock.yaml`；`node_modules/` 與 `dist/` 不提交。

## Demo fixture（展示資料）

使用 `data/samples/demo-delivery-40-orders.xlsx`（repository-root relative path）。這是虛構的四工作表 fixture，包含 40 orders、80 packages、4 vehicles、5 zones 與 365 kg。中文且不 dispatch 的 walkthrough：

```powershell
.\.venv\Scripts\python.exe scripts/run_p0_demo.py
```

## 前端可依賴的行為

- 僅提供 REST，不提供 WebSocket。
- Swagger／OpenAPI 由 FastAPI 提供（`/docs`、`/openapi.json`）。
- Plan 與 preview payload 依 `plan_id + version` versioned 且 immutable。
- 所有 list fields 都是 JSON arrays。
- Map payload 包含 depot、ordered stops、legs、vehicle colors、polyline、ETA 與 provider warning。
- Animation 是 client-side 沿 returned polyline 的加速移動，不是 GPS。
- 每個 proposed／preview plan 都需要 human confirmation。

## 建議的前端串接順序

```text
1. POST import-excel
2. GET dataset validation
3. POST plans
4. GET plan 與 map-data
5. Render vehicles/stops/exceptions/provider badge
6. 可選的 urgent-insert preview 並顯示 diff
7. 人工針對精確 plan/version 按下 confirm
8. 本控制塔不呼叫 `/dispatch`；若未來另有核准的營運流程，才由具權限的系統執行。
```

## Endpoint request／response 範例

後端已實作 `docs/api-contract.md` 的原有 13 組 method/path 及 5 組進階 method/path；以下是前端所需的 request／response index。除 multipart import 外，所有 body 都是 JSON。

| Endpoint | Request | 前端處理的 Response |
|---|---|---|
| `GET /health` | none | `{"status":"ok","service":"ai-delivery-dispatch-agent","request_id":"REQ-*"}` |
| `GET /ready` | none | `{"status":"ready","components":{...},"request_id":"REQ-*"}` |
| `POST /api/v1/datasets/import-excel` | multipart field `file` (`.xlsx`) | `201 {"dataset_id":"DS-*","status":"VALIDATED","counts":{"orders":40,"packages":80,"vehicles":4,"zones":5},"total_weight_kg":365.0}` |
| `GET /api/v1/datasets/{dataset_id}` | path ID | `{"dataset_id":"DS-*","status":"VALIDATED","counts":{...},"total_weight_kg":365.0}` |
| `GET /api/v1/datasets/{dataset_id}/validation` | path ID | `{"dataset_id":"DS-*","validation":{"is_valid":true,"errors":[],"warnings":[]}}` |
| `POST /api/v1/plans` | `{"dataset_id":"DS-*","algorithm":"ORTOOLS","route_provider_preference":"AUTO","traffic_mode":"AUTO","simulation_seed":20260901}` | `201 {"plan_id":"PLAN-*","version":1,"state":"PROPOSED","summary":{...},"vehicles":[...]}` |
| `GET /api/v1/plans/{plan_id}` | optional `?version=1` | Plan with `algorithm`, `dataset_hash`, `vehicles`, `unassigned_orders`, `validation` |
| `GET /api/v1/plans/{plan_id}/map-data` | optional `?version=1` | Map payload with `depot`, `routes`, `stops`, `legs`, `provider_mode` |
| `POST /api/v1/plans/{plan_id}/urgent-insert/preview` | `{"base_plan_version":1,"order":{...},"packages":[...]}` | `200 {"base_version":1,"preview_version":2,"mode":"MINIMAL_CHANGE","before":{...},"after":{...},"diff":{...}}` |
| `POST /api/v1/plans/{plan_id}/confirm` | `{"version":2,"confirmation":"CONFIRM_PLAN","dispatcher_reference":"frontend-user"}` | `200 {"state":"CONFIRMED","version":2,"audit_event_id":"AUD-*"}` |
| `POST /api/v1/plans/{plan_id}/dispatch` | `{"version":2,"confirmation":"MARK_DISPATCHED"}` | `200 {"state":"DISPATCHED",...}`; never call in the demo |
| `POST /api/v1/agent/chat` | `{"session_id":"SESSION-001","message":"為什麼 ORD-032 改派？","context":{"plan_id":"PLAN-*","plan_version":2,"order_id":"ORD-032"}}` | `200 {"message":"...","evidence":[{"tool":"explain_assignment","data":{...}}]}` |
| `GET /api/v1/providers/status` | none | `{"providers":[{"name":"simulated_routes","status":"healthy","mode":"SIMULATED"},...]}` |

使用產生的 [Swagger UI](http://127.0.0.1:8000/docs) 或
`http://127.0.0.1:8000/openapi.json` 取得精確 schema。不要自行創造省略的欄位。

## 必要 Demo 流程

### 40 單初始 plan

依序呼叫 import → validation → `POST /plans`（`algorithm=ORTOOLS`）→ plan 與 map queries。Fixture 預期為 40 orders／80 packages／4 vehicles／5 zones／365 kg。顯示每台車的 orders、package count、load／utilization、stop sequence、evidence-grounded reason 與 independent Validator status。`PROPOSED` plan 必須清楚顯示等待確認。

### 超重重新分配

Fixture 的 Z4 demand 總重 112 kg，而 `VEH-002` 上限為 100 kg。UI 必須顯示重新分配到 eligible vehicle（已驗收 plan 使用 `VEH-003`），不得把 overloaded route 顯示為有效，也不得靜默刪除 order。沒有合法 assignment 時，請以 evidence 顯示 `UNASSIGNABLE` 或 `TIME_WINDOW_CONFLICT` exceptions。

### `ORD-041` urgent insertion

將精確 initial `plan_id`、`base_plan_version=1`、dataset identity 與 OR-Tools plan 送至 preview endpoint。Backend 回傳 immutable preview，不修改 base plan。已驗收結果為 `mode=MINIMAL_CHANGE`：before 40 orders／365 kg，車輛 loads 93／97／152／23 kg；after 367 kg；existing order vehicle moves 0；僅 `VEH-003` 變更；distance +137 m；duration +17 s。呈現 `reassigned_orders`、`sequence_changes`、`vehicle_load_changes` 與兩項 metric deltas，再請人工確認回傳的 preview version。

### Agent 對話

將使用者的自然語言問題連同 `plan_id`、`plan_version`（若要說明 order，另帶 `order_id`）送出。Agent 只能呼叫 allowlisted deterministic tools，且只能引用其 evidence。不得計算新 weight、捏造 route、confirm 或 dispatch。Endpoint 回傳 `AGENT_UNAVAILABLE` 時，仍維持所有 deterministic REST screens 可用。

## UI state 對照

| API state | 建議的 UI |
|---|---|
| DRAFT | importing/processing |
| VALIDATED | dataset valid; ready to plan |
| PROPOSED | plan preview; confirmation CTA enabled only when valid |
| CONFIRMED | approved by dispatcher; dispatch CTA available |
| DISPATCHED | read-only; urgent insertion disabled |

## Provider 標籤

- `GOOGLE`：Google route data；遵守 map attribution requirements。
- `TDX`：TDX traffic enrichment。
- `MIXED`：清楚標示各欄位來源 provider。
- `SIMULATED`：顯示醒目的 `模擬資料` badge；絕不稱為 live traffic／ETA。
- `UNAVAILABLE`：顯示降級功能，不得顯示捏造值。

## Vehicle card 欄位

顯示 `order_count`、`package_count`、`planned_load_kg`、`max_load_kg`、`load_utilization`、`service_zone_codes`、total distance/time 與 exception／warning count。

## Stop 欄位

顯示 sequence、location label、AM/PM、ETA、service duration（3 minutes）、leg distance/time、order weight，以及可展開 evidence 的 explanation。

### Map JSON 格式

`GET /api/v1/plans/{plan_id}/map-data` 為每台 vehicle 回傳一個 depot 與一個 route object：

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

`provider_mode=SIMULATED` 必須顯示醒目的「模擬資料」badge。Polyline 是 deterministic preview，不是 GPS；client-side animation 不得暗示 live vehicle tracking。

## 驗收截圖

本機 simulated flow 的畫面證據保存在 `docs/screenshots/`：

- `01-empty-control-tower.png`：空白控制塔與安全邊界。
- `02-imported-plan.png`：40 單匯入、車輛載重與地圖。
- `03-map-and-vehicles.png`：地圖、四台車與 route filter。
- `04-agent-blocked.png`：Agent 請求在 provider 不可用時的安全降級。
- `05-urgent-preview.png`：`ORD-041` before／after 與 computed diff。
- `06-human-confirmation.png`：人工確認 checkpoint；沒有 Dispatch CTA。

截圖由 Playwright local simulated flow 產生，不含 API key，也不代表 Google Maps／TDX／OpenAI 的 `LIVE PASS`。

## 例外狀態

呈現 severity、code、message、affected IDs 與 `suggested_actions`。不得自行推導繞過 backend validator 的 frontend workaround。

## Urgent insert 差異

請顯示：

- inserted order；
- vehicle reassignments；
- stop sequence changes；
- 每台 vehicle 的 load/utilization delta；
- total distance/duration delta；
- feasibility、exceptions、provider warnings；
- 對 preview version 的明確 confirmation。

## 錯誤處理

使用 `error.code` 做分支，使用 `message` 顯示主要通知，將 `field_errors` 放在相應的 form／workbook fields，並保留 `request_id` 供支援追蹤。重要案例：

```json
{
  "error": {
    "code": "DATASET_VALIDATION_FAILED",
    "message": "工作簿驗證失敗。",
    "field_errors": [{"path": "orders[3].location_label", "code": "MISSING_FIELD", "message": "欄位不可空白。"}],
    "request_id": "REQ-*",
    "details": {"affected_ids": ["ORD-004"], "retryable": false}
  },
  "request_id": "REQ-*"
}
```

每個 field error 都要顯示在相應的 order／package／column 旁，保留 `requires_manual_review`，不得猜測缺漏值。只有 response 明確標示 partial 且已對 unassigned orders 完成 reconciliation 時，才可顯示 partial plans。

- `DATASET_VALIDATION_FAILED`: display all field errors.
- `TIME_WINDOW_CONFLICT` / `UNASSIGNABLE`: show exception, keep partial plan visible if returned.
- `PLAN_VERSION_CONFLICT`: refresh current version before retry.
- `PLAN_ALREADY_DISPATCHED`: disable insertion and advise manual handling.
- `AGENT_UNAVAILABLE`: keep deterministic REST UI usable.
- `LIMIT_REACHED`: stop automatic retries.

## CORS 設定

Backend 從 `CORS_ALLOWED_ORIGINS` 讀取逗號分隔的 allowlist。Frontend 必須提供精確的 development origin，例如 `http://localhost:5173`；不得要求 backend 長期啟用 `*`。

## 金鑰邊界

- 前端只能接收 Google Browser Key，且限制於精確 HTTP referrers 與 Maps JavaScript API。
- Backend Server Key 絕不傳送至 frontend。
- TDX 與 OpenAI credentials 僅能留在 backend。

## 目前整合狀態

目前 local server 已實作所有文件化 routes。`api-contract.md` 中的 sample numeric values 僅示範 shape；產生的 solver outputs 來自固定 Demo fixture，並經獨立驗證。Frontend 應以 `tests/test_demo_flow.py` 作為 no-dispatch integration sequence，除非有明確的 dispatcher action，絕不可呼叫 `/dispatch`。

## 本分支 Live 驗收

`frontend/tests/e2e/live-control-tower.spec.ts` 的歷史執行曾在具備真實 OpenAI／Google 憑證時完成無資料聊天、Excel 匯入、Google Live Matrix → OR-Tools、Validator、Google Maps、Agent 多輪對話、ORD-041 preview、人工確認、配送任務與配送路線工作區；該歷史結果不代表本輪環境仍具備相同憑證。當前本輪 Google gate 回傳 `GOOGLE_HTTP_403`，Browser key 亦未設定，必須分別標示 BLOCKED。

Live 畫面截圖位於 `docs/screenshots/live-01-empty-chat.png` 至 `live-07-route-tracking.png`，每張為 1440×900 且不含 credential。TDX 因未設定 OAuth 憑證標示 `OPTIONAL／NOT_CONFIGURED`，不影響本輪後端與前端驗收。

## Agent-first 與進階功能串接

前端附件匯入只負責建立並驗證 `dataset_id`；使用者訊息會連同 `dataset_id` 一次送至 `/api/v1/agent/chat`。Agent 透過 `Runner.run` 選擇 `plan_dispatch`，後端在同一輪保存不可變的 `plan_id`／version，前端再讀取 plan 與 map-data。沒有附件時仍可直接聊天；需要資料的問題由 Agent 說明需補充 Excel 或範例資料。

控制塔可選擇呼叫下列非破壞性端點：`/api/v1/plans/compare` 顯示三種策略、`/api/v1/plans/{plan_id}/delay-preview` 顯示 10／20／30 分鐘風險、`/api/v1/plans/{plan_id}/reassign/preview` 顯示拖拉換車差異、`/versions` 列舉版本及 `/restore` 建立復原草稿。所有回應都必須以 `validator.valid` 與 `requires_human_confirmation` 控制畫面按鈕；不得自行呼叫 `/dispatch`。

拖拉換車提供滑鼠與鍵盤／按鈕替代操作。失敗時保留原 plan version，不更新地圖或目前確認指標；成功 preview 只顯示影響車輛、順序、重量、距離及時間差異，人工確認後才切換版本。
