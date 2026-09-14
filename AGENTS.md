# 專案 Agent 指示

本檔為 Codex 的規則文件，每次執行必讀。

## 角色分工

| 角色 | 負責 |
|---|---|
| 人類 | 決定範圍、確認方案、給核准指令 |
| Claude | 寫規格、寫 prompt、驗收（含開瀏覽器實測每個功能） |
| **Codex** | **實作。讀本檔與 `.agent/skills/`，照 `docs/progress.md` 的 `NOW` 執行** |

## 每輪必讀（依序）

1. 本檔
2. `docs/progress.md` — NOW／TODO／DONE
3. `spec-driven/ACTIVE_SPEC.md` — 產品規格 v2
4. `.agent/guardrails.md` — 安全與核准政策
5. `.agent/skills/taiwan-plain-language/SKILL.md` — 回覆風格
6. 與本輪相關的其他 skill（見下方分流表）

## 唯一真實來源

| 內容 | 檔案 |
|---|---|
| 進度 NOW／TODO／DONE | `docs/progress.md` |
| 產品規格（六項功能） | `spec-driven/ACTIVE_SPEC.md` |
| 安全與核准政策 | `.agent/guardrails.md` |
| 產品工作流程 | `.agent/skills/` |

**不得建立第二套進度真實來源**（`TODO.md`、`NOW.md`、`DONE.md`、`CLAUDE.md` 皆禁止）。

## 每輪流程

1. 讀 `docs/progress.md`，確認 `NOW` 是什麼。
2. **只做 `NOW` 那一項。** 發現新工作放進 `TODO`，不要順手做掉。
3. 執行前確認是否會改變需求或架構。
4. 執行變更，跑測試與驗證。
5. **結束前依 `.agent/skills/progress.md` 更新 `docs/progress.md`。這一步不可略過。**
6. `NOW` 永遠只有一項；`DONE` 必須附實際證據。

## 產品範圍：六項功能

**只做這六項。非此六項一律不做。**

| # | 功能 |
|---|---|
| F1 | 上傳訂單 → 吃不同格式 → 缺欄反問 → OR-Tools 排班 |
| F2 | 講出司機限制 → 記入規則 → 以後排班自動套用 |
| F3 | 上車前插單 → 動態方案卡＋對話修改 → 調度員選擇 |
| F4 | 上車後插單 → 動態方案卡＋對話修改 → 調度員選擇 |
| F5 | 已發車，既有訂單須提前 → 重排該車剩餘站點 |
| F6 | 配送偏差記錄 → 回饋為排班參數修正 |

自行擴張範圍是本專案已發生過的問題（曾誤加超重獨立橋段、時段軟性違規、運力預留卡片、精確時間窗）。動手前先確認它屬於 F1–F6 哪一項；不屬於就不要做。

## 產品工作流程分流

| 情境 | Skill |
|---|---|
| 匯入、排班、建立司機規則（F1／F2） | `.agent/skills/daily-dispatch.md` |
| 上車前／上車後臨時插單（F3／F4） | `.agent/skills/urgent-insertion.md` |
| 發車後路線調整、偏差記錄（F5／F6） | `.agent/skills/en-route-adjustment.md` |
| 更新進度 | `.agent/skills/progress.md` |

## 問題分流

| 類型 | 處理方式 |
|---|---|
| Requirement Change | 提出規格修改草案，人工核准前不得修改程式 |
| Code Bug | 先建立可重現的失敗測試，再修正並跑迴歸 |
| Data Issue | 記錄受影響的欄位／訂單；**不得捏造缺漏資料** |
| External Provider Issue | 啟用 fallback 並記錄 provider error |
| Architecture Change | 提出影響分析並等待人工核准 |

## 永久規則

- 所有回覆遵守 `taiwan-plain-language` skill：臺灣繁體中文、先講結論、短句。
- 固定使用一個 application Agent，不得加入 handoffs、A2A 或 multi-Agent topology。
- LLM 只負責意圖理解、工具選擇、錯誤摘要與 evidence-grounded 解釋。
- **重量計算、資料驗證、車輛指派、路線排序、時段檢查、狀態轉換與所有數值主張，一律由確定性程式負責。**
- 絕不捏造訂單、重量、座標、距離、ETA、指派或理由；解釋必須引用結構化工具證據。
- 不得讀取或暴露真實 `.env` 值、secrets、客戶 PII 或完整 workbook payload。
- 未取得明確範圍核准，不得部署、push、執行破壞性檔案操作、production mutation 或付費。
- 取得 `APPROVE_V2` 前，`feature_code_allowed` 維持 `false`。
- 開發期間 Google Routes／Maps 一律停用，`route_provider_preference` 明確傳 `SIMULATED`。
- **不得宣稱未經實際執行的測試結果。** 回報失敗時附上實際輸出。

## 嚴格禁止 Regex

**全專案禁止使用正規表示式判斷意圖、抽取欄位或解析自然語言。** 包含 `re` 模組、JavaScript `RegExp`、字串 `match`／`search`／`findall`／`split` 用於語意判斷，以及任何等價的關鍵字比對。

理由：本產品的核心主張是「Agent 真的理解使用者在說什麼」。用 regex 比對關鍵字會讓系統在稍微換句話說時就失效，且無法對評審交代。

| 情境 | 正確做法 |
|---|---|
| 判斷使用者想插單還是排班 | Agents SDK strict structured output |
| 從「三號車老王腰傷」抽出車輛與限制 | strict tool 的 typed 欄位，缺漏就反問 |
| 解析「中午前」這種時間詞 | strict schema 的 enum 欄位，模型填值 |
| Excel 欄位名稱對映 | 模型提出對映建議，人工確認 |
| 驗證 email、數字格式等**純格式**檢查 | 允許，但必須是 Pydantic validator，不得自行寫 regex 判斷語意 |

例外僅限：檔案副檔名比對、路徑處理等與語意無關的字串操作。有疑慮時一律不用。

## 嚴格禁止「搶答式」路由

**禁止在主 Agent 之前放任何會替它決定工具的機制。** 不用 regex 改用小模型去預先分類，
一樣違規 —— 違規的不是 regex，是**繞過語意判斷**這件事。

具體禁止：

1. **禁止硬寫的工具對照表**
   ```python
   # 禁止這種東西
   if classification == "REMOVE_ORDER":
       forced_tool = remove_order_preview
   elif classification == "CHANGE_VEHICLE_AVAILABILITY":
       forced_tool = change_vehicle_availability
   ```
2. **禁止繞過主 Agent 直接呼叫工具。** 每一則使用者訊息都必須真的經過主 Agent 的
   語意判斷。檢查方式：回應的 `usage.total_tokens` 不得為 `0`
   （`0` 代表根本沒問過模型）。
3. **禁止用「意圖列舉」限制可能性。** 像
   `Literal["NONE", "REMOVE_ORDER", "CHANGE_VEHICLE_AVAILABILITY"]` 這種列舉，
   當使用者講的是列舉裡沒有的東西（例如司機規則），模型只能硬挑一個最接近的，
   一定答錯。**工具清單本身就是意圖清單，不需要第二份。**

**唯一允許的調整手段是「讓工具自己說清楚它是做什麼的」** —— 也就是 tool description
與 agent instructions。分不出兩個工具時，改描述，不要加判斷式。

反例（2026-09-12 實際發生，K 區塊 9/48）：
為了修「司機請假」「客戶取消」兩題，加了一個前置分類器 + 強制工具表，
結果司機規則、提前配送、訂單查詢共六類全部被搶走，
且主 Agent 完全沒有執行（`total_tokens: 0`）。詳見 `docs/scenario-evals.md` BUG-4／BUG-6。

**當某一題修不好時，正確反應是把工具描述寫清楚，不是再加一層攔截。**

### 唯一的例外：工具自己的「範圍欄位」（2026-09-13 新增，不要移除）

`PlanDispatchInput.plan_request_scope`（`src/agent/runtime.py`）看起來像列舉，但**不是**
上面禁止的那種，差別要講清楚：

| | 被禁止的前置分類器 | 允許的範圍欄位 |
|---|---|---|
| 發生時機 | 主 Agent **之前** | 主 Agent **已經選好工具之後** |
| 它決定什麼 | 要呼叫哪個工具 | 這次呼叫**自己的範圍**是什麼 |
| 主 Agent 有沒有跑 | 沒有（`total_tokens: 0`） | 有（`total_tokens > 0`） |
| 列舉沒涵蓋的說法 | 被迫硬挑一個 → 答錯 | 不影響，工具選擇完全不受限 |

`plan_request_scope` 只有兩個值，而且兩個都描述**同一個工具**的合法/不合法用法：
模型自己判斷這次請求是不是「把既有全部訂單重分配」，是的話由確定性程式擋下來，
連 OR-Tools 都不會跑。判斷仍然是語意的，擋下來是確定性的。

**2026-09-13 驗證**：8 種說法 × 3 種對話脈絡 = 24 次全部拒絕，
`runner=RunResult`、`tokens≈5,200–5,700`，證明主 Agent 真的有跑。
腳本在 `scripts/run_refusal_stability_evals.py`。

**不要把這個模式推廣成「每個工具都加一個意圖欄位」**——那會變成換皮的前置分類器。
只有在「同一個工具有明確不該做的用法」時才用。

## 驗收方式

驗收有兩份，**兩份都要過**：

| 檔案 | 驗什麼 |
|---|---|
| `docs/acceptance-tests.md` | **功能在不在**（9 區塊，約 80 項） |
| `docs/scenario-evals.md` | **答案對不對**（10 區塊，用使用者實際會打的句子） |

`scenario-evals.md` 的每一條都定義了「判定失敗」的條件。**只要命中任何一條就是 FAIL。**

**不得為了讓測試通過而修改情境 Eval 裡「輸入」欄位的句子。** 使用者不會照系統的規格講話；系統聽不懂就是系統要修。

每完成一項 TODO，**Codex 必須自己開瀏覽器實跑對應區塊**，不得只跑單元測試就宣稱完成：

1. 啟動後端與前端（見 `README.md` 本機指令）。
2. 瀏覽器 1440×900，開著 Console 與 Network。
3. 逐項執行 `acceptance-tests.md` 的對應測項，含失敗路徑。
4. 每項截圖，檔名為測項編號，存 `docs/screenshots/`。
5. 確認 Console error = 0、`/dispatch` requests = 0、`googleapis` requests = 0。
6. 依該檔末尾的格式寫進 `docs/progress.md` 的 `DONE`。

**有任何一項失敗就不准往下做。** 先修，修完重跑該區塊全部測項，再繼續下一項 TODO。

沒有實際截圖與 Console 結果的完成宣稱視為無效。「應該會過」不算過。

## 前端硬性規則

- **不得放沒有意義的副標題與空白 KPI 格。** 禁止「今日訂單 — 張／已安排 — ／使用車輛 — 台／方案狀態 尚未建立」這類佔位區塊。沒有資料就不要畫那個區塊。
- 每個畫面元素必須回答一個調度員真的會問的問題。答不出來就刪掉。
- 方案卡出現在**對話流裡**，作為可點選的選項，不是獨立面板。
- 不使用 Unicode 符號當圖示。
- **不得出現裝飾性英文小標**（`Column mapping`／`LIVE BOARD`／`CAPACITY`…）。
  `SectionTitle` 已刻意不提供 `eyebrow` 參數，不要加回來。
  檢查方式：`grep -r "uppercase tracking-wider" frontend/src` 必須為 0 筆。

### 版面設計決策（2026-09-13 重做，不要擅自改回去）

這些不是美感偏好，每一條都有理由。要改之前先確認理由不再成立。

1. **階段色主導整個畫面。** `app-shell` 依階段掛上 `stage-pre_load`／`stage-loaded`／
   `stage-dispatched`，驅動 `--stage` 等變數。上車前藍、上車後琥珀、已發車綠。
   Demo 切換階段時，台下要能一眼看出劇情推進了。

2. **地圖預設「點為主、線為輔」。** 沒有選車時線條壓到 `opacity .3`，
   配送點放大到 `radius 6` 並加白框。四條路線同時全亮會變成毛線球，
   而開場那句台詞講的是「50 張訂單、4 台車」——那一刻要看的是分佈與規模。

3. **選中一台車才畫站序數字。** `map-seq-core` 把 1、2、3… 直接標在地圖上。
   這是「看得懂路線」的關鍵；只有圓點的話，說不出車子先去哪再去哪。

4. **線條一律加白色外框（casing）。** 製圖標準做法，讓彩色線在雜亂底圖上分得出來。
   同時 `.leaflet-tile-pane` 降飽和到 `.58`，讓資料成為主角而不是底圖。

5. **窄欄位裡不准用 `sm:`／`md:` 斷點排多欄。**
   Tailwind 斷點看的是**視窗寬度**不是容器寬度。對話面板只有 392px，
   但視窗是 1440px，`sm:grid-cols-5` 會硬擠五欄，把「最小餘裕」斷成「最小餘／裕」。
   面板內一律用固定的 `grid-cols-2`，並用 `Metric` 元件排成「標籤左、數字右」。

6. **徽章永不斷字。** `Badge` 已內建 `shrink-0 whitespace-nowrap`，
   否則「可選」會被折成「可／選」。

7. **時間一律用 `formatEta()` 顯示 HH:MM。** 後端給的是完整 ISO，
   直接印會又長又難讀，而且同一個值在方案卡與訂單表會長得不一樣。

8. **提示訊息固定在右下角**，讓開地圖右上的工具列，兩者不得重疊。
