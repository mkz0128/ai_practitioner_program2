# 規格驗證報告

## 狀態快照

```yaml
validated_on: 2026-09-03
scope: specification_harness_algorithm_benchmark_contracts_feature_code_agent_e2e_api_contract_demo_flow_competition_acceptance
feature_code_present: true
implementation_gate: APPROVE_IMPLEMENTATION
implementation_status: phase_2_feature_implementation
backend_p0_status: done
openai_agent_status: done
frontend_integration_status: partial_local_control_tower
overall_project_status: in_progress
git_repository: true
```

## 本輪檢查

本輪新增前端控制塔與 provider wiring；未讀取 `.env` 或任何 credential value。Live provider 結果只能依 process environment 判定，當前環境五項相關變數均未設定，因此以下 live gate 皆為 `BLOCKED`／`SKIPPED`，不得以 mock 或 simulated 取代。

| 檢查 | 預期證據 | 狀態 |
|---|---|---|
| 必要檔案存在 | 路徑清單 | 通過 — 24 項必要產物 |
| Golden Dataset JSON 可解析 | JSON parser | 通過 |
| Observability 設定可解析 | JSON parser（相容 YAML 1.2 的 JSON 語法） | 通過 |
| TOML 可解析 | Python `tomllib` | 通過 |
| 直接相依版本符合 lock | comparison script | 通過 — 16 個 direct pins |
| Python 3.12 相依解析 | pip dry-run report | 通過 — 無安裝、無衝突 |
| Spec／API／Harness 術語一致 | 13-endpoint cross-file checks | 通過 |
| Markdown 結構 | 16 個檔案的 code fence 成對檢查 | 通過 |
| Secret patterns | repository text scan | 通過 — 未偵測到 |
| Workbook 工作表／欄位契約 | artifact inspect | 通過 — 四張精確工作表與標題 |
| Demo 筆數與總重量 | artifact inspect/calculation | 通過 — 40 orders、80 packages、4 vehicles、5 zones、365 kg |
| Demo 分布 | deterministic audit | 通過 — AM 20、PM 20、Z4 112 kg |
| Workbook 公式錯誤 | artifact match scan | 通過 — 未偵測到 |
| Workbook 視覺品質 | 8 張工作表 render/view、修正、重新 render | 通過 |
| Feature gate | 已記錄精確核准；僅核准後允許 `src/` implementation | 通過 — `APPROVE_IMPLEMENTATION` |
| Git 基準安全 | repository-local identity、空遠端、26 檔 secret/action/deployment scan | 通過 |
| 演算法規格覆蓋 | Baseline、CVRPTW dimensions、strategies、limits、partial/failure policy | 通過 |
| 公平 Benchmark 契約 | 相同 fixture/matrix identity、12 項指標、公式、可重現控制 | 通過 |
| API Key 測試分層 | always-on keyless、conditional live、缺 key skip/fallback、secret redaction | 通過 |
| Golden Dataset 擴充 | JSON parse 與 GD-013–GD-030 traceability | 通過 — 共 30 個案例 |
| Responses API 參數診斷 | `gpt-5-mini` direct text 與 strict function request；malformed Chat envelope regression | 通過 — 正確 requests PASS；歷史 HTTP 400 `missing_required_parameter` 已在不輸出 secret 下說明 |
| OpenAI Agents SDK E2E | `Runner.run` + strict deterministic tools + independent Validator + evidence-only final answer | 通過 — live opt-in daily dispatch PASS；7 個 provider-neutral SDK scenarios PASS |
| API contract 覆蓋 | 文件 method/path 與 FastAPI routes 比對及安全 response exercise | 通過 — 13 defined／13 implemented／13 exercised |
| 40-order Demo flow | import → validation → plan → provider fallback → explanation → confirm → order 41 preview/diff；不 dispatch | 通過 — base version 未變更 |
| Observability 與 cost guard | Redacted JSONL trajectory events、correlation IDs、fail-closed Agent limits、regression tests | 通過 — `src/observability`、3 個 boundary/redaction tests |
| OpenAPI snapshot | stable hash 與精確 13-path set | 通過 — `docs/openapi-snapshot.sha256` 與 snapshot test |
| 前端乾淨安裝／啟動 | 全新 CPython 3.12.13 venv 安裝 `requirements.lock` 並啟動 FastAPI | 通過 — health `200`、Swagger `/docs` `200`、OpenAPI `200` |
| 前端 API／CORS 介面 | 13 個 OpenAPI paths 與明確 allowed-origin preflight | 通過 — 13 paths；允許 `http://localhost:5173` |
| Demo workbook 交付路徑 | repository-relative fixture 存在且可讀 | 通過 — `data/samples/demo-delivery-40-orders.xlsx` |
| 競賽欄位錯誤 | 缺少 address/time/weight cells 指出 order/package/field 並要求人工複核 | 通過 — executable acceptance fixture |
| Plan evidence reasons | 每個 assigned stop 都有 deterministic zone/weight/load/time/distance evidence | 通過 — Plan API acceptance test |
| Urgent preview diff | 從 before/after plans 計算 reassignment、sequence、load 與 distance/time deltas | 通過 — order-41 Demo assertion 與 diff builder |
| 中文核心功能 Demo | 單一指令列出 40/4 routes、重新分配、例外、完整 preview diff 與人工 checkpoint | 通過 — `scripts/run_p0_demo.py` 結束碼 0；無 Dispatch/deploy |
| Urgent base-plan identity | Demo preview 使用相同 OR-Tools plan ID/version/dataset/algorithm 且 before 為 365 kg | 通過 — regression test 與 Demo output |
| Minimum-change insertion | 合法既有路線插入保留未受影響路線，ORD-041 僅影響一台車 | 通過 — `MINIMAL_CHANGE`、Validator valid |
| 對外內容清理 | 已追蹤 Markdown／JSON／YAML／TOML 移除私人交付時程與個人工作安排 | 通過 — 僅保留技術識別字與程式碼既有字串 |
| 文件中文化與格式 | 說明文字使用繁體中文；Markdown links、code fences 與結構可解析 | 通過 |

## 相依套件解析證據

- 解析使用的 Runtime：CPython 3.12.13。
- Resolver：pip 26.2.1 `--dry-run --ignore-installed --report`。
- 結果：所有 direct 與 transitive requirements 均可解析；未安裝套件。
- Lock 目標：目前 Windows x86-64 開發環境。若要 Linux 部署，仍需另行完成 Linux lock／wheel 驗證。

## 外部參考檢視

- OpenAI 官方指引支援 Agent orchestration／tool use 與目前模型設定；模型由環境設定驅動。
- Google Compute Route Matrix 需要 field masks，並提供 status／condition／distance／duration 欄位。
- Google 建議限制金鑰權限；Browser 與 Server credentials 分離。
- TDX 官方 Swagger 說明 Client ID／Secret 存取與 road traffic v2 data services。
- Depot address geocode 的來源 URL／日期已記錄於 `ACTIVE_SPEC.md`。
- OR-Tools 官方 routing options 定義 first-solution strategies、`GUIDED_LOCAL_SEARCH`、`solution_limit`、`time_limit` 與 solver termination statuses。
- OR-Tools 官方 CVRP／VRPTW 指引支援 Capacity 與 Time Dimensions、每個節點的 time-window constraints、waiting slack 與 depot-bounded routes。
- OR-Tools routing-task 指引支援從既有 routes warm-start；dropped-visits 指引要求明確 penalties 與 dropped-node reporting。

## 演算法與 Benchmark 規格驗證

| 控制項 | 鎖定決策 | 結果 |
|---|---|---|
| Baseline | First-Fit Eligible Vehicle + time-feasible Nearest Neighbor | 已出現在 architecture、requirements、plan 與 GD-013 |
| Optimized model | OR-Tools CVRPTW with Capacity／Time Dimensions and allowed vehicles | 已具備 |
| Search | `PARALLEL_CHEAPEST_INSERTION` + `GUIDED_LOCAL_SEARCH` | 已具備 |
| Limits | 10-second hard cap + 1,000-solution cap | 已具備 |
| Hard constraints | unsplittable、capacity、zone、AM/PM、lunch、180-second service、depot return | 已具備 |
| Output trust | Baseline 與 Optimized 均要求 independent Validator | 已具備 |
| Partial/failure | 明確 solver status、unassigned reconciliation、不可確認的無效方案 | 已具備 |
| Urgent order 41 | minimum-change tiers；只有 fallback preview 才標記 `FULL_REPLAN` | 已具備 |
| Fair input | 相同 40 orders、4 vehicles、5 zones、depot 與 simulated matrix hash | 已具備 |
| Live traffic | 排除於 canonical／Golden Benchmark 數值 | 已具備 |
| Reproducibility | pins、hashes、integer units、stable ordering、fixed parameters、run protocol | 已具備 |
| Credentials | keyless 永遠可執行；live conditional；不輸出 secret values | 已具備 |

## Runtime 驗證

- FastAPI import／health／readiness、Excel upload、plan creation、map payload、confirmation、dispatch lifecycle、urgent preview 與 structured explanation tests 均通過。
- Deterministic parser、package aggregation、Baseline、OR-Tools CVRPTW、shared simulated matrix、independent Validator、Benchmark、SQLite repository、urgent preview、structured evidence 與 provider fallback tests 均通過。
- Keyless suite：`36 passed, 3 skipped (conditional Agent/Responses/Google live tests)`；`ruff check src tests scripts` 通過；`mypy src` 通過，共 27 個 source files。
- Agents SDK scenario suite：`7 passed`；使用 `gpt-5-mini` 的 explicit live `Runner.run`、strict `plan_dispatch` 與 Validator：`1 passed`。
- Explicit direct Responses smoke：`1 passed`（text 加 strict function call、`gpt-5-mini`；bounded caps 256／512）。
- API contract：`13 / 13 / 13`（defined／implemented／exercised）；Demo flow：`1 passed`，刻意在 dispatch 前停止。
- OpenAPI snapshot：精確 13-path set 與 SHA-256 snapshot 相符；redacted observability 與 `RunBudget` limit tests 通過。
- 前端交付檢查：全新的 CPython 3.12.13 temporary environment 安裝 `requirements.lock`；FastAPI 提供 `/health`、`/docs`、`/openapi.json`；OpenAPI 暴露全部 13 個契約 paths；允許來源的 OPTIONS preflight 回傳 `Access-Control-Allow-Origin: http://localhost:5173`。
- 競賽驗收：Z4 的 112 kg 合法分散，未集中超過 100 kg 的 `VEH-002`；缺少 `location_label`／`time_slot`／`weight_kg` 時回傳 entity／field paths 與人工複核旗標；`TIME_WINDOW_CONFLICT` 與 `UNASSIGNABLE` 經 independent Validator reconciliation；order 41 產生非空 sequence／load changes 與計算後差異。
- Demo 指令：`.venv\\Scripts\\python.exe scripts/run_p0_demo.py` 成功完成，以中文輸出每台車的訂單／重量／使用率／理由證據、重新分配、例外、完整 preview diff 與人工確認提示；未呼叫 Dispatch 或 deployment。
- 修正後 urgent Demo 證據：OR-Tools initial plan before = 40 assigned／365 kg，車輛載重 `93/97/152/23`；order 41 插入 `VEH-003`，既有訂單換車數為 0，該路線 4 筆 sequence records，載重 `152 -> 154 kg`，距離 `+137 m`、時間 `+17 s`。Base 與 preview algorithm 均為 ORTOOLS，並明確回傳 dataset hashes。
- Canonical simulated run（10-second cap）：Baseline `183,955m / 23,023s`、2 unassigned；OR-Tools `161,257m / 20,185s`、0 unassigned；無 Validator violations；最近量測 solve times 為 Baseline `0.584ms`、OR-Tools `5,985.454ms`，僅供報告，不作跨機器 exact value。
- Live preflight：OpenAI Chat text／strict tool `PASS`；Google Routes matrix `PASS`；TDX `SKIPPED`（後續擴充）。刻意錯誤的 Responses tool envelope 重現 HTTP 400 `missing_required_parameter`；修正 `input`、top-level `tools`、`strict` 與 `max_output_tokens` 後，`gpt-5-mini` requests 通過。未輸出 key、header 或完整 request。
- Browser key 仍屬前端依賴且目前缺少；Google server fallback 明確。Frontend Integration 的歷史 snapshot 曾為 `PENDING`，本輪已建立 local control tower，現況為 `PARTIAL`；完整 Browser／Live E2E 仍待後續 provider gate。
- 本輪僅進行文件中文化與對外內容清理；未修改程式、API、演算法、測試邏輯，亦未執行 Dispatch、deployment 或正式環境操作。

## 人工驗收決策

| 領域 | 狀態 | 已接受證據 |
|---|---|---|
| Backend P0 | `DONE` | 合法超重重新分配；40-order OR-Tools plan 零違規；欄位級錯誤；計算後 urgent diff；independent Validator 通過。 |
| OpenAI Agent | `DONE` | Agents SDK end-to-end tool invocation、strict deterministic planning／evidence tools、evidence-only response 與 regression coverage 已由人工驗收。 |
| Frontend Integration（歷史人工決策） | `PENDING` | 歷史記錄；本輪已提供 local control tower，現況請看下方最新驗證。 |
| Overall Project | `IN_PROGRESS` | Backend 與 Agent gates 已完成，但前端整合尚未完成。 |

### 保留的 urgent-insert 證據

- Initial OR-Tools plan：40 assigned orders、總重 365 kg、車輛載重 `93/97/152/23 kg`、zero unassigned。
- `ORD-041` preview mode：`MINIMAL_CHANGE`；既有訂單換車數 `0`；僅影響 `VEH-003`。
- Before／after：`365 kg → 367 kg`、`0 → 0` unassigned、距離 `+137 m`、duration `+17 s`。
- Independent Validator：before 與 after plans 均為 `PASS`。
- 未執行 Dispatch、deployment 或正式環境操作。

## 最終結果

Specification／Harness readiness：**PASS**。Implementation gate 因明確的 `APPROVE_IMPLEMENTATION` 而開啟；deterministic core 與 FastAPI 已實作，`feature_code_allowed: true`。Backend P0 與 OpenAI Agent 依人工驗收為 **DONE**。Frontend Integration 已達 local control tower `PARTIAL`，Live Browser／Provider E2E 仍待 credentials，因此 Overall Project 維持 **IN_PROGRESS**。未執行 dispatch 或 deployment。

## 本輪前端控制塔與 Provider 驗證（2026-09-03）

| 閘門 | 結果 | 證據 |
|---|---|---|
| Google Matrix wiring | `MOCK PASS`；Live `BLOCKED` | `tests/test_live_provider_wiring.py` 驗證 strict provider、matrix hash/version 與 OR-Tools 注入；process 未設定 server key |
| Google route geometry | `IMPLEMENTED`；Live `BLOCKED` | `src/providers/google_routes.py` 與 `/map-data` strict path；未呼叫付費 API |
| TDX OAuth／route risk | `MOCK PASS`；Live `BLOCKED` | `src/providers/tdx.py`、mock token/event projection/redaction test；process 未設定 credentials |
| React control tower | `PASS` | `frontend/` API client、MUI panels、simulated map fallback、Agent／preview／confirm UI |
| Frontend quality gates | `PASS` | `pnpm install --frozen-lockfile`、`pnpm run typecheck`、`pnpm run lint`、`pnpm run test -- --run`（2 passed）、`pnpm run build`、Playwright Chromium（2 passed） |
| Backend quality gates | `PASS` | `pytest` 36 passed／3 skipped、`ruff check src tests scripts`、`mypy src` 27 files |
| Secret／deployment scan | `PASS` | tracked high-confidence secret patterns 0；`.github/workflows` 不存在；未執行 Dispatch／部署 |

前端 Browser map 在 `VITE_GOOGLE_MAPS_BROWSER_API_KEY` 缺少時刻意顯示 `SIMULATED` fallback；不能標示為 Google live。完整 browser-to-live-provider E2E 仍未完成，Overall Project 維持 `IN_PROGRESS`。

Playwright 截圖：`docs/screenshots/01-empty-control-tower.png`、`02-imported-plan.png`、`03-map-and-vehicles.png`、`04-agent-blocked.png`、`05-urgent-preview.png`、`06-human-confirmation.png`。測試以 REST endpoint 的 keyless simulated provider 執行；截圖不含 secrets。
