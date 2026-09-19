# 給 Codex 的 Prompt（全工具路由精準度 · 過夜跑）

複製分隔線之間整段。

---

這一輪只做一件事：**證明每一句話都打到正確的工具，而且不會被別的句子誤叫。**

**這一輪不准碰版面、不准改文案、不准重產資料。** 那些留到下一輪。

## 基準文件

```
docs/tool-routing-matrix.md
```

那裡面有 P0～P3 四個區塊、每個工具的句子、以及通過門檻。**照那份做。**

## 服務

後端用這一行啟動（沒有 `--reload`），不要寫 watchdog、不要寫 while 迴圈：

```
.venv\Scripts\python.exe -m uvicorn src.api.main:app --host 127.0.0.1 --port 8000
```

---

# 為什麼要做這一輪

全專案有 **27 個工具**，但 `scripts/run_intent_routing_evals.py` 只測了 **8 格、涵蓋 5 個工具**。
**其餘 22 個從來沒有系統性驗過會不會被正確叫出來。**

使用者實際踩到的例子：

```
打：ORD-0XX 客戶說中午前一定要拿到
回：這個站點已完成或不在目前車輛路線的可調整區段，不能更動。
```

`ORD-0XX` 根本不存在。**路由選對了工具，但工具沒檢查前提，就回了一句不相干的話。**

**失敗有兩種，都要測：**

| | 症狀 | 怎麼測 |
|---|---|---|
| 叫錯工具 | 講 A 去做 B | P1 正向 + P2 負面 |
| 叫對工具但沒檢查前提 | 訂單不存在還硬跑 | P0 |

---

# 做事順序（**照這個順序，過夜跑**）

## 【階段 1】先建測試，不要改程式

新增 `scripts/run_tool_routing_matrix.py`，仿照
`scripts/run_intent_routing_evals.py` 的結構：

- 走**真實 HTTP** `/api/v1/agent/chat`
- plan 參數固定 `ORTOOLS / BALANCED / SIMULATED / SIMULATED`（與 `frontend/src/api.ts` 一致）
- 每格判定三條：
  1. `evidence[-1]["tool"]` == 期待的工具
  2. `usage.total_tokens > 0` 且 `runner_result_type != "NoneType"`
  3. 回覆字串符合該格的語意檢查（見矩陣文件）
- **輸出每一格的結果，不准截尾**，用 `Tee-Object` 留完整 log 到 `artifacts/`
- 失敗時印出：測項編號、打了什麼、實際叫到哪個工具、畫面回什麼
- exit 非零代表有失敗

**先跑一次，把「現況基線」整份貼出來。** 這一步不要改任何程式。

## 【階段 2】修 P0（前提檢查）

**規則**：任何吃 `order_id` / `vehicle_id` / `zone_code` 的工具，
第一件事是確認那個東西存在。不存在就回「找不到」，**不准往下跑**。

至少要涵蓋：
```
prioritize_order_preview   remove_order_preview      reassign_order_preview
change_order_constraint    explain_assignment        explain_unassigned
change_vehicle_availability  preview_dispatch_rule   vehicle_load
```

**回覆必須明確講「找不到」**，不准出現「已完成」「不在可調整區段」「無法更動」
這類把「不存在」當成「狀態問題」的說法。

**P0 必須 10/10 才能往下。**

## 【階段 3】修 P2（負面測試）

15 格，**必須全過，不准有例外**。

修法只能靠**工具描述與 instructions**。
**禁止 regex、禁止關鍵字比對、禁止在主 Agent 前面加任何前置分類器。**
（違反的話驗收會用沒出現過的說法打穿，見 `AGENTS.md`「嚴格禁止搶答式路由」。）

判斷有沒有作弊的方法：`usage.total_tokens` 必須 > 0。

## 【階段 4】修 P1（正向路由）

約 90 格，門檻 **≥ 95%**。

修不動的逐格寫進 `docs/progress.md` 的「待確認」，**附上你試過什麼、為什麼沒用**。

## 【階段 5】P3（脈絡穩定性）

抽 P1 的 10 句 × 3 種脈絡 = 30 格，**必須全過**。

同一句話在「乾淨」「插單預覽後」「規則預覽後」三種狀態下，
叫到的工具必須一致。

## 【階段 6】不得退步

```
scripts/run_intent_routing_evals.py       48/48
scripts/run_refusal_stability_evals.py    24/24
frontend/tests/e2e/demo-v3.spec.ts        全過
frontend/tests/e2e/fleet-resilience.spec.ts   4/4
pytest / ruff / mypy / eslint / tsc / vitest / build   全過
```

---

# 硬性規則

1. **禁止 regex／關鍵字比對判斷語意。**
2. **禁止在主 Agent 之前加任何會替它決定工具的機制**（前置分類器、強制工具表）。
3. **不准改 `docs/tool-routing-matrix.md` 的「打什麼」欄位**去遷就實作。
   改不動就寫進「待確認」。
4. **這一輪不准碰版面、不准改文案、不准重產資料。**
5. 改完 `src\**\*.py` 一定要重啟 uvicorn（沒有 `--reload`）。
6. **不要寫 watchdog、不要寫 while 迴圈自動重啟服務。**
7. 跑腳本不要截尾輸出，用 `Tee-Object` 留完整 log。

---

# 回報格式

**每個階段都要給這張表：**

```
| 區塊 | 總格數 | 通過 | 失敗 | 失敗的是哪幾格 |
| P0   |  10    |      |      |                |
| P1   |  ~90   |      |      |                |
| P2   |  15    |      |      |                |
| P3   |  30    |      |      |                |
```

**而且要給兩次**：階段 1 的「修之前基線」，以及最後的「修之後結果」。
我要看到進步了多少。

失敗的每一格附上：**打了什麼、實際叫到哪個工具、畫面上回什麼**。

**不要只寫「全部通過」。** 前五輪你每一輪都這樣寫，而我每一輪都抓到漏的。

---

# 如果時間不夠

**優先度是 P0 > P2 > P3 > P1。**

P0 是已知 bug、P2 是誤叫（最容易被評審踩到）、P3 是穩定性、
P1 格數最多但單一格失敗的傷害最小。

**做不完就停在做得完的地方，把剩下的寫進「待確認」，不要為了跑完而放寬判定。**

現在開始。先回三句話：
① 階段 1 的基線你預期哪幾個工具會掛，
② P0 的前提檢查你打算加在哪一層（工具內部還是共用 helper），
③ 哪裡不清楚。
