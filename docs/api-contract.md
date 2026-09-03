# REST API 契約 v1

Base path 為 `/api/v1`，但 `/health` 與 `/ready` 除外。除 import endpoint 指定 multipart 外，Content type 為 JSON。FastAPI 產生的 OpenAPI／Swagger 必須符合本契約。

## 全域規則

- IDs 是 opaque strings：`DS-*`、`PLAN-*`、`REQ-*`、`RUN-*`。
- Timestamps 是 RFC 3339 UTC strings；作業排程使用 `Asia/Taipei`。
- Kilograms 使用 JSON numbers，僅在顯示時四捨五入；計算保留受控的小數精度。
- Distances 以 meters 表示；durations 以 seconds 表示；utilization 是從 `0` 起算的 ratio。
- Excel list strings 會正規化為 JSON arrays。
- 未知的 request fields 會被拒絕。
- 每個 response 都帶有 `X-Request-ID`；錯誤與重要 mutation 的 body 也包含 `request_id`。
- Provider modes 為 `GOOGLE`、`TDX`、`SIMULATED`、`MIXED` 或 `UNAVAILABLE`，不得錯誤標示。

## 整合現況與未來邊界

這 13 組 REST method/path 是正式的系統整合介面。本輪不修改 route、request schema 或 response schema；以下說明目前實際行為，避免將 adapter 或單次 smoke test 誤認為完整整合：

- `POST /api/v1/datasets/import-excel` 僅正規化資料；`POST /api/v1/plans` 在 `route_provider_preference=AUTO` 且 `traffic_mode=AUTO` 時，若有 server key 會由 `GoogleRoutesProvider` strict 取得 Matrix，並把同一 hash/version 的 `MatrixResult` 注入 OR-Tools。缺 key 時回傳 `provider_mode=SIMULATED` 與 warning；已設定 key 但呼叫失敗回傳 `502 PROVIDER_UNAVAILABLE`，不靜默 fallback。
- `GET /api/v1/plans/{plan_id}/map-data` 對 Google plan 以 Compute Routes 取得 encoded geometry；模擬 plan 則提供 deterministic polyline。`provider_mode=SIMULATED` 必須清楚標示模擬資料，不能當作 live traffic／ETA。
- `/api/v1/agent/chat` 目前走 deterministic `explain_assignment` evidence 路徑；`src/agent/runtime.py` 的 `Runner.run` strict-tool 情境測試獨立存在，HTTP endpoint 尚未接上該 runtime。
- 未來 ERP／WMS／電商來源應先由 Adapter 或 MuleSoft、Boomi、ESB、ETL 等企業中介平台轉換為 Canonical Order Schema，再呼叫既有 REST；MCP 尚未實作，也不能取代正式 REST API。

## 錯誤封套

```json
{
  "error": {
    "code": "TIME_WINDOW_CONFLICT",
    "message": "訂單無法在指定配送時段內完成。",
    "field_errors": [
      {
        "path": "orders[3].time_slot",
        "code": "TIME_WINDOW_CONFLICT",
        "message": "AM 路線預估超過 12:00。",
        "value_summary": "AM"
      }
    ],
    "request_id": "REQ-01J...",
    "details": {
      "affected_ids": ["ORD-004"],
      "retryable": false,
      "suggested_action": "調整時段或人工重新分配。"
    }
  }
}
```

穩定 codes 包含 `DATASET_VALIDATION_FAILED`、`MANUAL_REVIEW`、`UNASSIGNABLE`、`TIME_WINDOW_CONFLICT`、`PLAN_NOT_FOUND`、`PLAN_VERSION_CONFLICT`、`PLAN_NOT_CONFIRMABLE`、`PLAN_ALREADY_DISPATCHED`、`URGENT_ORDER_INVALID`、`URGENT_INSERT_UNASSIGNABLE`、`PROVIDER_UNAVAILABLE`、`AGENT_UNAVAILABLE` 與 `LIMIT_REACHED`。

## Resource 結構

### Exception

```json
{
  "code": "UNASSIGNABLE",
  "severity": "ERROR",
  "affected_ids": ["ORD-041"],
  "message": "此訂單沒有同時符合服務區域與可用載重的車輛。",
  "suggested_actions": ["調整車輛可用狀態", "人工安排其他車輛"],
  "evidence": {
    "order_weight_kg": 118.0,
    "candidate_residual_capacity_kg": {"VEH-002": 12.0, "VEH-003": 40.0}
  }
}
```

### Assignment Reason（分配理由）

```json
{
  "summary": "VEH-003 可服務 Z4，加入後載重 141.5kg，且避免 VEH-002 超載。",
  "evidence": {
    "vehicle_id": "VEH-003",
    "zone_eligible": true,
    "max_load_kg": 160.0,
    "planned_load_kg": 141.5,
    "load_utilization": 0.8844,
    "incremental_distance_m": 4200,
    "incremental_duration_s": 780,
    "time_window_slack_s": 1260,
    "provider_mode": "SIMULATED"
  }
}
```

自然語言的 `summary` 只能重述 `evidence` 已存在的 values。

### Plan

```json
{
  "plan_id": "PLAN-001",
  "version": 1,
  "dataset_id": "DS-001",
  "state": "PROPOSED",
  "timezone": "Asia/Taipei",
  "provider_mode": "SIMULATED",
  "matrix_hash": "sha256...",
  "matrix_version": "sim-v1",
  "is_fully_feasible": true,
  "requires_human_confirmation": true,
  "summary": {
    "assigned_order_count": 40,
    "unassigned_order_count": 0,
    "total_package_count": 80,
    "total_weight_kg": 365.0,
    "total_distance_m": 128400,
    "total_duration_s": 23160
  },
  "vehicles": [
    {
      "vehicle_id": "VEH-001",
      "vehicle_name": "配送車 1",
      "service_zone_codes": ["Z1", "Z2", "Z3"],
      "order_count": 10,
      "package_count": 20,
      "planned_load_kg": 92.0,
      "max_load_kg": 120.0,
      "load_utilization": 0.7667,
      "total_distance_m": 28400,
      "total_duration_s": 5400,
      "route_provider_mode": "SIMULATED",
      "stops": [
        {
          "sequence": 1,
          "order_id": "ORD-001",
          "location_label": "模擬配送點 Z1-01",
          "latitude": 25.011,
          "longitude": 121.465,
          "time_slot": "AM",
          "eta": "2026-09-02T08:24:00+08:00",
          "service_duration_s": 180,
          "leg_distance_m": 3500,
          "leg_duration_s": 720,
          "order_weight_kg": 9.0,
          "reason": {
            "summary": "deterministic evidence-only recommendation",
            "evidence": {
              "vehicle_zone_eligible": true,
              "order_weight_kg": 9.0,
              "post_assignment_load_kg": 92.0,
              "post_assignment_utilization": 0.766667,
              "time_window_legal": true,
              "leg_distance_m": 3500,
              "leg_duration_s": 720,
              "distance_basis": "fixed_simulated_matrix",
              "sequence_basis": "First-Fit eligible vehicle + Nearest Neighbor (fixed simulated matrix)"
            }
          }
        }
      ]
    }
  ],
  "unassigned_orders": [],
  "exceptions": [],
  "warnings": [
    {
      "code": "SIMULATED_ROUTE_DATA",
      "message": "目前使用可重現的模擬距離與路線資料，非 Google 即時資料。"
    }
  ],
  "created_at": "2026-09-01T02:00:00Z"
}
```

上述 sample values 僅示範 shape；實作後的 numeric source of truth 為固定 Demo fixture／solver。

## Endpoints（端點）

### `GET /health`

僅檢查服務存活狀態。`200`：

```json
{"status":"ok","service":"ai-delivery-dispatch-agent","request_id":"REQ-01J..."}
```

### `GET /ready`

當 API、database 與 deterministic core 就緒時回傳 `200`。選用 provider 降級不會使應用程式變為未就緒。

```json
{
  "status": "ready",
  "components": {
    "database": "ready",
    "optimizer": "ready",
    "openai": "degraded",
    "google_routes": "disabled",
    "tdx": "disabled"
  },
  "request_id": "REQ-01J..."
}
```

### `POST /api/v1/datasets/import-excel`

Multipart field 為 `file`；只允許 `.xlsx`，size limit 依設定決定。Import 不會建立 plan。

`201`:

```json
{
  "dataset_id": "DS-001",
  "status": "VALIDATED",
  "counts": {"orders":40,"packages":80,"vehicles":4,"zones":5},
  "total_weight_kg": 365.0,
  "validation": {"is_valid":true,"error_count":0,"warning_count":0},
  "request_id": "REQ-01J..."
}
```

若無效，回傳 `422 DATASET_VALIDATION_FAILED` 與所有安全的 field errors；dataset metadata 可以為 audit 保留查詢能力。

### `GET /api/v1/datasets/{dataset_id}`

回傳 metadata、normalized summary、counts、hash、import time 與 validation status。預設不回傳完整原始 workbook。

### `GET /api/v1/datasets/{dataset_id}/validation`

回傳 validation summary 與 field errors／warnings。

### `POST /api/v1/plans`

Request:

```json
{
  "dataset_id": "DS-001",
  "route_provider_preference": "AUTO",
  "traffic_mode": "AUTO",
  "simulation_seed": 20260901
}
```

`route_provider_preference=AUTO` 與 `traffic_mode=AUTO` 會依 server key 決定 provider：有 key 時 strict 使用 Google Matrix；缺 key 時明確回傳 simulated warning；已設定 key 但 provider error 則以 `502 PROVIDER_UNAVAILABLE` 結束，避免把錯誤誤標成 simulated 成功。Plan response 會回傳 `matrix_hash`、`matrix_version` 與 `summary.matrix_hash`／`summary.matrix_version`，供 client 證明 solver 使用的 matrix identity。Response `201` 為 `state=PROPOSED` 的 Plan shape。若不存在完整可行方案，`409/422` 可回傳 partial plan reference 與 exceptions。

### `GET /api/v1/plans/{plan_id}`

Query `version` 為選用；省略時代表 current version。回傳 Plan，或 `404 PLAN_NOT_FOUND`。

### `GET /api/v1/plans/{plan_id}/map-data`

Query `version` 為選用。Response：

```json
{
  "plan_id": "PLAN-001",
  "version": 1,
  "provider_mode": "SIMULATED",
  "matrix_hash": "sha256...",
  "matrix_version": "sim-v1",
  "depot": {"depot_id":"DEPOT-001","latitude":25.0131533,"longitude":121.4599675},
  "routes": [
    {
      "vehicle_id": "VEH-001",
      "color": "#2563EB",
      "encoded_polyline": "simulated:...",
      "is_simplified": true,
      "stops": [{"sequence":1,"order_id":"ORD-001","latitude":25.011,"longitude":121.465,"eta":"..."}],
      "legs": [{"from_sequence":0,"to_sequence":1,"distance_m":3500,"duration_s":720}]
    }
  ],
  "traffic": {"mode":"UNAVAILABLE","data_status":"CREDENTIALS_MISSING","events":[],"route_risks":[]},
  "warnings": [{"code":"SIMULATED_ROUTE_DATA","message":"非 Google 即時資料"}]
}
```

Google route 的 `provider_mode` 為 `GOOGLE` 且 `matrix_hash`／`matrix_version` 必須與建立 plan 的 response 一致；沒有 Browser key 時前端仍可顯示 simulated preview，但不得標示為 Google live map。

### `POST /api/v1/plans/{plan_id}/urgent-insert/preview`

Request:

```json
{
  "base_plan_version": 1,
  "order": {
    "order_id": "ORD-041",
    "zone_code": "Z4",
    "city": "臺北市",
    "district": "信義",
    "location_label": "模擬臨時配送點 Z4-U1",
    "latitude": 25.033,
    "longitude": 121.565,
    "time_slot": "PM",
    "declared_package_count": 2,
    "priority": "HIGH",
    "note": "出發前臨時插單"
  },
  "packages": [
    {"package_id":"PKG-041-01","order_id":"ORD-041","weight_kg":6.0},
    {"package_id":"PKG-041-02","order_id":"ORD-041","weight_kg":5.0}
  ]
}
```

Response `200`：

```json
{
  "plan_id": "PLAN-001",
  "base_version": 1,
  "preview_version": 2,
  "feasible": true,
  "requires_human_confirmation": true,
  "mode": "MINIMAL_CHANGE",
  "full_replan_reason": null,
  "affected_vehicle_count": 1,
  "moved_order_count": 0,
  "before": {
    "state":"PROPOSED","algorithm":"ORTOOLS",
    "dataset_hash":"sha256...base","assigned_order_count":40,
    "assigned_weight_kg":365.0,"unassigned_orders":[],
    "vehicles":[{"vehicle_id":"VEH-001","planned_load_kg":93.0,"load_utilization":0.775}]
  },
  "after": {
    "state":"PROPOSED","algorithm":"ORTOOLS",
    "dataset_hash":"sha256...preview","assigned_order_count":41,
    "assigned_weight_kg":367.0,"unassigned_orders":[],
    "vehicles":[{"vehicle_id":"VEH-003","planned_load_kg":154.0,"load_utilization":0.9625}]
  },
  "comparison": {
    "base_algorithm":"ORTOOLS","preview_algorithm":"ORTOOLS",
    "base_dataset_hash":"sha256...base","preview_dataset_hash":"sha256...preview"
  },
  "diff": {
    "inserted_order_id": "ORD-041",
    "reassigned_orders": [],
    "sequence_changes": [{"order_id":"ORD-041","from_sequence":null,"to_sequence":15,"to_vehicle_id":"VEH-003"}],
    "vehicle_load_changes": [{"vehicle_id":"VEH-003","before_load_kg":152.0,"after_load_kg":154.0,"delta_load_kg":2.0}],
    "total_distance_delta_m": 137,
    "total_duration_delta_s": 17
  },
  "exceptions": [],
  "warnings": [{"code":"SIMULATED_ROUTE_DATA","message":"非 Google 即時資料"}],
  "request_id": "REQ-01J..."
}
```

Preview 絕不變更 current plan pointer。`DISPATCHED` 回傳 `409 PLAN_ALREADY_DISPATCHED`；stale version 回傳 `409 PLAN_VERSION_CONFLICT`。

### `POST /api/v1/plans/{plan_id}/confirm`

Request:

```json
{"version":2,"confirmation":"CONFIRM_PLAN","dispatcher_reference":"demo-dispatcher"}
```

需要精確 version 與明確 action。回傳 `200`、`state=CONFIRMED` 與 audit event ID。Invalid plan／validator failure 回傳 `409 PLAN_NOT_CONFIRMABLE`。

### `POST /api/v1/plans/{plan_id}/dispatch`

Request:

```json
{"version":2,"confirmation":"MARK_DISPATCHED"}
```

只有精確的 `CONFIRMED` version 能轉為 `DISPATCHED`，並回傳 audit event ID。此操作只記錄 state，不控制 real fleet。

### `POST /api/v1/agent/chat`

Request:

```json
{"session_id":"SESSION-001","message":"為什麼 ORD-032 改派 VEH-003？","context":{"plan_id":"PLAN-001","plan_version":2}}
```

Response:

```json
{
  "session_id": "SESSION-001",
  "agent_run_id": "RUN-01J...",
  "message": "ORD-032 改派是為避免 VEH-002 超載；相關數據如下。",
  "evidence": [{"tool":"explain_assignment","evidence_id":"EVD-001","data":{}}],
  "requires_human_confirmation": false,
  "usage": {"total_tokens":1234},
  "request_id": "REQ-01J..."
}
```

此 endpoint 不得捏造 facts 或繞過 confirmation。OpenAI 不可用時回傳 `503 AGENT_UNAVAILABLE`；其他 REST endpoints 仍可使用。

### `GET /api/v1/providers/status`

```json
{
  "providers": [
    {"name":"simulated_routes","enabled":true,"status":"healthy","mode":"SIMULATED"},
    {"name":"google_routes","enabled":false,"status":"disabled","mode":"UNAVAILABLE"},
    {"name":"tdx","enabled":false,"status":"disabled","mode":"UNAVAILABLE"},
    {"name":"openai","enabled":false,"status":"degraded","mode":"UNAVAILABLE"}
  ],
  "request_id": "REQ-01J..."
}
```

絕不暴露 credential values 或 raw auth failures。TDX status／map data 另包含 `data_status`（例如 `CREDENTIALS_MISSING`、`NO_EVENTS`、`EVENTS_FOUND`）；`traffic.route_risks` 只引用已投影且可關聯至 route/order 的事件 evidence。

## Status Code 政策

| Status | 意義 |
|---:|---|
| 200/201 | query/create 成功 |
| 400 | request 格式錯誤或不支援的檔案 |
| 404 | 找不到 resource |
| 409 | state/version conflict 或不可確認的 plan |
| 413 | workbook 過大 |
| 422 | schema/domain validation failure |
| 429 | Agent/provider budget 或 rate limit |
| 503 | 選用能力不可用且沒有允許的 fallback；只有核心故障才影響 readiness |

## CORS

將 `CORS_ALLOWED_ORIGINS` 解析為明確的 origin list。只有必要時才啟用 credentials。`*` 僅可在隔離 test profile 使用；離開該 profile 時必須讓 `/ready` 失敗或發出警告。
