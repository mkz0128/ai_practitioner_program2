# 需求與覆蓋範圍

本文件將已核准的產品需求拆解為可追溯的 requirements；若文字不一致，以 `ACTIVE_SPEC.md` 為準。

## 功能需求

| ID | 需求 | 驗證 |
|---|---|---|
| FR-IMP-001 | 匯入一個恰好包含四張具名工作表的 `.xlsx`。 | Workbook unit tests；import endpoint contract |
| FR-IMP-002 | 缺少 `location_label`、`time_slot` 或 package `weight_kg` 時，回傳 entity／field-specific `MISSING_REQUIRED_FIELD` error 與 `requires_manual_review`。 | `tests/test_competition_acceptance.py` field-level fixture |
| FR-VAL-001 | 驗證 IDs、relationships、counts、weights、coordinates、zones、slots、vehicle status/load。 | Validation suite；GD-003/004/010/011/012 |
| FR-PLAN-001 | 建立 deterministic initial 40-order dispatch plan。 | Optimizer／validator tests；GD-001 |
| FR-PLAN-002 | 同一 order 的所有 packages 保留在同一台 vehicle。 | Invariant test；AC-001 |
| FR-PLAN-003 | 每張 order 恰好指派一次，或分類為 unassigned。 | Invariant test；AC-001/003 |
| FR-PLAN-004 | 強制 capacity、availability 與 service-zone constraints。 | Constraint tests；GD-002/010/012 |
| FR-PLAN-005 | 強制 AM/PM、lunch、三分鐘 service 與 depot start/end。 | Time-dimension tests；GD-005 |
| FR-PLAN-006 | 依序最佳化 feasibility、travel time/distance，再平衡載重。 | Fixed-matrix objective tests |
| FR-PLAN-007 | 在可確認前，以 independent validation 檢查 solver output。 | Validator mutation/fault-injection tests |
| FR-BAS-001 | 使用穩定 input／tie ordering 提供 deterministic First-Fit Eligible Vehicle + Nearest Neighbor Baseline。 | GD-013；exact fixed-matrix snapshot |
| FR-BAS-002 | Baseline 保留 unsplittable orders，並強制 availability、capacity、service zone、time/lunch/service 與 depot return。 | Baseline invariant suite；GD-013 |
| FR-BAS-003 | Baseline 將每張無法合法安排的 order 輸出至 `unassigned_orders`；遺漏是 critical failure。 | Dropped-order reconciliation test |
| FR-OPT-001 | 以 OR-Tools CVRPTW 建模 optimized plan，包含 Capacity／Time Dimensions、hard AM/PM windows、lunch、180-second service、eligibility 與 depot start/end。 | Dimension／constraint tests；GD-014 |
| FR-OPT-002 | 使用 `PARALLEL_CHEAPEST_INSERTION` 再使用 `GUIDED_LOCAL_SEARCH`；canonical 40-order Benchmark 受 10 秒與 1,000 solutions 限制。 | Search-parameter contract test |
| FR-OPT-003 | 使用 deterministic integer dominance 依序最小化 unassigned count、total travel time、utilization gap；distance 獨立回報。 | Objective-priority tests |
| FR-OPT-004 | 分類 solver failure／timeout／infeasible states；只暴露明確且經獨立驗證的 partial solutions。 | Status mapping and partial-solution tests；GD-015 |
| FR-BENCH-001 | Baseline 與 Optimized 使用相同版本的 simulated matrix、40 orders、4 vehicles、5 zones 與 depot snapshot。 | Input-hash equality test；GD-014 |
| FR-BENCH-002 | 回報 distance、driving time、vehicle load/utilization、utilization gap、unassigned count、四類 violation counts、solve time 與 improvement percentages。 | Benchmark schema/formula tests |
| FR-BENCH-003 | 固定 Golden values 排除 Google live traffic；live comparison 僅驗證 invariants／ranges。 | Provider-mode rejection test |
| FR-URG-005 | Order 41 優先使用 minimum-change replanning；只有 bounded minimal-change 失敗後，才允許明確標示的 full-replan preview。 | Move-count／scope／diff tests；GD-018 |
| FR-EXP-001 | 只能使用 structured tool evidence 解釋 assignments。 | Agent eval；reason schema tests |
| FR-EXP-002 | 每個已分配 Plan stop 都暴露 zone eligibility、weight、post-load/utilization、time legality 與 matrix distance/order basis 的 deterministic evidence。 | Plan API evidence acceptance test |
| FR-MAP-001 | 回傳 depot、stops、coordinates、route polyline、color、sequence、ETA 與 leg metrics。 | Map-data response snapshot |
| FR-URG-001 | 將恰好一張出發前 urgent order 預覽為新的 immutable version。 | GD-006；lifecycle tests |
| FR-URG-002 | 回傳 before/after assignment、sequence、distance/time、load 與 conflict diff。 | Preview contract tests |
| FR-URG-006 | Urgent preview 計算非 placeholder 的 reassignment、sequence、load 與 distance/time deltas，並獨立驗證 candidate。 | Demo flow 與 order-41 acceptance test |
| FR-URG-007 | Urgent preview 比較精確的 base algorithm/version/dataset identity，並回傳 before／after hashes、assigned weight、unassigned IDs 與 per-vehicle loads。 | OR-Tools base regression test |
| FR-URG-003 | 要求對精確 plan/version 進行明確人工確認。 | Transition tests；AC-002 |
| FR-URG-004 | `DISPATCHED` 後拒絕 automatic insertion。 | GD-007；AC-006 |
| FR-STATE-001 | 持久化並 audit `DRAFT→VALIDATED→PROPOSED→CONFIRMED→DISPATCHED`。 | State-machine tests |
| FR-AGENT-001 | 一個 Agent 透過 strict tools 支援五種已文件化的自然語言 intents。 | Tool-routing Evals |
| FR-AGENT-002 | Agents SDK Agent 在回答 daily dispatch、load、unassigned 與 urgent-preview requests 前，必須呼叫 deterministic planning／evidence tool。 | `tests/test_agent_sdk_scenarios.py`；live opt-in E2E |
| FR-AGENT-003 | 缺少 structured data 時必須提出 clarifying question；prompt injection 不得觸發禁止 action；final text 只能重述 tool evidence。 | SDK guardrail 與 evidence tests |
| FR-API-001 | 提供最小 REST endpoints 與可用的 OpenAPI／Swagger。 | OpenAPI snapshot 與 endpoint integration tests |
| FR-API-002 | 回傳單一穩定 error envelope 與 request ID。 | Representative 4xx/5xx contract tests |
| FR-API-003 | `docs/api-contract.md` 所列 13 條 paths 全部註冊並由 contract test 執行；Demo flow 在 dispatch 前停止。 | `tests/test_api_contract.py`；`tests/test_demo_flow.py` |

## 非功能與安全需求

| ID | 需求 | 驗證 |
|---|---|---|
| NFR-REL-001 | 沒有 OpenAI 時 core REST 仍可運作。 | OpenAI failure test |
| NFR-REL-002 | Google／TDX failure 必須明確降級，且不破壞 core planning。 | GD-009；provider fake tests |
| NFR-SEC-001 | logs／traces／context／Git 不得包含 secrets、PII、完整 workbook 或 chain-of-thought。 | Redaction tests 與 repository scan |
| NFR-SEC-002 | CORS origins 來自 environment；不得永久使用 wildcard。 | Settings／ready tests |
| NFR-SEC-003 | Untrusted chat／cells／provider text 不得覆寫 guardrails 或 approval。 | GD-008 injection tests |
| NFR-OBS-001 | 在不含 prompts、workbook contents 或 secrets 的情況下，關聯 request、dataset、plan/version 與 Agent run IDs。 | `JsonlEventRecorder` redaction 與 event-schema tests |
| NFR-COST-001 | 以 fail-closed `LIMIT_REACHED` 強制 8-turn、12-tool、30k-token、120-second 與 repeated-call limits。 | `RunBudget` boundary tests 與 Agent runtime integration |
| NFR-MNT-001 | Domain／optimizer／validator 不得 import Agent／LLM modules。 | Architecture dependency test |
| NFR-VER-001 | Python／dependencies／models 使用已審查的 locks／config。 | Lock consistency 與 config tests |
| NFR-REP-001 | Canonical Benchmark 固定 runtime／OR-Tools、fixture／matrix hash、integer units、ordering、tie-breakers、search parameters、process model、warm-up 與 measured-run protocol。 | Repeated-run route／metric equality；GD-014 |
| NFR-TEST-001 | Keyless simulated/mock tests 永遠可在沒有 network／credentials 時執行，並作為必要 CI/local gate。 | Keyless provider suite；GD-016 |
| NFR-TEST-002 | Live integration tests 僅在 provider-specific environment variables 存在時執行；否則 skip 或 fallback，不得失敗。 | Missing-key collection／execution test；GD-017 |
| NFR-SEC-004 | Tests 與 providers 絕不將 secrets 讀入 output、assertions、logs、traces、snapshots、fixtures 或 Git。 | Output-capture redaction 與 repository scan |

## 已核准需求覆蓋

| 正式主題 | 功能／決策 | Tests | 主要檔案 |
|---|---|---|---|
| Orders／areas／windows／packages／weights | 四工作表 workbook 與 domain validation | workbook suite | `ACTIVE_SPEC.md` §4 |
| Vehicle max/current load 與 service zones | Hard candidate 與 capacity constraints | GD-002/010/012 | `ACTIVE_SPEC.md` §3/5 |
| Explainable assignment/order | Evidence schema 與 Agent explanation | Agent evidence Eval | `api-contract.md` |
| Overweight／time conflict／unassignable | 穩定 exception codes 與 partial plan | GD-003/005/012 | `api-contract.md` |
| Urgent order 41 | 出發前 versioned preview／diff | GD-006/007 | `urgent-order-insertion.md` |
| Human confirmation | Plan state machine 與 audit event | lifecycle tests | `guardrails.md` |
| Single Agent | 一個 Agent，不使用 handoff／A2A／AP2 | architecture test | `architecture.md` |
| Deterministic algorithms | Services／function tools；不使用 LLM arithmetic | unit／invariant tests | `developer.md` |
| Baseline comparator | First-Fit Eligible Vehicle + Nearest Neighbor | GD-013 | `architecture.md` ADR-004 |
| OR-Tools CVRPTW | Capacity／Time Dimensions、明確 search strategy／limits、Validator | GD-014/015 | `architecture.md` ADR-004 |
| Fair Benchmark | 相同 fixed matrix／data；version/hash 與 metric formulas | GD-014 | `architecture.md` ADR-005 |
| API Key test layering | Always-on keyless suite；conditional live suite；secret redaction | GD-016/017 | `architecture.md` ADR-006 |
| Depot／zones／vehicles | 固定參考資料 | fixture validation | `ACTIVE_SPEC.md` §3 |
| 40 orders／350–380 kg／concentration | Fixed-seed sample | sample audit | demo workbook |
| Working hours／lunch／service time | Hard time dimensions | time tests | `ACTIVE_SPEC.md` §5 |
| Google Routes | Provider interface、field mask、split keys、fallback | provider tests | `architecture.md` |
| TDX | 核心 status／fallback，後續 mapping | provider tests | `implementation-plan.md` |
| SQLite | Versioned persistence／audit | repository tests | `architecture.md` |
| REST／OpenAPI／CORS | Contract-first API | 13-route contract tests plus OpenAPI hash snapshot | `api-contract.md`、`openapi-snapshot.sha256` |
| Observability／cost | Structured logs、tracing、limits | schema／limit tests | `observability.config` |
| Golden／red team | Concrete algorithm、provider、Agent、injection 與 API contract cases | Eval runner | `golden-dataset.json` |

## 驗收矩陣

| 案例 | 必要 evidence |
|---|---|
| Z4 concentration (112 kg) | Baseline 不得讓 100 kg 的 VEH-002 超載；至少一張 Z4 order 合法分配至 VEH-003；Validator 通過 |
| Missing workbook cells | 分別回傳 order／package／field paths 與 manual-review flags |
| Time-window conflict | 穩定的 `TIME_WINDOW_CONFLICT` reason 與 validator-safe partial plan |
| Capacity exhaustion | 穩定的 `UNASSIGNABLE` reason、明確 order ID，且不得靜默遺失 |
| Order 41 preview | 視情況回傳非空的 sequence／load／reassignment data 與計算後 metric deltas |
| Chinese demo | `scripts/run_p0_demo.py` 列出所有 evidence 與 approval checkpoint，且不 Dispatch／deploy |

## 功能狀態分類

### 已完成核心功能

Import／validation、固定 Demo data、deterministic planning／validator、route／map payload、overload redistribution、urgent preview／version／confirm／dispatch、SQLite、REST／OpenAPI、single Agent／tool layer、provider fallback／status、tests、README 與 frontend handoff。

### 後續擴充功能

Google live traffic／polylines、real TDX congestion mapping、congestion route-change showcase，以及額外 animation timeline detail。

## 需求變更規則

任何重大變更在實作前都必須更新 Spec ID、受影響的 API schema、Golden case、deterministic tests、migration／rollback impact 與 changelog。
