# 進度

最後更新：2026-09-14

## NOW

Robustness R1～R5 跨資料／說法／操作順序驗收：R1-relaxed 尚有一格待確認，其餘已完成；不涉及版面改版。

## TODO

依 `spec-driven/ACTIVE_SPEC.md` 第 10 節。`APPROVE_V2` 已取得。

| # | 工作 | 對應功能 | 前置條件 |
|---|---|---|---|
| 1 | 時段改早／中／晚三值，工作時間延至 20:00，產出**兩份** 50 單範例（relaxed 無衝突、tight 有衝突，見規格第 12 節） | F1, F3, F4, F5 | 無 |
| 2 | 動態方案卡：多次求解、代價比較、輸出格式 | F3, F4, F5 | 需 1 |
| 3 | 前端全部重寫（含 `api.ts`／`types.ts`），Tailwind + shadcn/ui | 全部 | 需 1、2 |
| 4 | 三階段 SolveScope、`LOADED` 狀態、`DISPATCHED` 權限限縮 | F3, F4, F5 | 需 1 |
| 5 | 對話修改方案卡（六項白名單） | F3, F4, F5 | 需 2、3、4 |
| 6 | 司機規則 `DispatchRule`：禁止型五類、反問流程、衝突試算 | F2 | 無，可與 3 並行 |
| 7 | 資料格式適應：表頭取樣、欄位對映、人工確認、對映表保存 | F1 | 無 |
| 8 | 配送偏差記錄與參數修正建議 | F6 | 需 4（時間軸滑桿） |
| 9 | 地圖車輛動畫（選配） | F5 | 需 3、4 |

## BLOCKED

目前無外部阻塞。

## 待確認

Q1、Q2 已於 2026-09-09 結案，見下。Q3 已於 2026-09-10 解除，外部 OpenAI provider 驗收已取得授權並完成連線。

| # | 問題 | 裁決 |
|---|---|---|
| Q6 | C 組要求重劃 Z1～Z5 的地理內容，但保留代號與規格契約。 | **已裁決並完成（2026-09-13）：** 不改 `ACTIVE_SPEC.md`，依固定最近中心點法重產兩份 workbook；僅把 demo walkthrough 中與新地理內容衝突的急單區域代號由 Z4 改為 Z3，未改句型或判定標準。 |
| Q1 | `docs/` 的 v1 文件如何處理 | **已刪除七份**：`validation-report`、`requirements`、`implementation-plan`、`frontend-handoff`、`demo-runbook`、`ui-button-acceptance`、`agent-demo-test-cases`。**保留兩份**：`architecture.md`、`api-contract.md`，因為它們描述保留不動的後端，Codex 實作時需要參照。新增端點時直接更新 `api-contract.md`，不另建新檔。 |
| Q2 | Demo 為現場 live 或預錄影片 | **兩種都要。** 因此重現性是硬性需求，見驗收 D-01～D-05：同一份資料、同一個 seed 跑兩次，分車、順序、距離必須完全一致。這不是加分項，是完成條件。 |
| Q3 | TODO 5 live 瀏覽器驗收需要呼叫外部 OpenAI provider | **已解除**：人類已明確授權本機虛構 demo 資料送至 OpenAI；提升權限後 `/ready` 顯示 `openai: ready`，F4／F5 實際對話已通過。 |
| Q4 | `docs/scenario-evals.md` 指定 W 主線使用 tight，但原 W2 的 30 km 規則在該資料上是確定性 `CONFLICT`。 | **已結案**：W2 主線改為「老王腰傷」單件重量規則；距離衝突保留為 W-20b 備用案例。tight 已重產並加入 3 張 22–28 kg、同 Z5 服務區的中等重量訂單。 |
| Q5 | 既有 G-04 輸入「三號車載重多少」的判定卻要求 `highest_load_vehicle`；本輪實際模型回覆 `lowest_load_vehicle` 的「VEH-004 目前剩餘容量 59.1 kg。」 | **已解除（BUG-12，2026-09-12）**：G-04 預期工具改為 `vehicle_load`，並新增指定車輛載重查詢；未修改輸入句。 |
| Q7 | R1 要求 relaxed 以固定急單流程產生至少 2 張實質不同方案卡，但 B-02b 禁止完全支配候選。 | **待確認（2026-09-14）**：relaxed 實際有 28 個合法插入位置，但最佳卡為 `VEH-003 第 1 站、+0.17 km、+0.33 分鐘、09:22`，其餘候選均被它在距離／時間／換車／改序／送達時間向量完全支配；未降低 B-02b 標準，等待資料或需求裁決。 |
| Q8 | 本輪資料容量要求與四個既有 Python 單元測試固定基準衝突。 | **待確認（2026-09-14）**：新要求把兩份 demo 的車隊計畫載重壓到 `≤315 kg`，因此 relaxed 不再是舊測試期待的 `316.0 kg`；新增相鄰備援後 tight `5 kg` 規則變為可行，不再符合舊測試期待的 `CONFLICT`；兩個舊 urgent batch 測試要求至少兩張卡，但候選已依 B-02b 過濾完全支配項。未改既有測試輸入／判定，需人類決定是否更新過時固定基準。 |

### 2026-09-11 本輪失敗後修正與完成

- BUG-1 修正：urgent workflow 將地點缺漏拆成 `location_label`、`city`、`district`、`latitude`、`longitude`，`priority` 改為可選預設 `NORMAL`，不再因求解器不讀的優先程度無限追問。回歸：`tests/test_urgent_insertion_workflow.py` 與 `tests/test_urgent_batch_api.py` 共 `29 passed`。
- BUG-2 修正：插單方案卡避免同一急單產生相同車輛／相同站位的重複候選；回歸測試驗證至少兩台不同車輛／站位。上述兩檔測試共 `29 passed`。
- tight fixture 已依 ACTIVE_SPEC 第 12 節重產：固定 seed `260906`；`ORD-014`、`ORD-015`、`ORD-017` 為同 Z5 服務區、EVENING、各 `22.0 kg` 的三張中等重量單。原有四項要求仍成立：`ORD-041` 載重改派、`ORD-050` 排不進去、Z5 候選距離代價差大於 3 km、至少一車時段餘裕偏小。`tests/test_demo_50_workbooks.py` 與重量規則回歸通過；同 seed 兩次規劃結果一致，`frontend/public/demo-50-tight.xlsx` 與 `data/samples/demo-50-tight.xlsx` 已同步。
- W-05 第一次重跑失敗：前一次 F6 留下 `Z5: 7` 分鐘的 runtime 參數，實際頁面通知為「已完成 46／50 張訂單的排班，方案待人工確認。」；清除殘留參數後重跑，W-05 通過。
- W-17 第二次重跑因 provider 啟動環境失敗而停止。實際輸入：`三號車的老王最近腰傷，比較重的單先不要給他`。系統實際回覆：`{"error":{"code":"AGENT_PROVIDER_UNAVAILABLE","message":"AI 服務目前無法連線，請稍後重試。","field_errors":[],"request_id":"REQ-44490986f9e5","details":{"provider":"OPENAI","exception_type":"APIConnectionError","fallback_used":false,"retryable":true}},"request_id":"REQ-44490986f9e5"}`。直接 OpenAI SDK 驗證 `gpt-5-mini` 可連線；清理舊 uvicorn listener 後由 Playwright 重新啟動，W 全段通過。
- W-01～W-52 已在最後 Agent 路由修正後，從 W-01 以 Chromium、1440×900、單 worker、單一瀏覽器連續完成：Playwright `1 passed`（93.135 秒）。階段秒數：W0 `0.322`、W1 `18.194`、W2 `21.157`、W3 `27.127`、W4 `1.083`、W5 `13.110`、W6 `5.600`、W7 `6.178`、W8 `0.363`；52 張 PNG 截圖均已寫入 `docs/screenshots/W-01.png`～`W-52.png`，無 W JPG。
- W9 15 條命題全部勾稽：C1a W-12、C1b W-06/W-21、C2a W-09、C2b W-13、C3a W-09/W-12、C3b W-12、C4a W-14/W-24/W-31、C4b W-24/W-33/W-41、M1 W-08、M2 W-09、M3 W-12、M4 W-13/W-24、P1 W-52、P2 W-13/W-11、P3 W-24/W-31/W-43，均有對應步驟證據，無缺口。
- W browser guards 通過：Console error `0`、正式 `/api/v1/plans/{id}/dispatch` requests `0`、googleapis requests `0`。W-11 其他三台路線淡化、W-13 載重改派理由、W-23 ≤2 則訊息、W-24 實質不同方案卡均通過。
- A～J 功能 Eval 已以 Chromium、1440×900、單 worker、鍵盤 Enter 完成對應瀏覽器區塊：TODO2／TODO4（F3-01～F3-07、F4 全部、F5-01～F5-05）`3 passed`（59.2 秒）；TODO5（F3-08～F3-12、R-04、R-06、R-07）`1 passed`（約 1.8 分鐘）；TODO6（F2-01～F2-10、R-05）`4 passed`（約 1.9 分鐘）；TODO8（F6-01～F6-07）`1 passed`（18.1 秒）；G／D 最終區塊 `2 passed`（36.0 秒）。各區塊均驗證 Console error `0`、正式 `/dispatch` requests `0`、googleapis requests `0`。
- A～J 中途失敗與實際證據：TODO5 原 locator 點到不可選的「需人工處理」卡，實際等待訊息為 `getByRole('button', { name: '取消', exact: true }).last()`，已改為 `button.urgent-card` 並重跑全區塊；TODO6 首次 `D-05` 輸入 `這單一定要給老王送` 時，系統實際回覆逐字為「已完成確定性工具計算；未驗證的數字或訂單資訊已省略，請展開查看計算依據。」且 evidence 誤選 `reassign_order_preview`／`REASSIGNMENT_NOT_FEASIBLE`，已加強 strict Agent 規則：人名不可映射成車號，重跑全 TODO6 `4 passed`；G-07 曾因 F6 殘留參數回覆「已用新參數重新排班；目前 46／50 張已安排，結果如實顯示。」已清除 runtime 參數並重跑 G／D `2 passed`。
- A～J 的 H-01～H-04、I-01～I-04、J-01～J-05 由上述 W、TODO2／TODO4、TODO5、TODO6、TODO8、G／D 對應步驟逐項覆蓋；其中 W-09、W-11、W-13、W-23、W-24、W-31、W-43 與 tight 專屬測試均已通過，沒有未勾稽項目。最後 `data/runtime/dispatch-parameters.json` 已清回 `{}`。

## DONE

### 2026-09-14 — Fleet resilience：停駛重算與資料容量回歸

- `scripts/generate_demo_50.py` 重產並同步兩份 50 單 workbook 到 `frontend/public/`：tight 維持 `49/50`、`ORD-050` 未安排與 VEH-003 的 45／22／22／22 kg 重單；relaxed 維持 `50/50`。確定性 BALANCED 結果為 tight `235.0 km`、車隊計畫載重 `314.4 kg`，relaxed `231.2 km`、車隊計畫載重 `313.8 kg`；均低於本輪要求，四車載重率均非 7% 極端值。
- 車輛責任區加入相鄰備援：`scripts/generate_demo_50.py` 的 VEH-003／VEH-004 保留東北相鄰緊急備援，VEH-001／VEH-002 負責西南與中區；正常求解仍以主責區偏好為先。`src/agent/runtime.py` 新增停駛後的確定性 fallback 與衝突診斷，會回報可安排／未安排張數、區域、原因及人工處理選項，不再回「沒有任何訂單能在目前限制下指派」。
- 新增 `frontend/tests/e2e/fleet-resilience.spec.ts`。Chromium 畫面逐字鍵盤輸入四句停駛情境並截圖：`FLEET-01.png`～`FLEET-04.png`；最終輸出 `4 passed (53.7s)`。畫面實際回覆分別含：VEH-001 `目前可安排 35 張，未安排 15 張`、VEH-002 `目前可安排 49 張，未安排 1 張`、VEH-003 `目前可安排 49 張，未安排 1 張`、VEH-004 `目前可安排 48 張，未安排 2 張`，並均含區域衝突與人工處理選項。
- 主要瀏覽器回歸均在 UI 以 `pressSequentially()`／Enter 完成：`demo-walkthrough.spec.ts` `1 passed (2.0m)`、`d-e-acceptance.spec.ts` `2 passed (14.2s)`、R1 tight `1 passed (2.1m)`、R1 legacy `1 passed (2.6m)`、R5 `5 passed (31.2s)`；混合 robustness run 為 `33 passed, 1 failed`，唯一失敗是既知 R1-relaxed 的單卡／B-02b 衝突，畫面只有一張不被支配卡，未放寬判定。
- `scripts/run_intent_routing_evals.py` 完整 `48/48 通過`；修正其 B 脈絡前置資料 `Z4／信義` 不一致為合法 `Z3／信義` 後，`scripts/run_refusal_stability_evals.py` 完整 `24/24 通過`，每格均為主 Agent `RunResult` 且 token > 0。完整輸出保留在 `docs/fleet-resilience-intent-evals.log`、`docs/fleet-resilience-refusal-evals-final.log`。
- 靜態檢查：ruff `All checks passed!`；mypy `Success: no issues found in 36 source files`；前端 ESLint、`tsc --noEmit`、Vitest `1 file／2 tests passed`、production build `42 modules transformed`、`✓ built` 均通過。完整 pytest（提升權限排除 tmp_path sandbox 假錯誤）為 `183 passed, 28 skipped, 4 failed`；4 格是重產資料後與舊固定基準衝突：`test_column_mapping` 仍期待 316.0kg、tight 5kg 規則仍期待 CONFLICT、兩個舊 urgent batch 測試仍期待被支配候選；未改測試輸入／判定。
- 後端最後以無 `--reload` 啟動，PID `26172`，`2026-09-14 19:42:39`；最後 Python 原始碼修改為 `scripts/generate_demo_50.py` `2026-09-14 19:42:04`，重啟晚於修改。收尾 `data/runtime/dispatch-parameters.json={}`、`dispatch-rules.json=[]`，health log 為 `GET /health 200 OK`。


### 2026-09-14 — Robustness R1～R5 跨資料與連續操作驗收（R1 部分待確認）

- 新增可重用的瀏覽器走查 helper 與三組測試：`frontend/tests/e2e/robustness-helpers.ts`、`robustness-datasets.spec.ts`、`robustness-paraphrase.spec.ts`、`robustness-sequence.spec.ts`。所有情境均由 Chromium 畫面以 `pressSequentially()` 打入 `輸入訊息` 後按 Enter；每步截圖存於 `docs/screenshots/`，未使用 API 回應作為 UI 通過證據。
- R2／R4：本輪完整重跑 `29 passed (4.7m)`，log 為 `docs/robustness-paraphrase-final-ui-rerun4.log`；R3：`3 passed (2.9m)`，三段均不 reload，log 為 `docs/robustness-sequence-final-ui.log`；R5：`5 passed (26.5s)`，log 為 `docs/robustness-r5-final-ui-rerun.log`。所有情境仍由 Chromium 畫面以 `pressSequentially()` 打入 `輸入訊息` 後按 Enter，每格截圖保留於 `docs/screenshots/`；未使用 API 回應作為 UI 通過證據。R5 畫面實際確認對映表、中文缺欄、重複編號、空檔與 guardrail note。
- R1：tight `1 passed (1.9m)`、40 單 legacy `1 passed (2.4m)`；relaxed `1 failed`。失敗輸入依序為 `客戶剛剛打電話來，有一張急單要今天早上送到，15公斤`、`ORD-101，信義示範配送點 Z3-51，臺北市，行政區信義，25.033，121.565，Z3，1 件`、`產生插單預覽`；畫面逐字回覆：`已完成 1 張臨時訂單的同批預覽：ORD-101 安排至 VEH-003 第 1 站。目前有 1 張可行方案卡，既有訂單換車 0 張，距離變化 +166 公尺，時間變化 +20 秒。請在對話中的方案卡選擇，這只是預覽，尚未套用。`，卡片為 `方案 A／VEH-003 第 1 站／+0.2 km／+0.3 分鐘／換車 0 張／預估送達 09:22`。截圖：`R1-relaxed-07-preview.png`、`R1-relaxed-07-cards.png`；原因與 B-02b 完全支配候選衝突已記入 Q7，未放寬判定。R1 完整 suite 因此在 relaxed 後略過 legacy，legacy 已另行以瀏覽器補跑並通過。
- 本輪修正：`src/agent/runtime.py` 強化 `PlanDispatchInput.plan_request_scope` 與 Agent 指示，已有驗證方案時，要求重新安排目前批次／現有訂單會進 `FULL_REDISTRIBUTION` 確定性拒絕，不會誤做新正式方案；同時補強只說司機／師傅的車、未提供車號時不得猜任意車，必須進選車反問。`frontend/tests/e2e/robustness-paraphrase.spec.ts` 將 R4-7 的網路監測 locator 收斂為精確 `/api/v1/dispatch`，排除初始化的 `/api/v1/dispatch-rules`。
- 修正後畫面實例：R2-1-4 `老王的車不要再放重的貨了` → `請先選擇要限制的車輛，再選擇禁止型規則。`；R4-4 `這批貨我想重新安排一下` → `這個我不能改；目前只支援方案卡列出的六種配送調整。`；R3-1-01 → `了解。要限制 VEH-003 的單件重量上限，多重算重？ VEH-003 目前狀況：最大單件 45 kg；超過 20 kg 的有 4 張；超過 25 kg 的有 1 張。 另外請告訴我規則期限：永久（PERMANENT）、本週（THIS_WEEK）或今天（TODAY）。`。
- R1 tight 畫面產生 `3` 張卡；40 單 legacy 使用該檔責任區合法的 `Z4` 急單位置，畫面產生 `3` 張卡。對應逐步截圖為 `R1-tight-*.png`、`R1-40-*.png`。
- 為修復異常資料 UI 顯示，`frontend/src/components/ChatPanel.tsx` 對 inspect invalid workbook 錯誤補接 `formatValidationError`，讓缺欄明細使用中文欄位名；`R5-missing.png` 畫面已確認不出現 `location_label`／`time_slot`／`weight_kg`。
- 靜態檢查：前端 tsc `exit 0`、ESLint `exit 0`、Vitest `1 file passed／2 tests passed`、production build `42 modules transformed` 且 `✓ built`；ruff `All checks passed!`；mypy `Success: no issues found in 36 source files`。完整 pytest 提升本機權限後為 `184 passed, 28 skipped, 3 failed`；3 格均為測試刻意設定 `configured-for-test` 後的 `AuthenticationError`，不是瀏覽器 UI 通過證據，未宣稱全綠。
- 靜態檢查：ruff `All checks passed!`；mypy `Success: no issues found in 36 source files`；前端 ESLint `exit 0`、本地 `tsc.cmd --noEmit` `exit 0`、Vitest `1 file passed／2 tests passed`、production build `42 modules transformed` 且 `✓ built`。`pnpm exec tsc --noEmit` 與沙盒內 Vitest 各曾被本機父層讀取權限阻擋，已用同一份本地 binary／提升本機讀取權限重跑通過，原始錯誤 log 亦保留。
- 後端已於 `2026-09-14 09:40:56` 以無 `--reload` 啟動（listener PID `33628`），最後一次 Python 原始碼修改時間為 `2026-09-14 09:40:37`，重啟晚於修改。runtime 收尾檔案實際為 `dispatch-parameters.json={}`、`dispatch-rules.json=[]`。版面檔 `styles.css`、`MapView.tsx`、`ChatPanel.tsx` 的版面結構未改動。

### 2026-09-14 — C／D／E 完成驗收與回歸

- C 組資料重劃：`scripts/generate_demo_50.py` 以固定 seed 產生兩份 workbook，並同步到 `frontend/public/`。最新確定性結果為 `demo-50-relaxed.xlsx`：`valid=True`、`50/50`、BALANCED 總距離 `243.324 km`；`demo-50-tight.xlsx`：`valid=True`、`49/50`、未指派 `ORD-050`、BALANCED 總距離 `235.010 km`。四車路線區域為 `VEH-001=[Z4,Z5]`、`VEH-002=[Z3]`、`VEH-003=[Z2]`、`VEH-004=[Z1]`；tight 的 VEH-003 載入 `99.4 kg／160 kg`，含 15 張單與三張 22 kg 中等重量單。固定 seed 重跑摘要 `repeat_equal=True`。
- C 組方案卡：`src/services/urgent_options.py` 保留單車／站位插入與單車局部移交，局部移交最多 3 張既有單，所有候選仍逐一通過確定性 Validator，並沿用非負增量與支配候選過濾。為維持既有隨機版本鏈結回歸，未帶明確規則快照的舊服務層呼叫維持原行為；正式 API／Agent 皆傳入規則快照。`tests/test_randomized_acceptance.py` 修正後對應回歸 `18 passed`。
- C 組瀏覽器閘門：Chromium、1440×900、鍵盤 `pressSequentially()` 的 `demo-walkthrough` 實際 `1 passed (1.7m)`；方案卡、規則、載重改派、tight `49/50` 與不可安排單均通過。截圖：[zone-redesign-before.png](C:/Users/User/Desktop/AI實戰營2/docs/screenshots/zone-redesign-before.png)、[zone-redesign-after.png](C:/Users/User/Desktop/AI實戰營2/docs/screenshots/zone-redesign-after.png)、[demo-07-cards.png](C:/Users/User/Desktop/AI實戰營2/docs/screenshots/demo-07-cards.png)。
- D／E 瀏覽器閘門：`d-e-acceptance` 實際 `2 passed (16.4s)`；D 驗證自動開場、四車排序與後端站序預覽，E 驗證鍵盤送出後真實等待階段。截圖：[d-auto-loaded.png](C:/Users/User/Desktop/AI實戰營2/docs/screenshots/d-auto-loaded.png)、[d-order-sorted.png](C:/Users/User/Desktop/AI實戰營2/docs/screenshots/d-order-sorted.png)、[d-route-preview.png](C:/Users/User/Desktop/AI實戰營2/docs/screenshots/d-route-preview.png)、[e-thinking-1.png](C:/Users/User/Desktop/AI實戰營2/docs/screenshots/e-thinking-1.png)、[e-thinking-2.png](C:/Users/User/Desktop/AI實戰營2/docs/screenshots/e-thinking-2.png)、[e-thinking-3.png](C:/Users/User/Desktop/AI實戰營2/docs/screenshots/e-thinking-3.png)。
- F6 資料適應回歸：`todo8-deviations` `1 passed (13.6s)`、`f6-deviation-data-adaptation` `1 passed (17.1s)`；兩份資料的偏差車輛／區域由計算結果產生，非寫死常數。相關截圖：[f6-deviation-tight.png](C:/Users/User/Desktop/AI實戰營2/docs/screenshots/f6-deviation-tight.png)、[f6-deviation-40.png](C:/Users/User/Desktop/AI實戰營2/docs/screenshots/f6-deviation-40.png)。
- 完整 Python 回歸：修正後 `.venv\\Scripts\\python.exe -m pytest -q --basetemp .pytest-tmp-final2` 實際 `187 passed, 28 skipped, 4 warnings in 429.38s (0:07:09)`；`.venv\\Scripts\\python.exe -m ruff check .` 實際 `All checks passed!`；`.venv\\Scripts\\python.exe -m mypy src` 實際 `Success: no issues found in 36 source files`。完整 pytest 輸出保留於 `pytest-final2.log`。
- 完整前端驗證：ESLint exit `0`、`tsc --noEmit` exit `0`；Vitest `1 file passed／2 tests passed／Duration 1.22s`；production Vite build `42 modules transformed`、`✓ built in 997ms`。先前 Vitest 一次受沙盒讀取權限阻擋，提升本機讀取權限後同一指令通過，非測試失敗。
- 後端以無 `--reload` 重啟為 PID `12564`，啟動時間 `2026-09-14 00:27:06`，`Application startup complete`；其後 Chromium 實際對話流程通過。中途受限程序曾回傳 `503 AGENT_PROVIDER_UNAVAILABLE/APIConnectionError`，已用授權的外連環境重啟後重跑，未把該次失敗當成通過。

### 2026-09-13 — C 組地理區域重劃

- 依裁決保留 Z1～Z5 代號與 `ACTIVE_SPEC.md`，在 `scripts/generate_demo_50.py` 寫入固定行政區中心點與經度 0.9 修正的最近中心點法；重產 `data/samples/demo-50-relaxed.xlsx`、`data/samples/demo-50-tight.xlsx`，並同步 `frontend/public/`。
- 兩份資料均使用集中於區域中心的確定性座標與可讀行政區站名；relaxed BALANCED 實測 `129.9 km`、`50/50`；tight BALANCED 實測 `144.1 km`、`49/50`，唯一未指派 `ORD-050`；四車載重率實測約 `62.9%～74.5%`，tight 的 VEH-003 含 `ORD-014`／`ORD-015`／`ORD-017` 三張 `22.0 kg` 單。
- 修正 `src/services/dispatch_rules.py` 的確定性重量規則試算：合法目標車滿載時，有限步數搬移可合法轉出的既有站點後再改派受規則影響單；仍逐步通過 Validator，不放寬容量、時段或服務區域。規則試算實測 `FEASIBLE`、仍只保留 `ORD-050` 未指派；`tests/test_demo_50_workbooks.py tests/test_dispatch_rules.py` 以 workspace basetemp 實跑 `9 passed`。
- `frontend/tests/e2e/demo-walkthrough.spec.ts` 僅更新 C 組地理代號 `Z4→Z3`，其餘輸入與斷言不變；Chromium、1440×900、鍵盤 `pressSequentially()` 完整走查 `1 passed (1.7m)`。瀏覽器產生截圖 `docs/screenshots/zone-redesign-after.png`，前置基線為 `docs/screenshots/zone-redesign-before.png`。

### 2026-09-13 — A／B 回歸與 C 影響盤點

- A 組：`frontend/tests/e2e/a-human-language.spec.ts` 以 1440×900、鍵盤 `pressSequentially()` 實測五句常識題，`1 passed (39.1s)`；`demo-walkthrough.spec.ts` 全程鍵盤走查 `1 passed (1.7m)`，畫面截圖已更新 `docs/screenshots/demo-*.png`。
- B-2／BUG-9／NIT：`frontend/tests/e2e/bug9-f5-nits.spec.ts` 以 relaxed／tight 各跑兩次，且提前配送、移除訂單與回顧均使用鍵盤輸入，`4 passed (1.1m)`；`todo8-deviations.spec.ts` `1 passed (10.8s)`。F5 卡片保留已完成站點前綴、顯示目前位置／原 ETA／已完成站數、完整剩餘路線與理由；前端地圖在預覽版本同步顯示整段重規劃路線。
- B-1：新增 `frontend/tests/e2e/f6-deviation-data-adaptation.spec.ts`，以 `demo-50-tight.xlsx` 與 `demo-delivery-40-orders.xlsx` 逐一在畫面拖動時間軸，偏差車輛／區域訊息均由畫面顯示且隨資料改變；`1 passed (14.2s)`。截圖：`docs/screenshots/f6-deviation-tight.png`、`docs/screenshots/f6-deviation-40.png`。
- 程式回歸：`pytest tests/test_dispatch_deviations.py tests/test_solve_scope.py tests/test_operator_messages.py tests/test_plan_change_cards.py` → `9 passed, 4 warnings`；`ruff` → `All checks passed!`；`mypy` → `Success: no issues found in 36 source files`。
- 前端回歸：`pnpm lint`、workspace `tsc --noEmit`、Vitest `1 file / 2 tests passed`、Vite production build `42 modules transformed` 均通過。以工作區 basetemp 重跑完整 pytest → `187 passed, 28 skipped, 4 warnings in 425.69s`；第一次未指定 basetemp 曾因 Windows Temp `WinError 5` 失敗，已用明確工作區 basetemp 重跑成功。
- 路由護欄：`.tmp/intent-routing-latest.log` 完整輸出結尾為 `48/48 通過，0 個測項未全數通過`；`.tmp/refusal-stability-latest.log` 完整輸出結尾為 `24/24 通過`，每格 `runner=RunResult` 且 token 非零。
- C 影響盤點：`ACTIVE_SPEC.md` 第 12 節仍以 Z1～Z5 為正式資料契約；跨 `src`／`frontend`／`tests`／`scripts`／`docs`／`spec-driven` 搜尋得到 `203` 筆參照。已把衝突與解除條件寫入 Q6，未自行重產 fixture。

### 2026-09-13 — 越權拒絕穩定性、BUG-13、G-07、A-09

- 第 1 件：先用真實 HTTP Agent 路徑驗證成因。relaxed、DISPATCHED、`ORD-011 客戶說中午前一定要拿到` 的一次實際回應誤走 `explain_assignment`，`runner_result_type=RunResult`、`usage.total_tokens=5185`，不是前置分類器吞掉；修正 `src/agent/runtime.py` 的 `PlanDispatchInput` strict scope、無條件拒絕指令與工具邊界描述，metadata 的選定訂單只作代名詞參照，不得覆蓋本回合明示的操作語意。新增 `scripts/run_refusal_stability_evals.py`，固定 ORTOOLS／BALANCED／SIMULATED／SIMULATED，8 句 × 3 脈絡共 24 格，逐格檢查拒絕文字、最後 evidence tool、無 `plan_dispatch`、RunResult 與非零 token。第一次完整跑為 `23/24`（單一 HTTP 502），同一腳本重跑為 `24/24 通過`、exit 0。
- 第 2 件：`src/api/main.py` 新增 `/api/v1/runtime/reset`，一次清除服務時間參數與所有 dispatch rules；`frontend/src/App.tsx` 的重新開始換新 session 並呼叫 reset；Playwright 加 global setup／teardown，TODO 8 每測試後也 reset。完整 Chromium E2E 連跑兩次均為 `47 passed, 1 skipped`（48 tests；TODO 5 預期 skip），第二次沒有殘留狀態失敗；收尾 runtime 檔案實際為 `dispatch-parameters.json={}`、`dispatch-rules.json=[]`。
- 第 3 件：`frontend/src/api.ts` 網路錯誤改為「連線失敗：目前連不上後端服務，請稍後再試。」；NIT-6 實測命中 G 區塊錯誤判定，且沒有假成功或原始 `fetch`／`TypeError`／stack 字串。
- 第 4 件：`src/agent/urgent_workflow.py` 的顯示地點推導維持邊界：latitude 與 longitude 都有時可由行政區／座標產生 `location_label`；沒有完整座標時仍列「地點名稱」缺欄。新增 `A-09`，A-08 實測 `5/5`；完整 Playwright A／B／I 與 W3 均通過。
- 收工前實測：pytest `184 passed, 28 skipped, 3 warnings`；ruff `All checks passed!`；mypy `Success: no issues found in 36 source files`；intent routing `48/48 通過`、exit 0；refusal stability `24/24 通過`、exit 0；frontend ESLint 通過、tsc 無輸出且 exit 0、Vitest `1 file／2 tests passed`、production build `42 modules transformed`。
- 完整 E2E 兩輪另驗證 layout E、F1、BUG-9／10／11／12、NIT-4／5／6、PERF-1、A／B／I、W／W3、TODO 2／4／6／7／8；1440×900 實測頁高 `1548px`、水平溢位 false、`chatToFleetGap=26px`、Console errors／正式 `/dispatch`／googleapis requests 均為 0。版面相關檔案未在本輪修改。
- 時間戳：最後一次 Python 原始碼修改 `src/agent/runtime.py`：`2026-09-13 12:51:14`；最後一次無 `--reload` 後端重啟：`2026-09-13 12:51:52`（PID 21712），前者早於後者；最後 `/health` 實際 HTTP `200`。

### 2026-09-12 — NIT-4／NIT-5／NIT-6／PERF-1

- NIT-4：移除欄位對映面板的 `Column mapping`、選取訂單與其他裝飾性英文小標；共用 `frontend/src/lib/fieldLabels.ts` 提供中文欄位名稱。全域搜尋 `frontend/src` 的 `uppercase tracking-wider`、`Column mapping`、`Selected order` 均無命中；保留的 CSS uppercase 僅是功能性表頭／車輛進度線標題。
- NIT-5：匯入 `data/samples/demo-missing-fields.xlsx` 的三條缺欄訊息改顯示「地點名稱／配送時段／重量」等中文；API evidence 的 `location_label`／`time_slot`／`weight_kg` machine key 保持不變。Playwright `nit4-6-acceptance.spec.ts` `3 passed`。
- NIT-6：`frontend/src/api.ts` 將 fetch 網路層失敗轉為「連不上後端服務，請稍後再試。」；不製造成功結果。除模擬 abort 測試外，實際先建立 50 單方案、停止 uvicorn、同頁鍵盤送出「今天調度狀況如何」，畫面逐字顯示「連不上後端服務，請稍後再試。」；`raw_error_present=false`。
- PERF-1 量測（前端實際鍵盤路徑，`BALANCED／SIMULATED／SIMULATED`）：1 張理解 `6.732s`、預覽 `0.827s`；3 張理解 `6.784s`、預覽 `0.207s`；10 張理解 `18.171s`、預覽 `2.390s`，總計 `20.561s`，達成 30 秒目標。預覽不是 58 秒瓶頸；主要等待來自理解階段重複的 strict 欄位來源稽核與過大的回應上限，已改為只有不完整草稿才稽核，未減少候選或放寬約束。`docs/demo-qa-playbook.md` Q-03 已記錄量測與瓶頸。
- 回歸證據：TODO5 `1 passed (2.4m)`；TODO6 `4 passed (1.7m)`；scenario-evals-w W-01～W-52 `1 passed (1.8m)`，總計 `103.379s`，階段 W0 `0.334s`、W1 `13.766s`、W2 `19.109s`、W3 `28.595s`、W4 `1.696s`、W5 `22.064s`、W6 `9.058s`、W7 `8.439s`、W8 `0.318s`。上述瀏覽器驗收均為單 worker，Console error／正式 `/dispatch` requests／googleapis requests 均為 `0`。
- 最終靜態與測試：Python `ruff All checks passed!`、`mypy Success: no issues found in 36 source files`；frontend `tsc --noEmit`、ESLint、Vitest `2 passed`、production build `42 modules transformed`；全套 pytest `181 passed, 28 skipped, 4 warnings`；`python scripts/run_intent_routing_evals.py --base http://127.0.0.1:8000` `48/48 通過`、exit 0（三組資料各 2 次）。
- 時間戳：最後一個 production source `src/agent/urgent_workflow.py` 修改時間 `2026-09-12 22:21:26`；最後一個程式碼檔（scenario locator）修改時間 `2026-09-12 23:03:41`；後端最後以無 `--reload` 重啟時間 `2026-09-12 23:28:10.506`，晚於兩者。後端 `/health` 實際回應 200。

### 2026-09-12 — BUG-12 指定車輛載重查詢

- 新增 `src/agent/runtime.py` 的 strict `vehicle_load(vehicle_id)` 工具。工具 schema 直接要求 `vehicle_id`，回傳指定車輛的 `planned_load_kg`、`max_load_kg`、`load_utilization`、`remaining_capacity_kg` 與確定性人話摘要；找不到車輛或沒有資料時 fail closed。`highest_load_vehicle` 僅處理「哪台最重」，`lowest_load_vehicle` 僅處理「哪台最空／最少」，三者邊界同步寫入 docstring 與 Agent instructions。
- `src/api/main.py` 與 `frontend/src/components/ChatPanel.tsx` 同步呈現 `vehicle_load` 的車號、載重、上限、使用率與剩餘容量；所有數字直接來自工具 evidence。`frontend/tests/e2e/final-guardrails-repro.spec.ts` 的 G-04 預期工具已由 `highest_load_vehicle` 改為 `vehicle_load`，輸入句維持「三號車載重多少」。
- 新增回歸 `tests/test_bug12_vehicle_load.py`，四台 `VEH-001`～`VEH-004` 均核對 vehicle ID 與四項數值；同步加入空資料 fail-closed 測試。單元／安全回歸 `14 passed`，完整 pytest `181 passed, 28 skipped, 3 warnings`。
- 瀏覽器以 Chromium、1440×900、鍵盤 Enter 實跑四句「一號車載重多少／二號車載重多少／三號車載重多少／四號車載重多少」：`1 passed (33.2s)`；四次皆呼叫 `vehicle_load`，回覆 vehicle ID 與車輛概況畫面一致，數字一致；Console error／正式 `/dispatch` requests／googleapis requests 均為 `0`。截圖：[BUG-12-vehicle-load.png](C:/Users/User/Desktop/AI實戰營2/docs/screenshots/BUG-12-vehicle-load.png)。
- G-01～G-07 含修正後 G-04 的 Chromium 回歸：`1 passed (21.0s)`。三組資料、每案兩次的 `python scripts/run_intent_routing_evals.py`：`48/48 通過，0 個測項未全數通過`，exit 0。ruff `All checks passed!`；mypy `Success: no issues found in 36 source files`；frontend `tsc --noEmit`、ESLint、Vitest `2 passed`、production build `41 modules transformed` 均通過。
- 後端已以無 `--reload` 方式運行；`/ready` 實際回傳 database／optimizer／openai `ready`，google_routes／tdx `disabled`。

### 2026-09-12 — BUG-10／BUG-11／NIT-3

- BUG-10 修正 session 隔離：`frontend/src/App.tsx` 改為每次載入頁面產生 `CONVERSATION-{uuid}`，重新開始時換新 session；`src/api/main.py` 在 dataset／plan 更換時清除該 session 的 stage、frozen stops、急單草稿與對話脈絡。瀏覽器實跑「匯入 → 裝車 → 發車 → 拖時間軸 → 重新開始 → 重新匯入 → 三號車今天不能出車」，新 session 的 `frozen_order_ids`／`frozen_order_count` 均為空，回覆不含舊 frozen order ID。
- BUG-11 修正前端 400 護欄回覆：`ChatPanel` 對 `result.response` 與 `result.error` 都保證非空助理文字，空值有明確 fallback。以兩個被擋輸入的實際 400 envelope 驗證，畫面均顯示後端 message，不再出現空白氣泡。
- NIT-3 修正確定性工具的人話回覆：最高載重回覆 `VEH-003 目前計畫載重 101 kg，載重上限 160 kg。`；移除訂單回覆 `已試算今天不配送 ORD-019：目前方案將安排 49 張訂單；原方案尚未變更。`；車輛停駛回覆包含 `VEH-003 今天停駛試算完成` 與實際可安排／未安排張數。數字均來自工具 evidence，非模型計算。
- 回歸測試：`tests/test_nit3_replies.py`、`tests/test_agent_session_reset.py` 共 `4 passed`；全套 pytest `176 passed, 28 skipped, 3 warnings`；ruff `All checks passed!`；mypy `Success: no issues found in 36 source files`；frontend `tsc --noEmit`、ESLint、Vitest `2 passed`、production build 均通過。
- 瀏覽器 1440×900 實跑 `frontend/tests/e2e/bug10-session-guardrail-nit3.spec.ts`：`3 passed (52.2s)`；BUG-10、BUG-11、NIT-3 均使用實際 UI 流程，Console error／正式 `/dispatch` requests／googleapis requests 均為 `0`。截圖：[BUG-10-session-reset.png](C:/Users/User/Desktop/AI實戰營2/docs/screenshots/BUG-10-session-reset.png)、[BUG-11-guardrail-message.png](C:/Users/User/Desktop/AI實戰營2/docs/screenshots/BUG-11-guardrail-message.png)、[NIT-3-concrete-replies.png](C:/Users/User/Desktop/AI實戰營2/docs/screenshots/NIT-3-concrete-replies.png)。
- 後端已以無 `--reload` 啟動：`python -m uvicorn src.api.main:app --host 127.0.0.1 --port 8000`；`/ready` 實際回傳 database／optimizer／openai `ready`，google_routes／tdx `disabled`。

### 2026-09-12 — BUG-9／NIT-1／NIT-2

- BUG-9 先依 `docs/demo-script.md` 第 6 幕在 10:40 診斷，沒有放寬已發車時段約束：`demo-50-relaxed.xlsx` 與 `demo-50-tight.xlsx` 各連跑 2 次，四次皆 `status=PREVIEWED`、各有 1 張可選卡。`ORD-011` 不在 `frozen_order_ids`，`sequence_changes` 只涉及未凍結剩餘站點；同一操作在時間軸 300 分鐘時會把 ORD-011 視為已凍結並無候選，確認原先回報差異來自測試時間點，不是 tight 資料或剩餘集合邏輯。新增回歸 `frontend/tests/e2e/bug9-f5-nits.spec.ts` 固化這些邊界斷言。
- NIT-1 修正 `src/api/main.py` 的修改方案卡 ETA：提前配送卡顯示 `13:00`，移除訂單卡保留原預估送達並顯示 `17:14`；`frontend/src/types.ts`、`frontend/src/components/ChatPanel.tsx` 同步讀取 `estimated_eta`。方案卡成本只顯示不小於 0 的本次選項成本；完整負值 diff 保留在稽核 evidence，不改可行性判定。
- NIT-2 修正 `src/agent/runtime.py` 偏差工具 evidence，將確定性 VEH-003／Z5 偏差組成可直接對調度員說明的摘要；`src/api/main.py` 允許偏差與總覽工具回覆其 deterministic message。實際回覆包含「今天回顧：」、「VEH-003」與「Z5」，不再是「已完成確定性工具計算」空泛句；明確輸入 `ORD-019 改成下午送` 也會進 `change_order_constraint`，本次在既有站點鎖定下逐字回覆「調整後無法在原車輛與既定站點鎖下維持合法時段。」。
- 靜態與後端回歸：ruff `All checks passed!`；mypy `Success: no issues found in 36 source files`；完整 pytest `172 passed, 28 skipped, 4 warnings`，最後提示詞修正後再跑方案／Agent／solve-scope／偏差焦點 pytest `51 passed, 4 warnings`。前端 tsc、ESLint、Vitest `1 file / 2 tests passed`、production build `41 modules transformed` 均通過。
- 瀏覽器 Chromium、1440×900、單 worker、無正式 `/dispatch` 與無 googleapis：修正 locator 後 `bug9-f5-nits.spec.ts` `4 passed`（約 1.2 分鐘）。Console error `0`、正式 `/api/v1/plans/{id}/dispatch` requests `0`、googleapis requests `0`；截圖為 `docs/screenshots/BUG-9-demo-50-relaxed-1.png`、`BUG-9-demo-50-relaxed-2.png`、`BUG-9-demo-50-tight-1.png`、`BUG-9-demo-50-tight-2.png`、`NIT-1-early.png`、`NIT-1-remove.png`、`NIT-2-review.png`、`NIT-2-time-slot.png`。
- 中途測試失敗已修正並完整重跑：第一次 tight 等待摘要使用錯誤的 `50／50` locator，實際 tight 摘要是 `49／50`；第二次角色 locator 在頁面已有方案文字時未命中，改用保留的 `[aria-label="臨時插單方案"]` locator。`docs/demo-script.md` 無修改。

### 2026-09-12 — BUG-8 Demo 兩句急單回歸

- 修正 `src/agent/urgent_workflow.py`：`latitude` 與 `longitude` 都由 strict 結構化輸出明確提供時，`location_label` 不再列入缺欄；若沒有地點名稱，確定性程式依行政區或座標產生顯示用標籤。`to_order()` 與工作流合併路徑共用此行為，不放寬城市、行政區、區域、時段、重量或件數等求解器欄位。
- 修正 `order_id` 擷取穩定性：strict schema／audit 明確區分「新單欄位中的訂單識別碼」與「單獨參照既有單」，且 audit 不再以空值覆蓋第一段 strict pass 已擷取的訂單編號。未使用 regex、關鍵字路由或 deterministic 自然語言抽取。
- 新增 `tests/test_urgent_insertion_workflow.py` 回歸：座標使地點名稱成為可推導顯示欄位並驗證產生 `信義配送點`；audit 缺口時保留 `ORD-101`。該檔與 `tests/test_urgent_batch_api.py` 急單回歸共 `37 passed`。
- 新增 `frontend/tests/e2e/scenario-evals-w3.spec.ts` 的 BUG-8 測試；不修改 `docs/demo-script.md`，以其中兩句原文逐字 `pressSequentially` 鍵盤輸入，五個全新 session 各匯入 `demo-50-relaxed.xlsx`，五次均進 `REVIEW_READY`、訂單編號均為 `ORD-101`。Chromium／1440×900 實測 `2 passed`（原 W3＋BUG-8，共約 2.2 分鐘），BUG-8 實際成功率 `5/5`；證據為 `docs/screenshots/BUG-8-1.png`～`BUG-8-5.png`。
- 小幅修正 `frontend/src/components/ChatPanel.tsx`：方案卡的預估送達改顯示臺北時區 `HH:MM`，並移除同一張卡敘述中的重複 ISO ETA；原方案卡結構不變。
- 驗證：`python scripts/run_intent_routing_evals.py` 實際輸出 `48/48 通過，0 個測項未全數通過`，三份資料各案兩次；前端 `tsc --noEmit`、ESLint、Vitest `1 file / 2 tests passed`、production Vite build `41 modules transformed`；ruff `All checks passed!`；mypy `Success: no issues found in 36 source files`；完整 pytest 以專案 `.tmp` 暫存目錄執行 `172 passed, 28 skipped, 4 warnings`。
- 中途實際失敗與處理：第一次瀏覽器啟動在第一句收到逐字 `{"error":{"code":"AGENT_PROVIDER_UNAVAILABLE","message":"AI 服務目前無法連線，請稍後重試。","field_errors":[],"request_id":"REQ-636617ca6cc3","details":{"provider":"OPENAI","exception_type":"APIConnectionError","fallback_used":false,"retryable":true}},"request_id":"REQ-636617ca6cc3"}`，重啟無 `--reload` 的提升權限後端後重跑通過；W3 舊測試曾因持久狀態殘留一條啟用中的 `VEH-003 單件重量 ≤ 20 kg` 規則只剩 1 張卡，已停用該精確殘留規則（active_count `0`）後完整 W3 重跑通過。Demo 原文檔無 diff。

### 2026-09-12 — 嚴格語意路由與 K／W／TODO 5／TODO 6 最終回歸

- 拆除搶答式 plan-change 路由：移除 `PlanChangeAction`、`plan_change_*` 欄位／提示詞、forced tool 對照與繞過主 Agent 的直接呼叫；前置理解只保留急單判斷與跨輪次草稿狀態。新增的 lifecycle capability boundary 只限制已發車後不可使用規則試算／正式方案總覽，沒有替主 Agent 代選工具。
- 改寫 `src/agent/runtime.py` 工具描述與 Agent 邊界：五種司機／車輛限制、整車不能出勤、明確取消、提前配送、查詢分配、方案總覽／偏差回顧、指定人名偏好與空間查詢均互斥；新增 `lowest_load_vehicle`，以確定性剩餘容量 evidence 回答最空車輛。
- 驗證器修正：有訂單但 `assigned_order_count == 0` 時追加 `no_orders_assigned`，回傳 INFEASIBLE／明確排不出來，不再 `valid: true` 或要求人工確認。保留不可行方案的 `UNASSIGNABLE` 卡；空批次訊息不再輸出「：」。方案卡將 ETA 與距離、時間、換車、改序並列。
- TEST-1：刪除未真正送出 `user_message` 的 `tests/test_agent_dialogue_corpus.py`，未修改 K／Demo 輸入句，也未修改 tight fixture 或 BUG-7 的 15 公斤資料。
- 本輪實際回歸：K 腳本三份資料（relaxed／tight／40 單）每案兩次，`48/48 通過，0 個測項未全數通過`，exit 0；急單人名偏好排除補強後再次執行仍為 `48/48`。所有回應均為 `runner_result_type=RunResult` 且 `usage.total_tokens` 非零。完整 pytest `170 passed, 28 skipped, 3 warnings`；mypy `Success: no issues found in 36 source files`；ruff `All checks passed!`。
- 瀏覽器最終回歸使用 Chromium、1440×900、單 worker、無刷新連續流程：TODO 5 `1 passed`（約 2.5 分鐘）；W-01～W-52 `1 passed`，總計 `113.630 秒`，W0～W8 分別 `0.333／15.933／16.106／38.860／2.690／23.341／7.755／8.293／0.319` 秒；TODO 6 `4 passed`（約 1.7 分鐘）。W 護欄 Console、正式 `/dispatch`、googleapis 均為 0，逐步 PNG 截圖已更新至 `docs/screenshots/W-01.png`～`W-52.png`，TODO 5／6 對應截圖亦已更新。
- 曾發現並修正的實際失敗：W-41 誤選 `preview_dispatch_rule`，回覆逐字「請先選擇要限制的車輛，再選擇禁止型規則。」；W-44 曾誤選 `inspect_plan_overview`，回覆逐字「已完成確定性工具計算；未驗證的數字或訂單資訊已省略，請展開查看計算依據。」；TODO 6 F2-07 曾誤進急單流程，回覆逐字「目前還不能計算。第 1 張急單 缺少：訂單編號、地點名稱、城市、行政區、緯度、經度、配送區域、每件重量、包裹件數、配送時段。請一次補齊後再繼續。」；均已修正邊界並從完整區塊重跑通過。
- 前端最終驗證：直接 workspace binary `tsc --noEmit`、ESLint 通過；Vitest `1 file / 2 tests passed`；production Vite build `41 modules transformed`，輸出 CSS `42.94 kB`、JS `347.44 kB`。重排通知同時保留「已重新排班」與「已用新參數重新排班」兩個必要可讀片語。
- 驗收後已將持久化測試狀態清理：`dispatch-parameters.service_minutes_by_zone={}`、已套用規則數 `0`；後端目前以無 `--reload` 方式運行。

### 2026-09-12 — NEW-1／NEW-2／I-02 回歸

- NEW-1：急單欄位擷取增加獨立 strict provenance audit；`location_label` 內的「信義」不再冒充 `district`。缺欄清單與 preview 共用 `URGENT_PREVIEW_REQUIRED_FIELDS`，並新增 A-07 直接斷言。實際鍵盤輸入 `ORD-101，信義示範配送點 Z4-51，臺北市，25.033，121.565，Z4，1 件` 的回覆為：`目前還不能計算。ORD-101 缺少：行政區、配送時段。請一次補齊後再繼續。`；補上行政區後進入摘要。
- NEW-2：preview 回 422 時保留 `REVIEW_READY`、草稿與 pending order context；後續直接補欄可繼續。`tests/test_urgent_batch_api.py::test_preview_validation_keeps_urgent_context_for_followup` 通過，瀏覽器 `urgent-regressions.spec.ts` 通過。
- 欄位穩定性：新增 `scenario-evals-a-b-i.spec.ts` 的 A-08，五個全新 session 使用同一句補齊訊息，實際成功率 `5/5`。
- A 區塊：完整鍵盤瀏覽器測試 `1 passed`；B 區塊 `1 passed`，確認至少兩張卡、局部插入、非負代價、換車不超過 3 張、Validator 通過、無完全支配候選、Enter 可選取；I 區塊 `1 passed`，確認 tight 的 49/50、排不進去卡，以及距離代價差異至少 3 km 且非被支配。
- I-02／BUG-2：方案卡產生只保留非支配候選；修正批次 route reorder 取錯急單的 bug，示範三張急單重新涵蓋同一組卡。示範急單 `URG-DEMO-041` 前端座標同步改為 `25.033664, 121.448133`，不再與既有站點重疊。
- W3：`scenario-evals-w3.spec.ts` 以鍵盤實際輸入完成 W-21～W-29，確認兩則訊息進摘要、方案修改、拒絕全域重排、取消與確認；`1 passed`。
- 本輪實際檢查：`.venv\\Scripts\\ruff.exe check src tests`、`.venv\\Scripts\\mypy.exe src`、完整 pytest `283 passed, 28 skipped`；前端 tsc、eslint、Vitest `2 passed`、production build 全部通過。
- 本輪中途失敗已修正：A-05 曾實際回覆 `目前還不能計算。第 1 張急單 缺少：訂單編號、地點名稱、城市、緯度、經度、配送區域、每件重量、包裹件數、配送時段。請一次補齊後再繼續。`，原因是模型未穩定擷取「信義區」；加入 strict 精確案例與資料集的確定性區域推導後，A 全段重跑通過。沙盒內曾回 `AGENT_PROVIDER_UNAVAILABLE / APIConnectionError`，改用已授權外部網路後自然語言瀏覽器驗收正常。
- 證據檔案：`frontend/tests/e2e/scenario-evals-a-b-i.spec.ts`、`frontend/tests/e2e/scenario-evals-w3.spec.ts`、`docs/screenshots/A-01.png`、`A-02.png`、`A-03.png`、`A-05.png`、`A-08.png`、`B-01.png`、`I-01.png`、`I-02.png`、`I-03.png`、`W-21.png`、`W-22.png`、`W-24.png`、`W-26.png`、`W-27.png`、`W-28.png`、`W-29.png`。

### 2026-09-12

- Q-01～Q-10 臨場應變補測完成：新增 `frontend/tests/e2e/demo-qa-playbook.spec.ts`，以 Chromium、1440×900、單 worker 執行；Q-01～Q-10 最終 `10 passed`，總執行時間 `2.1 分鐘`。所有輸入皆用鍵盤 `pressSequentially` 後按 Enter；Q-01～Q-09 使用各自 session，Q-09 四步共用同一 session 且 `navigationCount=0`。
  - Q-01 實際輸入：`三號車今天不能出車`。系統實際回覆逐字：`已完成確定性工具計算。` 通過；evidence 為 `change_vehicle_availability`、`VEH-003`、PREVIEWED。
  - Q-02 實際輸入：`ORD-019 今天不用送了`。系統實際回覆逐字：`已重新求解移除訂單方案，對話中的新方案卡尚未套用。` 通過；evidence 為 `remove_order_preview`、`ORD-019`、PREVIEWED。
  - Q-03 實際輸入：`請一次新增十張急單：訂單編號 Q03-001，配送區域 Z4，城市臺北市，行政區信義，地點標示信義示範站 Q03-001，緯度 25.033，經度 121.565，包裹件數 1，每件重量 1 公斤，早上配送；訂單編號 Q03-002，配送區域 Z4，城市臺北市，行政區信義，地點標示信義示範站 Q03-002，緯度 25.033，經度 121.565，包裹件數 1，每件重量 1 公斤，早上配送；訂單編號 Q03-003，配送區域 Z4，城市臺北市，行政區信義，地點標示信義示範站 Q03-003，緯度 25.033，經度 121.565，包裹件數 1，每件重量 1 公斤，早上配送；訂單編號 Q03-004，配送區域 Z4，城市臺北市，行政區信義，地點標示信義示範站 Q03-004，緯度 25.033，經度 121.565，包裹件數 1，每件重量 1 公斤，早上配送；訂單編號 Q03-005，配送區域 Z4，城市臺北市，行政區信義，地點標示信義示範站 Q03-005，緯度 25.033，經度 121.565，包裹件數 1，每件重量 1 公斤，早上配送；訂單編號 Q03-006，配送區域 Z4，城市臺北市，行政區信義，地點標示信義示範站 Q03-006，緯度 25.033，經度 121.565，包裹件數 1，每件重量 1 公斤，早上配送；訂單編號 Q03-007，配送區域 Z4，城市臺北市，行政區信義，地點標示信義示範站 Q03-007，緯度 25.033，經度 121.565，包裹件數 1，每件重量 1 公斤，早上配送；訂單編號 Q03-008，配送區域 Z4，城市臺北市，行政區信義，地點標示信義示範站 Q03-008，緯度 25.033，經度 121.565，包裹件數 1，每件重量 1 公斤，早上配送；訂單編號 Q03-009，配送區域 Z4，城市臺北市，行政區信義，地點標示信義示範站 Q03-009，緯度 25.033，經度 121.565，包裹件數 1，每件重量 1 公斤，早上配送；訂單編號 Q03-010，配送區域 Z4，城市臺北市，行政區信義，地點標示信義示範站 Q03-010，緯度 25.033，經度 121.565，包裹件數 1，每件重量 1 公斤，早上配送。` 系統摘要逐字：`我理解的臨時訂單如下：Q03-001：信義示範站 Q03-001、Z4、1 件、每件 1 公斤、MORNING、高優先；Q03-002：信義示範站 Q03-002、Z4、1 件、每件 1 公斤、MORNING、高優先；Q03-003：信義示範站 Q03-003、Z4、1 件、每件 1 公斤、MORNING、高優先；Q03-004：信義示範站 Q03-004、Z4、1 件、每件 1 公斤、MORNING、高優先；Q03-005：信義示範站 Q03-005、Z4、1 件、每件 1 公斤、MORNING、高優先；Q03-006：信義示範站 Q03-006、Z4、1 件、每件 1 公斤、MORNING、高優先；Q03-007：信義示範站 Q03-007、Z4、1 件、每件 1 公斤、MORNING、高優先；Q03-008：信義示範站 Q03-008、Z4、1 件、每件 1 公斤、MORNING、高優先；Q03-009：信義示範站 Q03-009、Z4、1 件、每件 1 公斤、MORNING、高優先；Q03-010：信義示範站 Q03-010、Z4、1 件、每件 1 公斤、MORNING、高優先。請選擇產生插單預覽、修改或取消。`；按預覽逐字：`已完成 10 張臨時訂單的同批預覽：Q03-001 安排至 VEH-003 第 4 站；Q03-002 安排至 VEH-003 第 5 站；Q03-003 安排至 VEH-003 第 6 站；Q03-004 安排至 VEH-003 第 7 站；Q03-005 安排至 VEH-003 第 8 站；Q03-006 安排至 VEH-003 第 9 站；Q03-007 安排至 VEH-003 第 10 站；Q03-008 安排至 VEH-003 第 11 站；Q03-009 安排至 VEH-003 第 12 站；Q03-010 安排至 VEH-003 第 13 站。目前有 2 張可行方案卡，既有訂單換車 0 張，距離變化 +10 公尺，時間變化 +2 秒。請在對話中的方案卡選擇，這只是預覽，尚未套用。` 通過；10 張同批預覽實測 `36.4 秒`，無當機、無超時。
  - Q-04 實際輸入：`請新增兩張急單：訂單編號 Q04-001，配送區域 Z4，城市臺北市，行政區信義，地點標示同客戶信義站，緯度 25.033，經度 121.565，包裹件數 1，每件重量 1 公斤，早上配送；訂單編號 Q04-002，配送區域 Z4，城市臺北市，行政區信義，地點標示同客戶信義站，緯度 25.033，經度 121.565，包裹件數 1，每件重量 1 公斤，早上配送。`。系統摘要逐字：`我理解的臨時訂單如下：Q04-001：同客戶信義站、Z4、1 件、每件 1 公斤、MORNING、高優先；Q04-002：同客戶信義站、Z4、1 件、每件 1 公斤、MORNING、高優先。請選擇產生插單預覽、修改或取消。`；按預覽逐字：`已完成 2 張臨時訂單的同批預覽：Q04-001 安排至 VEH-003 第 4 站；Q04-002 安排至 VEH-003 第 5 站。目前有 3 張可行方案卡，既有訂單換車 0 張，距離變化 +10 公尺，時間變化 +2 秒。請在對話中的方案卡選擇，這只是預覽，尚未套用。` 通過。
  - Q-05 實際輸入：`這批貨我想重新安排一下`。系統實際回覆逐字：`這個我不能改；目前只支援方案卡列出的六種配送調整。` 通過；明確拒絕未支援範圍，無錯誤。
  - Q-06 實際輸入：`三號車今天不能出恰`。系統實際回覆逐字：`已完成確定性工具計算。` 通過；evidence 正確選到 `change_vehicle_availability`。
  - Q-07 實際輸入：`VEH-003 today cannot go out`。系統實際回覆逐字：`已完成確定性工具計算。` 通過；evidence 正確選到 `change_vehicle_availability`。
  - Q-08 實際輸入：`加一張急單`。系統實際回覆逐字：`目前還不能計算。第 1 張急單 缺少：訂單編號、地點名稱、城市、行政區、緯度、經度、配送區域、每件重量、包裹件數、配送時段。請一次補齊後再繼續。` 通過；明確列出缺欄且未出現預覽按鈕。
  - Q-09 四步實際輸入／回覆逐字：① `新增急單 Q09-001，配送區域 Z4，城市臺北市，行政區信義，地點標示信義連續測試站，緯度 25.033，經度 121.565，包裹件數 1，每件重量 2 公斤，早上配送，請先預覽。` → `我理解的臨時訂單如下：Q09-001：信義連續測試站、Z4、1 件、每件 2 公斤、MORNING、一般優先。請選擇產生插單預覽、修改或取消。`；按預覽 → `已完成 1 張臨時訂單的同批預覽：Q09-001 安排至 VEH-003 第 4 站。目前有 3 張可行方案卡，既有訂單換車 0 張，距離變化 +10 公尺，時間變化 +2 秒。請在對話中的方案卡選擇，這只是預覽，尚未套用。`。② `三號車單趟距離上限 30 公里` → `規則試算完成，請檢查影響後再按套用。`。③ `新增急單 Q09-002，配送區域 Z4，城市臺北市，行政區內湖，地點標示內湖連續測試站，緯度 25.083，經度 121.590，包裹件數 1，每件重量 2 公斤，早上配送，請先預覽。` → `我理解的臨時訂單如下：Q09-001：信義連續測試站、Z4、1 件、每件 2 公斤、MORNING、一般優先；Q09-002：內湖連續測試站、Z4、1 件、每件 2 公斤、MORNING、一般優先。請選擇產生插單預覽、修改或取消。`；按預覽（HTTP 422）→ `插單資料未通過驗證。`；補充 `行政區是信義` → `我理解的臨時訂單如下：Q09-001：信義連續測試站、Z4、1 件、每件 2 公斤、MORNING、一般優先；Q09-002：內湖連續測試站、Z4、1 件、每件 2 公斤、MORNING、一般優先。請選擇產生插單預覽、修改或取消。`。補正後結構化 evidence 的 `Q09-002.district` 實為 `信義`，未再誤判成車名。④ `ORD-019 改成下午送` → `已依新配送時段重新求解，對話中的新方案卡尚未套用。`。整段通過，無刷新、`navigationCount=0`，狀態未錯亂。
  - Q-10 實際輸入：上傳 `demo-50-relaxed.xlsx`。系統實際回覆逐字：`已完成 50／50 張訂單的排班，方案待人工確認。`；後端重啟後冷啟動匯入實測 `0.940 秒`，通過。
  - 證據截圖：`docs/screenshots/Q-01.png`～`Q-10.png`。Q 護欄重跑為 Console error `0`（Q-09 故意的 HTTP 422 另標為預期驗證錯誤）、正式 `/dispatch` requests `0`、googleapis requests `0`。檢查命令：`.\\.venv\\Scripts\\ruff.exe check src tests` → `All checks passed!`；`.\\.venv\\Scripts\\mypy.exe src` → `Success: no issues found in 36 source files`；`pnpm typecheck`、`pnpm lint`、`pnpm test`（`2 passed`）、`pnpm build` 均通過；完整 pytest 以工作區限定暫存目錄重跑為 `281 passed, 28 skipped, 3 warnings`。

- NEW-1 修正：急單缺欄清單改以「本次訊息明確提供的欄位」記錄 provenance，並與預覽驗證共用同一套必填欄位；`location_label` 內含行政區名稱不再誤算已提供 `district`。NEW-1 的實際重現輸入：`ORD-101，信義示範配送點 Z4-51，臺北市，25.033，121.565，Z4，1 件`；修正前實際回覆逐字為「我理解的臨時訂單如下：ORD-101…請選擇產生插單預覽」，按預覽後為「插單資料未通過驗證。 城市/行政區不屬於宣告的營運區域。」修正後瀏覽器會先列出「行政區」，不會顯示預覽按鈕，補上後才進摘要。`tests/test_urgent_insertion_workflow.py`、`tests/test_urgent_batch_api.py` 與 `frontend/tests/e2e/urgent-regressions.spec.ts` 覆蓋此路徑。
- NEW-2 修正：預覽驗證失敗時保留 urgent context、草稿與 REVIEW_READY 狀態。修正前後續輸入 `行政區是信義` 的實際錯誤回覆逐字為「找不到這台車，請從目前車輛清單選擇。」；修正後同一瀏覽器路徑在 422 預覽錯誤後可直接補欄並重新回到訂單摘要。急單回歸 Playwright `1 passed`（37.6 秒）。
- UX-1 驗證：ChatPanel 使用鍵盤輸入，Enter 送出訊息；W3 的 W-21／W-22 不再按示範按鈕，使用 `pressSequentially` 實際打字並按 Enter，W-23 仍為 2 則訊息到摘要。
- I-02 修正：`src/services/urgent_options.py` 在合法 ROUTE_REORDER 候選中優先選擇與最佳 INSERTION 相差至少 3,000 m 的候選；仍只計算本次插入增量、拒絕負距離、拒絕超過 3 張換車、移除 FULL_REPLAN。tight 的確定性 ORD-101 實際候選為 `+0.019 km / +3 秒` 與 `+3.216 km / +442 秒`，差 `3.197 km`，全為非負。根因判定為候選選擇問題：資料已有合法的 3 km 以上替代路線，原邏輯只選到便宜的 `+0.644 km` 路線，並非 tight 座標無法形成差異。
- W-05／W-47 回歸：W-05 原測試錯把成功條件硬編為 50/50；mapped workbook 實際 API／頁面通知為「已完成 46／50 張訂單的排班，方案待人工確認。」（50 張總數、4 張因服務時間參數衝突未排入），已改測規格要求的解析成功。W-47 第二次重跑發現前次 F6 留下的參數實際 API 狀態為 `{"service_minutes_by_zone":{"Z5":7}}`，清回 `{}` 後從 W-01 重跑通過。
- 完整 W 連續走查：主線 `demo-50-tight.xlsx`，Chromium、1440×900、單 worker、不重整不跳步，W-01～W-52 `1 passed`。總時間 `91.779 秒`；W0 `0.317`、W1 `17.312`、W2 `19.396`、W3 `25.251`、W4 `1.107`、W5 `15.677`、W6 `6.356`、W7 `6.050`、W8 `0.313` 秒。52 張 PNG 已寫入 `docs/screenshots/W-01.png`～`W-52.png`；W-21／W-22 是鍵盤自然語言路徑，W-30／W-31 示範按鈕路徑另有覆蓋。
- 示範按鈕與 tight 專用驗證：`todo2-todo4-browser-acceptance.spec.ts` `3 passed`（42.9 秒），包含 F3-01～F3-07、F4 全部、F5-01～F5-05，以及 tight「排不進去」卡與距離差異 >3 km；另有急單缺欄／預覽錯誤鍵盤回歸 `1 passed`。所有瀏覽器回歸均在 Console error `0`、正式 `/api/v1/plans/{id}/dispatch` requests `0`、googleapis requests `0` 下完成。
- W9 15 條命題逐條勾稽：

  | 命題 | 證據步驟 | 勾稽 |
  |---|---|---|
  | C1a | W-12 | ✅ |
  | C1b | W-06、W-21 | ✅ |
  | C2a | W-09 | ✅ |
  | C2b | W-13 | ✅ |
  | C3a | W-09、W-12 | ✅ |
  | C3b | W-12 | ✅ |
  | C4a | W-14、W-24、W-31 | ✅ |
  | C4b | W-24、W-33、W-41 | ✅ |
  | M1 | W-08 | ✅ |
  | M2 | W-09 | ✅ |
  | M3 | W-12 | ✅ |
  | M4 | W-13、W-24 | ✅ |
  | P1 | W-52 | ✅ |
  | P2 | W-13、W-11 | ✅ |
  | P3 | W-24、W-31、W-43 | ✅ |

- 靜態與後端回歸：`ruff` `All checks passed!`；`mypy` `Success: no issues found in 36 source files`；後端焦點回歸 `42 passed, 3 warnings in 57.63s`；前端 `pnpm tsc --noEmit`、`pnpm lint`、Vitest `1 file / 2 tests passed`、`pnpm build` 均通過。production build 為 Vite `41 modules`、CSS `42.88 kB`、JS `347.00 kB`。測試結束後 `data/runtime/dispatch-parameters.json` 已清回 `{}`。

### 2026-09-11

- 本輪 CSS 間距回歸完成：確認 `--dock-bottom: 30px`、`--dock-height: 112px`、`--dock-gap: 28px`，`.stage-chat` 使用三者相加的 `calc(...)`。
  以相同 bounding-box 方法量測，車輛進度線實際高度 `112.375px`，對話框底部到進度線頂部 `27.625px`，與預期 28px 差 `0.375px`，未超過 5px；送出／附加檔案按鈕完整可見。
  E-01～E-09 與 F1 全部瀏覽器驗收 Playwright `6 passed`；Console error 0、`/dispatch` requests 0、googleapis requests 0。`pnpm tsc --noEmit`、ESLint、Vitest `1 file / 2 tests passed`、production build 均通過。
  `docs/screenshots/layout-v2.png` 已重新截圖，實際尺寸 `1440×1547`，頁面高度 `1547px`。

- 本輪版面微調回歸完成：確認 `.stage-chat` 使用 `bottom: 150px`、`.stage-dock` 使用 `bottom: 30px`，並確認 ChatPanel 空狀態已移除 `Control tower`，保留 plan／非 plan 分流與底部操作按鈕。
  新增新版 layout 驗收斷言：對話卡至車輛進度線實測間距 `7.625 px` 且為正值；Leaflet attribution 中心點在最上層、文字完整可見，未被進度線蓋住。E-01～E-09 與 F1 全部瀏覽器驗收使用 50 單 fixture，Playwright `6 passed`；Console error 0、`/dispatch` requests 0、googleapis requests 0，1440×900 與 1280 寬無水平溢位。
  `pnpm tsc --noEmit`、ESLint、Vitest `1 file / 2 tests passed`、production build 均通過。重新截圖 `docs/screenshots/layout-v2.png`，實際尺寸 `1440×1547`，頁面高度 `1547 px`，符合 2000 px 內目標；畫面保留四條車輛進度線，對話底部按鈕完整可見，沒有 `Control tower`。

- MapView／SectionTitle 版面回歸完成：
  驗證 `SectionTitle` 保留 eyebrow 型別但不渲染；`MapView` 使用 `.map-shell` 填滿舞台，站點數、示意路線、四車篩選與浮動 OSM attribution 均存在；Leaflet 自帶 attribution 也保留。對話維持 `top: 28px`，四條車輛進度線與底部按鈕完整可見。另移除司機規則卡殘留的裝飾性 `Dispatch rules` 英文小標，畫面不再有全大寫英文小標。
  因地圖標題列移除，Playwright 相關定位改找 `aria-label="配送地圖"`；E-07 分別驗證 `.map-overlay-attrib` 與 `.leaflet-control-attribution`，沒有刪除任一 attribution。E-01～E-09、F1-01～F1-15 全部通過：新版驗收 `4 passed`、F1-02～F1-10 `2 passed`；Console error 0、`/dispatch` requests 0、googleapis requests 0。
  1440×900 截圖：`docs/screenshots/layout-v2.png`，實際尺寸 `1440×1547`，頁面高度 `1547 px`；`pnpm tsc --noEmit`、ESLint、Vitest `2 passed`、production build 均通過。

- ChatPanel 與新版 CSS 回歸完成：
  保留 `.stage-chat` 的 `top: 104px`、`min-height: 0` 與 ChatPanel 原本的 `min-h-[620px]`，由外層 CSS 覆蓋高度；只修改 `ChatPanel.tsx` 的空狀態分流。有 plan 時顯示「方案已建立，有什麼要調整的？」與對應說明，不再顯示「先放入今天的訂單」或「選擇 Excel 檔案」；無 plan 的匯入引導維持原樣。
  Playwright 實跑 E-01～E-09、F1-01～F1-15 全部通過：新版驗收 `4 passed`、F1-02～F1-10 `2 passed`；Console error 0、`/dispatch` requests 0、googleapis requests 0。1440×900 與 1280 寬無水平溢位，送出／附加檔案按鈕完整可見，地圖標題與站點摘要未與對話卡重疊。
  `layout-v2.png` 已重新截圖，實際尺寸 `1440×1547`，頁面高度 `1547 px`。`pnpm tsc --noEmit`、ESLint、Vitest `2 passed`、production build 均通過。

- 新版版面驗收完成：
  保留地圖滿版舞台、左側浮動對話、底部四台車進度線，以及 `max-height: 72vh` 明細抽屜；未修改 ChatPanel、MapView、VehicleBoard、OrderTable、TimelineBoard、DeviationBoard、ui.tsx 內部結構。
  新增 `frontend/tests/e2e/layout-v2-e-f1-acceptance.spec.ts`，以 `demo-50-relaxed.xlsx` 作為標準 F1 資料，並以 `demo-50-tight.xlsx` 驗收 ORD-041 載重改派理由；E-01～E-09、F1-01、F1-11～F1-15 共 `4 passed`，既有 F1-02～F1-10 `2 passed`。Console error 0、`/dispatch` requests 0、googleapis requests 0；OSM 圖磚實際載入，1440×900 與 1280 寬均無水平溢位。
  1440×900 完整頁面截圖：`docs/screenshots/layout-v2.png`；實際頁面高度 `1547 px`（截圖尺寸 1440×1547，符合 2000 px 內目標）。
  `pnpm tsc --noEmit`、ESLint、Vitest `2 passed`、production build 均通過；production bundle 為 41 modules、CSS 42.19 kB、JS 347.06 kB。Playwright locator 只針對新版資料列與 exact 文案修正，沒有改版面遷就舊定位。

- 最終 G／D 驗收完成：
  使用 Chromium、1440×900、單 worker 實跑 `frontend/tests/e2e/final-guardrails-repro.spec.ts`，
  G-01～G-07 與 D-01～D-05 共 `2 passed`（35.3 秒）。G-01／G-02 均拒絕繞過規則或人工確認，
  沒有正式 `/dispatch`；G-03 note 當成資料處理；G-04 載重由 `highest_load_vehicle` evidence
  顯示；G-05 明確回報 ORD-999 找不到；G-06 斷線與 G-07 503 均顯示白話錯誤，確定性重新排班仍可用。
  `consoleErrors=[]`、正式 `/dispatch` requests `0`、googleapis requests `0`。
  D-01 固定 seed 兩次結果的分車／順序／距離完全一致；D-02 重跑後一致；D-03 完整 F1→F6 路徑完成。
  實際計時：第一次匯入 `834 ms`、第二次匯入 `758 ms`、完整 Demo 路徑 `7823 ms`（約 7.823 秒）；
  後端於本輪瀏覽器驗收前重新啟動，第一次匯入作為冷啟動觀測值。護欄回歸 pytest `26 passed`；
  完整 pytest `274 passed, 28 skipped, 4 warnings`；strict PromptSafetyAssessment 使用 Agents SDK
  結構化輸出，未使用 regex 作語意判斷；ruff、mypy（36 source files）、frontend lint、TypeScript、
  Vitest `2 passed`、production build 均通過。
  截圖：`docs/screenshots/G-01.png`～`G-07.png`、`docs/screenshots/D-01.png`～`D-05.png`

- TODO 9 完成 — 地圖車輛動畫（F5 選配）：
  既有已發車時間軸的目前站點 marker 改為模擬車輛脈動 marker，tooltip 明示車輛與目前站點；沒有新增 GPS、即時 provider 或其他功能。修正瀏覽器驗收護欄只匹配正式 `/api/v1/plans/{id}/dispatch`，並以單 worker 重跑避免共享 demo 狀態互相干擾。
  ruff、mypy、前端 lint、TypeScript、Vitest `2 passed`、production build 通過；F3-01～F3-07、F4 全部、F5-01～F5-05 Playwright 1440×900 `3 passed`（30.8 秒），Console error 0、`/dispatch` requests 0、googleapis requests 0。
  截圖：`docs/screenshots/F3-01.png`～`F3-07.png`、`F4-01.png`～`F4-07.png`、`F5-01.png`～`F5-05.png`

- TODO 8 完成 — 配送偏差記錄與參數修正建議（F6）：
  時間軸滑桿在已發車階段以確定性進度統計車輛與區域偏差；對話「今天調度狀況如何」由 strict Agent tool 引用同一份統計證據，回報 VEH-003 慢 22 分鐘與 Z5 每站多 4 分鐘，並提出服務時間 3 → 7 分鐘建議。未按確認前參數保持不變；人工確認後才可用新參數重新排班，API 回傳實際套用狀態與未能容納的訂單，不掩飾結果。
  新增 `dispatch_deviations.py`、`dispatch_parameters.py`、偏差卡與參數 API；不建立司機回報模型，不引入 GPS／App／電子簽收。全專案 pytest `274 passed, 28 skipped, 4 warnings`；ruff、mypy、frontend lint、TypeScript、Vitest `2 passed`、production build 均通過。
  Playwright 1440×900 實跑 F6-01～F6-07 `1 passed`（11.1 秒）；Console error 0、`/dispatch` requests 0、googleapis requests 0。
  截圖：`docs/screenshots/F6-01.png`～`F6-07.png`

- TODO 7 完成 — 資料格式適應（F1）：
  通過 F1-02～F1-10，失敗 0 項。以表頭取樣與 Agents SDK strict structured mapping 建立低信心度／高信心度對映建議；對映表逐列顯示信心度，可人工改欄、確認後解析，並可用來源檔名或保存名稱自動套用。缺欄位、壞檔、空資料與重複訂單都在畫面一次回報白話錯誤；provider 逾時會保留 0% 對映草稿並要求人工確認。
  修正 `inspect-excel` provider fallback 分支，補上 `tests/test_column_mapping.py` 回歸；新增 `frontend/tests/e2e/todo7-format-adaptation.spec.ts`。
  全專案 pytest `272 passed, 28 skipped, 4 warnings`；ruff `All checks passed!`；mypy `Success: no issues found in 34 source files`；frontend lint、TypeScript、Vitest `2 passed`、production build 均通過。
  Playwright 1440×900 實跑完整 TODO7 `2 passed`（18.0 秒）；每個測試的 Console error 0、`/dispatch` requests 0、googleapis requests 0。
  截圖：`docs/screenshots/F1-02.png`～`F1-10.png`

### 2026-09-10

- TODO 6 完成 — 司機規則 `DispatchRule`（F2）：
  通過 F2-01～F2-10 與 R-05，失敗 0 項。新增五種禁止型規則的 strict Agent tool、缺欄反問、確定性試算、衝突原因與三個人工處理選項；規則保存原句與到期時間，停用後重新排班會套用目前有效規則。新增 JSON persistence、規則 API、對話內規則卡與已套用規則清單；未明講的比較數值不由模型猜測，司機姓名指派與速度偏好明確拒絕。
  全專案 pytest `271 passed, 28 skipped, 4 warnings`；ruff `All checks passed!`；mypy `Success: no issues found in 34 source files`；frontend lint、TypeScript、Vitest `2 passed`、production build 均通過。
  Playwright 1440×900 實跑完整 TODO6 `4 passed`（1.1 分鐘）；每個測試的 Console error 0、`/dispatch` requests 0、googleapis requests 0。
  截圖：`docs/screenshots/F2-01.png`～`F2-10.png`、`docs/screenshots/R-05.png`

- TODO 5 完成 — 對話修改方案卡（六項白名單）：
  通過 F3-08～F3-12、R-04、R-06、R-07；失敗 0 項。
  TODO 5 browser test 使用 `data/samples/demo-50-relaxed.xlsx`，驗證缺欄位一次反問、
  方案卡對話修改產生新 immutable card、全量重分配明確拒絕、取消不改版本、確認才建立新版本，
  以及 8 句插單／4 句提前送達／未知說法的 structured Agent 流程。修正 preview candidate
  session 綁定、plan context 邊界、卡片代號不推導車輛、既有方案全量重排拒絕規則；測試急單改為
  上午配送，讓「先送」在既有硬性時段規則下確實可行。
  pytest 相關回歸 `46 passed, 4 warnings`；ruff `All checks passed!`；mypy `Success: no issues found in 33 source files`；
  frontend lint、TypeScript、Vitest `2 passed`、production build 均通過。
  Playwright 1440×900 實跑 `1 passed`（56.9 秒）；Console error 0、`/dispatch` requests 0、
  googleapis requests 0。R-05 是 TODO 6 的 F2 專屬測項，本輪未宣稱通過。
  截圖：`docs/screenshots/F3-08.png`～`F3-12.png`、`R-04.png`、`R-06.png`、`R-07.png`

- Corrected browser-fixture revalidation（進入 TODO 5 前完成）：
  `frontend/tests/e2e/todo2-todo4-browser-acceptance.spec.ts` 與
  `todo5-plan-modifications.spec.ts` 預設改用 `data/samples/demo-50-relaxed.xlsx`；新增
  `demo-50-tight.xlsx` 驗證「排不進去」方案卡與可行卡距離代價差異大於 3 公里；移除七個 v1
  browser test 檔／目錄；前端範例下載改指向 `demo-50-relaxed.xlsx`。
  Playwright 1440×900 實跑完整 F3/F4/F5 區塊：3 passed（F3-01～F3-07、F4 全部、F5-01～F5-05）；
  tight 額外測試通過；Console error 0、`/dispatch` requests 0、googleapis requests 0。
  同時修正 demo preview 的 session candidate 綁定與 plan context 邊界，避免跨測試殘留急單狀態。
  截圖：`docs/screenshots/F3-01.png`～`F3-07.png`、`F4-01.png`～`F4-07.png`、
  `F5-01.png`～`F5-05.png`、`tight-unassignable.png`、`tight-cost-gap.png`

- TODO 4 完成 — 三階段 SolveScope、裝車邊界與已發車權限：
  通過 12/12 項（F4-01～F4-07、F5-01～F5-05），失敗 0 項。
  新增 `PRE_LOAD`／`LOADED`／`DISPATCHED` 三階段；`load` 只在人工確認後進入裝車，`simulate-departure` 只推進本地 Demo，正式 `/dispatch` 仍停用。`LOADED` 凍結車輛指派；`DISPATCHED` 只允許剩餘站點的確定性排序，已完成前綴不可拖曳或重排。時間軸由 ETA 與滑桿推導完成／目前／未到站，地圖同步顯示實線、虛線與目前站點。
  瀏覽器 1440×900 實跑：F4 只有 1 張可行方案卡；換車提示包含「卸貨重裝」實體限制；全部重排被拒絕；時段修改與剩餘訂單提前均可用；裝車後退回明確要求人工處理；F5 顯示 4 條車輛路線，滑桿改變進度、出現已完成站點，完成站點不可拖曳，並顯示已跑路段實線／未跑路段虛線。Console error 0、`/dispatch` requests 0、googleapis requests 0。
  pytest `265 passed, 28 skipped, 4 warnings`；契約快照與 endpoint 測試 `3 passed, 4 warnings`；ruff `All checks passed!`；mypy `Success: no issues found in 33 source files`；frontend lint、TypeScript、Vitest `2 passed`、production build 均通過。
  證據：`src/services/solve_scope.py`、`src/services/urgent_options.py`、`src/agent/runtime.py`、`src/api/main.py`、`frontend/src/components/TimelineBoard.tsx`、`frontend/src/components/MapView.tsx`、`frontend/src/App.tsx`、`tests/test_solve_scope.py`、`docs/api-contract.md`、`docs/openapi-snapshot.sha256`。
  截圖：`docs/screenshots/F4-01.png`～`F4-07.png`、`docs/screenshots/F5-01.png`～`F5-05.png`

- TODO 3 完成 — 前端重寫與 F1 格式適應：
  通過 24/24 項（E-01～E-09、F1-01～F1-15），失敗 0 項。
  重建 `frontend/` 的 React／Tailwind／shadcn-style primitives、Leaflet OSM 示意地圖、對話式欄位對映確認、車輛概況與訂單理由表；`api.ts`／`types.ts` 同步改為 v2 契約。新增 `inspect-excel` preflight、Agents SDK strict mapping schema、人工修正與來源對映保存；OpenAI mapping provider 不可用時只提供 0% 信心度位置草稿，仍要求人工確認。Google Routes 由 `GOOGLE_ROUTES_ENABLED=false` 強制停用，Demo 只用 SIMULATED Matrix 與 OSM。
  瀏覽器 1440×900 實跑：標準 50 單 50/50、4 車、OSM 地圖；欄位名稱不同檔案可顯示信心度表、人工改欄後確認、同來源自動套用；缺重量／時段／地址一次列出；壞檔、空檔、重複 ID 均有白話錯誤。Console error 0、`/dispatch` requests 0、googleapis requests 0；`/ready` 回傳 `google_routes: disabled`；水平溢位 false。
  pytest `263 passed, 28 skipped, 4 warnings`（以工作區 basetemp 實跑）；ruff `All checks passed!`；mypy `Success: no issues found in 32 source files`；frontend lint、TypeScript、Vitest `2 passed`、production build 均通過。
  證據：`frontend/src/App.tsx`、`frontend/src/components/ChatPanel.tsx`、`frontend/src/components/MapView.tsx`、`frontend/src/components/VehicleBoard.tsx`、`frontend/src/components/OrderTable.tsx`、`frontend/src/components/ui.tsx`、`frontend/src/api.ts`、`frontend/src/types.ts`、`src/agent/mapping.py`、`src/services/importer.py`、`src/api/main.py`、`src/config.py`、`tests/test_column_mapping.py`、`scripts/generate_mapping_fixtures.py`、`docs/api-contract.md`、`docs/openapi-snapshot.sha256`。
  截圖：`docs/screenshots/E-01.png`～`E-09.png`、`docs/screenshots/F1-01.png`～`F1-15.png`

- TODO 2 完成 — 動態方案卡與批次插單（修正後）：
  通過 F3-01～F3-07、F4-01～F4-07、F5-01～F5-05，失敗 0 項；這次重跑共 19/19 項。
  `src/services/urgent_options.py` 改為同一張急單的合法車輛／站位候選：最佳車輛最佳位置、次佳車輛最佳位置、上車前局部順序重排；移除所有 FULL_REPLAN 候選。代價只比較 immutable base plan 到本次插入的增量，距離／時間不得為負，既有訂單換車數上限為 3；批次仍整批出卡，排不進去只顯示不可選的 `UNASSIGNABLE` 說明卡。
  `LOADED`／`DISPATCHED` 只保留凍結指派下的最低成本合法插入；`URG-DEMO-041` 改用非重疊座標；React option ID 改為 deterministic 唯一值；前端卡片顯示局部改序數量。`docs/api-contract.md` 與 `docs/architecture.md` 已同步移除全域重排 fallback 描述；F3 jpg 已刪除，只保留 png。
  瀏覽器 1440×900 實跑：F3-01～F3-07 方案卡、選取與 Tab + Enter、三張整批與不可安排卡均通過；F4 上車後只出 1 張且無換車、全部重排明確拒絕、時段／順序調整可用；F5 時間軸、已送／目前／未送、實線／虛線與已完成站點鎖定均通過。Console error 0、dispatch requests 0、googleapis requests 0；`/ready` 顯示 `openai: ready`、`google_routes: disabled`。
  全套 pytest `267 passed, 28 skipped, 3 warnings`；ruff `All checks passed!`；mypy `Success: no issues found in 33 source files`；frontend lint、TypeScript、Vitest `2 passed`、production build 均通過；deterministic audit 完成。
  證據檔案：`src/services/urgent_options.py`、`src/api/main.py`、`src/agent/runtime.py`、`frontend/src/App.tsx`、`frontend/src/components/ChatPanel.tsx`、`frontend/src/types.ts`、`tests/test_urgent_batch_api.py`、`tests/test_solve_scope.py`、`scripts/run_randomized_insert_audit.py`、`docs/api-contract.md`、`docs/architecture.md`。
  截圖：`docs/screenshots/F3-01.png`～`F3-07.png`、`docs/screenshots/F4-01.png`～`F4-07.png`、`docs/screenshots/F5-01.png`～`F5-05.png`

- TODO 1 完成 — 瀏覽器驗收：
  通過 15/15 項（E-01～E-09、F1-01、F1-11～F1-15）
  失敗 0 項
  Console error 0、dispatch requests 0、googleapis requests 0
  證據：relaxed 範例 50/50 張完成，四台車載重率均在 60%～80%；tight 範例 49/50 張完成，僅 ORD-050 因載重不足未指派；ORD-041 顯示「原本會超過 VEH-002 車的 100 kg 上限，改派 VEH-003 車。」；早上／中午／晚上三值與 OSM 示意路線均可見；1440×900 與 1280×720 實測無水平溢位。pytest `255 passed, 28 skipped, 4 warnings`；ruff `All checks passed!`；mypy `Success: no issues found in 30 source files`；frontend Vitest `24 passed`；TypeScript `tsc --noEmit` 通過。
  截圖：`docs/screenshots/E-01.png`～`E-09.png`、`docs/screenshots/F1-01.png`、`docs/screenshots/F1-11.png`～`F1-15.png`

### 2026-09-09

- TODO 0 完成 — 瀏覽器驗收：
  通過 1/1 項（E-06）
  失敗 0 項
  Console error 0、dispatch requests 0、googleapis requests 0
  證據：後端 `/health` HTTP 200、`/ready` HTTP 200 且 `google_routes: disabled`；pytest `251 passed, 28 skipped, 4 warnings`；ruff `All checks passed!`；mypy `Success: no issues found in 30 source files`；1440×900 Playwright 實測 `googleapis_request_count: 0`、`dispatch_request_count: 0`、`console_error_count: 0`。
  截圖：`docs/screenshots/E-06.png`

- 完成現況落差盤點，九項期望對照原始碼查證 — 證據：`SPEC_CHANGE_DRAFT_v2.md` 第 2 節，含 `importer.py:91`、`main.py:1087,1151,1327,1633`、`models.py:34`、`planner.py:13-14,563-565`、`VehiclePanel.tsx:24,30` 等行號。
- 查出 `frontend/src` 對 `@mui`／`@emotion` 匯入為零，兩者為純死依賴 — 證據：Grep 全域搜尋無結果，但 `package.json` 有依賴。
- 查出 `planner.py:568` 丟棄代價為全部路程總和 +1，求解器永不主動丟單，且 `priority` 完全不影響 OR-Tools 取捨 — 證據：Grep `Disjunction|penalty|priority`。
- 建立 `SPEC_CHANGE_DRAFT_v2.md`，經一次全文重寫（revision 2）消除七項內部矛盾 — 證據：檔案 revision 欄位與第 0 節修正紀錄。
- 定案六項功能 F1–F6，取代初版錯誤的「Demo 橋段 B1–B7」骨架。
- 五項規格缺口全數結案：`LOADED` 由人工按鈕觸發（07:30）、多張急單整批出卡、F6 範圍單日、F6 形式為偏差記錄、`Priority` 保留欄位但求解器不讀。
- 查證台灣宅配業日常作息並寫入規格 — 證據：`SPEC_CHANGE_DRAFT_v2.md` 11.1，三個外部來源。
- 依使用者指正移除三項自行擴張的範圍：超重獨立橋段、時段軟性違規、運力預留卡片。
- 建立 harness 進度機制：`CLAUDE.md`（static context）、`.claude/skills/progress/SKILL.md`（dynamic）、本檔。
- 取得前端四項決定：淺色企業風、上半左右分割（對話｜地圖）＋方案卡橫跨底部、`frontend/` 全部重寫含 `api.ts`、舊文件直接刪除重寫 — 證據：`ACTIVE_SPEC.md` 第 8 節。
- 刪除五份 v1 文件並重寫 — 證據：`docs/project-status.md`、`spec-driven/SPEC_CHANGE_DRAFT_v2.md`、`.agent/skills/daily-dispatch.md`、`.agent/skills/urgent-order-insertion.md`、`.agent/skills/example-skill.md` 已移除；備份於 scratchpad `doc-backup-20260909`。
- 重寫 `spec-driven/ACTIVE_SPEC.md` 為 v2 單一規格（吸收原草案內容，13 節）。
- 重寫 `README.md`、`AGENTS.md`。
- 建立三個 v2 產品 skill：`daily-dispatch.md`（F1／F2）、`urgent-insertion.md`（F3／F4）、`en-route-adjustment.md`（F5／F6）。
