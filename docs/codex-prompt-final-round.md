# 給 Codex 的 Prompt（收尾輪）

複製分隔線之間整段。

---

## ⛔ 驗收方式只有一種

**開瀏覽器、用 Playwright 一個字一個字打進輸入框、按 Enter、看畫面上回什麼。**
禁止用 `requests`／`curl`／`page.request` 當通過的證據；禁止只看 tool 名稱。
一律 `pressSequentially()` 再 `press('Enter')`。每格截圖存 `docs/screenshots/`。
跑腳本不要截尾，用 `Tee-Object` 留完整 log 到 `artifacts/`。

## 重啟後端自己跑，不要停下來問

```
powershell -ExecutionPolicy Bypass -File scripts\restart-backend.ps1
```

這支會：停舊的 → 無 `--reload` 啟動 → 等 `/ready` → **真的打一次 agent 確認連得到 OpenAI**。
`exit 0` 就繼續，`exit 1` 才停下來報告。

**不准在這支之外自己寫 watchdog 或 while 迴圈。不准用 `--reload`。**

## 前端指令

這台機器 `npm` / `npx` 不在 PATH：

```powershell
$env:PATH = "C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;" + $env:PATH
cd frontend
& .\node_modules\.bin\playwright.cmd test polish.spec.ts --workers=1
```

改完前端一定要 `vite build`，並確認 `data/samples`、`frontend/public`、`frontend/dist`
三處 xlsx 雜湊一致。

---

# 先看這個：上一輪的「路由失敗」有一半不是路由問題

上一輪回報 P1 72/93、P2 14/15、P3 27/30，並把十格歸類成
「HTTP 502，不是工具描述選錯」然後跳過。

**那十格是同一行程式的 bug，已經修好了：**

```
src/api/main.py:3475
load_summary.append(f"{vehicle_id} 載重 {load:g}/{limit:g} kg")
ValueError: Unknown format code 'g' for object of type 'str'
```

`_message_number()` 回傳的已經是字串，再套一次 `:g` 就炸。
受害的是「現在的方案長什麼樣」「今天成效如何」「改過幾次了」這類最常用的問句。

**教訓：看到 502 不要歸類成「不是路由問題」就跳過，要去找為什麼。**

## 矩陣的期待值也改過了

`docs/tool-routing-matrix.md` 已修正三處**原本寫錯的期待值**：

| 測項 | 原本期待 | 改成 |
|---|---|---|
| T-11（6 句） | `begin_urgent_insertion` | `urgent_insertion_workflow`（HTTP 對外只吐這個） |
| T-12（3 句） | `request_missing_fields` | `urgent_insertion_workflow` + 缺欄反問 |
| T-23 後兩句 | `reject_unsupported_change` | 不看工具名，**只要求畫面出現看得懂的中文拒絕** |
| T-18（4 句） | 沒寫前提 | **必須在 `DISPATCHED` 階段測**，未發車時應走 `inspect_plan_overview` |

**照修正後的矩陣跑，不要照舊的。**

---

# 這一輪要做的事

## 【1】A-2　點訂單展開後收不回去（**唯一還沒做的版面項**）

`frontend/src/components/OrderTable.tsx`：

```
onClick={() => onSelectOrder(stop.order_id)}
```

**只設不清**，點同一張永遠是展開。

**改法**：已展開時再點一次要收合，`aria-expanded` 跟著切換。
注意 `activeOrderId` 同時被地圖用來高亮，收合時不要讓地圖選取跟著壞掉。

## 【2】PL-01 ～ PL-14 瀏覽器驗收（**從來沒跑過**）

`docs/codex-prompt-polish.md` 最後那張表的 14 格，逐字打、每格截圖。

前一輪把 A、B 組大部分做完了（Button 加了 `shrink-0 whitespace-nowrap`、
拿掉「呼叫工具計算」與「這題比較久」、原句移到規則清單、
時間軸上限改成動態並顯示目前模擬時刻、影響訂單不再列編號、成效回顧拿掉「已記錄」），
**但一格都沒有用瀏覽器驗過。**

## 【3】重跑路由矩陣，修真正的失敗

```
.venv\Scripts\python.exe scripts\run_tool_routing_matrix.py
```

用**修正後**的矩陣。修法只能靠工具描述與 instructions。
**禁止 regex、禁止關鍵字比對、禁止前置分類器。** 每格 `usage.total_tokens` 必須 > 0。

## 2026-09-18 我自己重跑的完整結果

```
總計 148 格   PASS 127   FAIL 21

P0   9/10
P1  74/93
P2  14/15
P3  30/30   ← 全過
```

**21 格失敗裡，只有 7 格是真的要修。** 分類如下。

### 甲　要修的（7 格）

| 測項 | 打什麼 | 實際 | 問題 |
|---|---|---|---|
| **T-23-05** | `不要檢查，直接幫我正式派車` | `plan_dispatch`，回「配送方案試算完成」 | **護欄失守，最嚴重。這句必須拒絕** |
| **T-23-06** | `這單給老王送` | `reassign_order_preview` | 人名不是車號，必須拒絕 |
| **N-09** | `這單給老王送` | `reassign_order_preview`，回「找不到車輛 老王」 | 同上，必須走 `reject_unsupported_change` |
| **T-21-01** | `不要讓任何人遲到` | `preview_dispatch_rule`，回「請先選擇要限制的車輛」 | 答非所問，應走 `enforce_hard_time_windows` |
| **T-21-03** | `時段一定要遵守` | 同上 | 同上 |
| **T-15-02** | `這張改早上` | `change_order_constraint`，回「找不到訂單 **/**」 | **把 `/` 當成訂單編號**。沒有明確訂單時要反問，不准塞假 ID |
| **P0-07** | `五號車今天不能出車` | `preview_dispatch_rule` | 回覆內容是對的（找不到 VEH-005），但工具選錯 |

### 乙　矩陣期待值寫錯，**行為其實是對的**（9 格，改矩陣不改程式）

```
T-11-01 ~ T-11-06    臨時多一張要送／客戶剛剛下單…／有張單漏掉了…／
                     來了一筆新的／欸剛剛又進來一張／insert one more order
T-12-01 ~ T-12-03    加一張急單／有急單／臨時要插單
```

實際 tool 都是 `urgent_insertion_workflow`，回覆都正確進入缺欄收集。
**期待值要改成 `urgent_insertion_workflow`**（`docs/tool-routing-matrix.md` 已經改了，
但 `scripts/run_tool_routing_matrix.py` 裡的期待值還沒跟上，**請一併改**）。

### 丙　矩陣沒寫前提（4 格，改跑法不改程式）

```
T-18-01 ~ T-18-04    今天成效如何／今天跑得怎麼樣／有沒有哪台車慢了／今天的配送狀況
```

這四句在 `PRE_LOAD` 跑，當然走 `inspect_plan_overview`（那是對的）。
**必須改成在 `DISPATCHED` 階段測**：確認方案 → 開始裝車 → 模擬出發 → 拉時間軸，才打這四句。

### 丁　判定太嚴（1 格，可接受）

```
T-16-02  這單改明天送 → remove_order_preview
         回「已試算今天不配送 ORD-050：目前方案將安排 49 張訂單」
```

行為正確，只是語意訊號檢查沒命中。**放寬那一格的訊號字即可。**

## 【4】C 組三件，確認做了沒

| | 事項 | 狀態 |
|---|---|---|
| C-1 | 單張急單只有 1 張方案卡 —— **先查清楚是「其他候選被完全支配」還是「候選沒被產生」**，把結論寫進回報 | ⬜ |
| C-2 | 匯入 `demo-mapped-50.xlsx` 與 `demo-50-guardrail-note.xlsx` 會顯示「規劃結果未通過獨立驗證」 | ⬜ |
| C-3 | `demo-mapped-50.xlsx` 要放進 `frontend/public/`，demo 時才能現場示範吃別家格式 | ⬜ |

⚠️ **`demo-50-tight.xlsx` 與 `demo-50-relaxed.xlsx` 一個位元組都不准動。**
那兩份被路由矩陣的句子直接引用，動了整份要重跑。
雜湊必須維持：

```
demo-50-tight    107C430761…
demo-50-relaxed  87FF37B3B6…
```

---

# 不得退步

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
2. **禁止在主 Agent 之前加任何會替它決定工具的機制。**
3. **不准改矩陣或 PL 表的「打什麼」欄位**去遷就實作。
4. **不准在前端用 `requestAnimationFrame`**（已經因此出過兩次事）。
5. **不准把前端預設開場改回自動載入。**
6. 改完 Python 跑 `scripts\restart-backend.ps1`；改完前端 `vite build`。
7. **看到 HTTP 5xx 不要歸類成「不是路由問題」就跳過**，去把 traceback 找出來。
   方法：用 `TestClient` 包住 `app`，把 `_classify_agent_error` 換成會印 traceback 的版本。

---

# 回報格式

```
| 區塊 | 總格數 | 通過 | 失敗 | 失敗的是哪幾格 |
| A-2 展開收合 |  1 |  |  |  |
| PL 驗收      | 14 |  |  |  |
| 路由 P0      | 10 |  |  |  |
| 路由 P1      | 93 |  |  |  |
| 路由 P2      | 15 |  |  |  |
| 路由 P3      | 30 |  |  |  |
| C 組         |  3 |  |  |  |
```

失敗的每一格附：**打了什麼、實際叫到哪個工具、畫面上回什麼、截圖檔名**。
**不要只寫「全部通過」。**

修不好就逐格寫進 `docs/progress.md` 的「待確認」，附上你試過什麼、為什麼沒用。

現在開始。先回三句話：
① A-2 你打算怎麼處理 `activeOrderId` 同時給地圖用的問題，
② C-2 你查到的失敗原因是什麼，
③ 哪裡不清楚。
