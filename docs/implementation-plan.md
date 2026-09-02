# 實作計畫

## 實作閘門

下列工作須在使用者輸入 `APPROVE_IMPLEMENTATION` 後才能開始。該指令只授權 local Feature Code 與 local deterministic tests；dependencies、external services、Git、deployment 與 production 仍依各自的核准規則處理。

## 每輪控制循環

1. 讀取 `spec-driven/ACTIVE_SPEC.md`、`docs/project-status.md` 與 `docs/validation-report.md`。
2. 設定唯一主要 `NOW`，`NEXT` 不超過三項。
3. 分類 open work：Requirement Change、Code Bug、Data Issue、External Provider Issue、Architecture Change 或已核准的一般工作。
4. 需求／架構變更先提出影響草案並等待人工核准；Code Bug 先建立可重現的失敗測試。
5. 執行範圍明確的變更與驗證。
6. 以 evidence 更新 `DONE THIS ROUND`、`LAST VALIDATION`、`OPEN ISSUES`／`BLOCKED` 與下一個 `NOW`／`NEXT`。

`docs/project-status.md` 是唯一進度來源，不得建立 NOW／TODO／DONE 的分散檔案。

## 演算法與 Benchmark 交付契約

核准後採以下實作順序：

1. 先建立 independent Validator 與 metrics calculator。
2. 建立 deterministic Baseline：stable order sort → First-Fit Eligible Vehicle → time-feasible Nearest Neighbor → explicit unassigned reconciliation。
3. 凍結／版本化 simulated matrix，並記錄其 hash 與 40-order／4-vehicle／5-zone fixture hash。
4. 建立 OR-Tools CVRPTW：Capacity／Time Dimensions、allowed vehicles、hard AM/PM windows、lunch break、180-second service、depot start/end。
5. 鎖定搜尋參數：`PARALLEL_CHEAPEST_INSERTION`、`GUIDED_LOCAL_SEARCH`、10 秒 `time_limit`、1,000 `solution_limit`。
6. 讓兩種演算法使用完全相同的 snapshot，並由同一套 Validator／metrics calculator 評估。

| Benchmark output | 單位／公式 |
|---|---|
| Total distance | meters；fixed-matrix route arcs 的總和 |
| Total driving time | seconds；fixed-matrix duration arcs 的總和 |
| Vehicle load/utilization | kg 與 `planned_load_kg / max_load_kg` |
| Utilization gap | 四台車最大 utilization 減最小 utilization |
| Unassigned | count 加上有序 IDs／reasons |
| Violations | 分別回報 overload、cross-zone、duplicate、time-window counts |
| Solve time | 只量測 algorithm；一次 warm-up 後取五次 measured runs 的 median |
| Improvement | `(baseline - optimized) / baseline * 100`；Baseline 為零時為 `null` |

Canonical comparison 排除 live Google matrices。為確保 Reproducibility，必須固定 runtime／OR-Tools、committed fixture 與 matrix version/hash、integer units、stable entity／node／tie ordering、相同 search parameters、single process，以及相同 routes／metrics。若 Wall-clock timeout 早於固定 solution limit，該 run 標記為 non-canonical，不得修改 Golden values。

## 已完成核心功能

### 資料、API 與持久化

1. 建立符合 `architecture.md` 的 package layout。
2. 實作 strict config、stable API／error envelopes、request ID middleware 與 CORS allowlist。
3. 實作 domain schemas、SQLAlchemy models／repositories 與 SQLite persistence。
4. 實作四工作表 importer、`|` normalization、validation report 與 field errors。
5. 提供 `/health`、`/ready`、dataset import/query/validation 與 provider status。
6. 提供完整 OpenAPI／Swagger、sample plan／map／error payloads 與 frontend handoff。

### Deterministic planning 與 lifecycle

1. 提供固定 seed／matrix 的 `SimulatedRouteProvider` 與 simplified polyline。
2. 提供 shared independent Validator 與 Benchmark metrics calculator。
3. 提供 First-Fit Eligible Vehicle + Nearest Neighbor Baseline。
4. 提供帶有硬性 constraints、明確 strategies 與 bounded solve 的 OR-Tools CVRPTW。
5. 提供 no-solution／partial-solution status mapping 與 unassigned reconciliation。
6. 提供 plan/version persistence、plan query 與 map-data。
7. 提供 order-41 minimum-change preview，失敗時回傳有標示的 `FULL_REPLAN` fallback。
8. 以 unit／integration／contract tests 覆蓋 critical invariants 與 Benchmark formulas。

### Agent、Provider、Observability 與安全

1. 使用一個 OpenAI Agent 與 strict function tools。
2. 實作 evidence-only explanation、tool guardrails 與 prompt-injection protection。
3. 實作 OpenAI tracing 設定、JSON logs、correlation IDs 與 usage／limit enforcement。
4. 實作 Google Routes adapter 與 field masks；缺 key 時使用明確 fallback。
5. 實作 TDX credential settings、provider health/status、timeout 與 graceful fallback。
6. 將 provider verification 分為 always-on keyless simulated／mock tests 與 opt-in live integration tests。
7. 缺少或拒絕 credentials 時，live tests skip 或 fallback，不得破壞 keyless suite。
8. 確認 API Key 不會進入 output、logs、traces、assertions、snapshots、fixtures 或 Git。
9. 維護 README、frontend handoff、Demo script、validation report 與 regression evidence。

Agents SDK 驗收包含 real `Runner.run` Agent、strict tools、`OpenAIResponsesModel` live smoke，以及 provider-neutral `ScriptedModel` E2E：daily dispatch、highest-load lookup、unassigned explanation、urgent insertion、missing-data questions、prompt injection 與 evidence-only numeric grounding。Live request 固定使用 `gpt-5-mini`；Responses tools 使用 top-level `name`／`parameters`／`strict`，不使用 Chat Completions nested function envelope。既有 HTTP 400 `missing_required_parameter` 僅作 regression diagnostic，不以更換 model 隱藏。

API gate 統計 13 組 documented method/path、13 組 FastAPI registrations 與 13 組 exercised responses。40-order Demo gate 執行 import → validation → initial plan → route-provider fallback → Agent explanation → confirm → order-41 preview/diff，並刻意不 dispatch。`src/observability` 會產生 redacted JSONL trajectory events，並施行 turn／tool／token／wall-clock／repeated-call limits；`docs/openapi-snapshot.sha256` 對 contract drift fail closed。

`tests/test_competition_acceptance.py` 覆蓋 Z4 112 kg concentration、missing address／weight／time cells、time-window／capacity exceptions 與 independent Validator。`scripts/run_p0_demo.py` 是 40-order／4-vehicle fixture 的中文 walkthrough，預覽 order 41 且不 dispatch／deploy。

Urgent insertion 先在 eligible existing routes 的合法位置執行 deterministic minimum-change search；preview 保留 base plan algorithm／identity，回傳 before／after dataset hashes 與 assigned weights，並標示 `MINIMAL_CHANGE`。只有 candidate 無法通過 independent Validator 時，才產生帶有 scope／moved-order metadata 的 `FULL_REPLAN`。

## 驗證標準

- OpenAI-off test 證明 deterministic REST continuity。
- Google／TDX error tests 證明明確 fallback／warnings。
- 沒有 provider keys 時，所有 keyless tests 通過，live tests 明確 skip。
- Credential-output capture 與 repository scan 證明 secret values 不會輸出或提交。
- Agent Evals 證明 tool routing、evidence grounding、approval boundary 與 injection defense。
- 完整 `pytest`、`ruff`、`mypy`、OpenAPI／endpoint contract、secret scan、Benchmark 與 Golden suite 通過後，才能依人工驗收更新狀態。
- Validation report 必須記錄 pytest pass／skip count、skip reasons、驗收案例、Demo status 與 Git status。

## 後續擴充功能

1. Google live traffic routing 與更精緻的 polyline integration。
2. TDX live road congestion mapping 到 segments／zones。
3. 可重現的 simulated congestion route-change scenario。
4. 額外 animation time-axis data。

## 檔案變更預期

| Area | 目的 |
|---|---|
| `src/api` | routes、dependencies、envelopes、middleware、CORS、error handler |
| `src/domain` | immutable business models 與 enums |
| `src/services` | import、validation、planning、evidence、diff |
| `src/optimization` | OR-Tools model 與 independent validator |
| `src/providers` | simulated、Google Routes、TDX adapters |
| `src/repositories` | SQLAlchemy repositories 與 versioning |
| `src/agent` | single Agent 與 strict function tools |
| `src/observability` | JSON logging／tracing／metrics／limits |
| `tests` | unit、integration、contract、Evals |
| `alembic` | SQLite schema migrations |

## 風險與緩解

| 風險 | 影響 | 緩解 |
|---|---|---|
| 範圍複雜度 | 品質或完整性不足 | contract-first、核心功能優先、simulated providers |
| OR-Tools time／lunch modeling error | illegal plan | fixed time fixtures + independent validator |
| External keys absent | Demo 無法使用外部能力 | fallback 為預設且有測試 |
| Live traffic nondeterminism | flaky tests | exact simulated tests；live 僅驗證 invariants／ranges |
| Time-limited local search drift | Golden metrics 不穩定 | 固定 solution limit／order／matrix，並獨立回報 solve time |
| Partial solution 隱藏 dropped work | unsafe／incomplete dispatch | explicit disjunction reconciliation + shared Validator |
| Urgent full reshuffle | operational instability | minimum-change tiers、標示 full-replan fallback 與 before／after diff |
| Missing API Keys | development block | always-on keyless suite；conditional live skip／fallback |
| Agent hallucinated numbers | misleading explanation | evidence schema 與 Eval；prompt 不提供 numeric source |
| Plan race／stale preview | wrong confirmation | immutable versions + optimistic concurrency |
| Provider cost loop | denial of wallet | quotas、cache、timeouts、retries、Agent limits |

## 檢查點

- 前端 contract review。
- Deterministic invariant 與 state-machine review。
- 使用 live key 前，確認 secret restrictions、quota／budget 與 provider terms。
- 任何 deployment 或 Git push 前，依規範取得獨立 Conditional LGTM。
