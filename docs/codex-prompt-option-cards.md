# 給 Codex 的 Prompt（方案卡只剩一張＋兩個未查的測試失敗）

複製分隔線之間整段。

---

## ⛔ 驗證方式只有一種

**全部開瀏覽器、用鍵盤把字打進輸入框、按送出、看畫面上回什麼。**
禁止用 `requests`／`curl`／`page.request` 當通過的證據；禁止只看 `evidence` 的 tool 名稱。
一律 `pressSequentially()` 逐字打，再 `press('Enter')`。每格截圖存 `docs/screenshots/`。
跑腳本不要截尾，用 `Tee-Object` 留完整 log。

**另外：改完前端一定要 `vite build`。** 上一輪改了 workbook 但沒重建，
`frontend/dist/` 還是舊檔，實際開 `http://127.0.0.1:8000` 拿到的是舊資料。
`data/samples/`、`frontend/public/`、`frontend/dist/` 三處的 xlsx 必須雜湊一致。

---

# 第 1 件（最優先）方案卡只剩一張

## 現象

```
tests/test_urgent_batch_api.py::test_tight_insert_options_offer_a_different_vehicle_placement
assert len(options) >= 2
AssertionError: assert 1 >= 2
```

唯一那張是「插入 VEH-002 第 1 站，+13.6 km」。`R1-relaxed` 也是同一個症狀。

## 這一幕是 demo 的核心，不能只有一張

`docs/demo-script.md` 第 274 行標著「**這是全場最重要的畫面**」：

> 「它不是幫我決定，是給我三個帶價碼的選擇。
> 題目問『哪些配送衝突仍需由調度人員決定』——就是這個。」

只有一張，這段台詞就講不出來，而且直接對應命題要求 C4b。

## 根因（已分析，不用重查）

責任區改成地理連續之後，**最佳解變得太明顯**，其他候選都被完全支配而被過濾掉。
那個支配過濾是對的（當初修 BUG-2「兩張卡同車同站等於沒得選」加的），**不准放寬它**。

**分區越整齊，區域中心的單決策越沒有懸念。** 這是設計上的必然，不是 bug。

## 要做兩件事

### 1-A　把 demo 的急單放到真正的交界

現在 `ORD-101` 在信義（`Z3` 中區）的區域中心，只有 VEH-002 明顯順路。

**改成放在兩台車都合理的交界位置**，例如
中和／板橋交界（`Z5` 與 `Z4`）或大安／信義與內湖／南港的交界（`Z3` 與 `Z2`）。
選一個讓**至少兩台車都可行、而且代價互有優劣**的座標。

**這不是作弊**：現實中需要調度員決定的本來就是邊界上的單，
區域中心的單根本不用問人。

⚠️ 座標一旦改動，`docs/demo-script.md`、`docs/demo-qa-matrix.md`、
以及既有 E2E 裡打的那句補欄位訊息都要同步更新成新座標。
**但不准改判定標準，只准改座標與地名。**

### 1-B　急單插入時允許考慮備援區

日常排班照主責區，**臨時急單允許跨到備援區的車**（仍須遵守載重、時段、規則）。
業務上說得通：臨時單本來就是例外支援。

實作在 `src/services/urgent_options.py`。**不准放寬支配過濾，不准產生不可行的卡。**

## 驗收

瀏覽器逐字打完整插單流程，`demo-50-tight` 與 `demo-50-relaxed` **都要**：

- **出現 ≥ 2 張方案卡**
- 每張都有：插哪台車第幾站、預估送達、代價（km／分／換車數）
- **每張都完全可行**（無超重、無跨區違規、時段合法）
- **卡片之間代價要有實質差異**，不得兩張同車同站、不得距離差 < 0.5 km 且時間差 < 1 分鐘
- 截圖存 `docs/screenshots/cards-tight-*.png`、`cards-relaxed-*.png`

並讓這兩個測試恢復通過（**不准改它們的判定**）：

```
tests/test_urgent_batch_api.py::test_tight_insert_options_offer_a_different_vehicle_placement
tests/test_urgent_batch_api.py::test_tight_ord101_options_have_a_meaningful_distance_tradeoff
```

---

# 第 2 件　另外兩個測試失敗，先查清楚再決定

```
tests/test_column_mapping.py::test_importer_applies_confirmed_mapping_before_strict_models
tests/test_dispatch_rules.py::test_tight_rule_conflict_names_rule_and_affected_orders
```

**先貼出實際的 assertion 錯誤訊息，說明是「基準過時」還是「行為壞了」，再動手。**

第二個特別重要：它對應 demo 的「規則造成無解時，要指出是哪條規則、哪些訂單衝突，
並給破例／放寬／取消三個選項」（`.agent/skills/daily-dispatch.md` 第 39 行）。
**如果是行為壞了，要修行為，不是改測試。**

如果確認只是資料變動造成的基準數字過時（例如總載重從 316 kg 變成 314.4 kg），
**只准改那個數字，不准改判定邏輯**，並在回報裡寫清楚改了哪一個數字、為什麼。

---

# 不得退步

```
frontend/tests/e2e/demo-walkthrough.spec.ts       全過
frontend/tests/e2e/d-e-acceptance.spec.ts         全過
frontend/tests/e2e/fleet-resilience.spec.ts       4/4
frontend/tests/e2e/robustness-*.spec.ts           維持上一輪
scripts/run_intent_routing_evals.py               48/48
scripts/run_refusal_stability_evals.py            24/24
pytest                                            0 failed
ruff / mypy / eslint / tsc / vitest / build       全過
```

資料門檻：**tight 與 relaxed 的計畫載重都 ≤ 315 kg，
總里程 tight ≤ 260 km、relaxed ≤ 270 km，tight 維持 49/50、relaxed 維持 50/50，
VEH-003 身上仍有至少 3 張超過 20 kg 的單。**

四台車各打一次「N號車今天不能出車」仍須全部成功重算。

---

# 硬性規則

1. **禁止 regex／關鍵字比對判斷語意。**
2. **不准改既有測項的輸入句子或判定標準**（急單座標與地名例外，見 1-A）。
3. **不准把前端預設資料改回 relaxed**（`frontend/src/App.tsx` 的 `DEFAULT_DEMO_WORKBOOK`）。
4. **不准在前端用 `requestAnimationFrame`。** 已經因此出過兩次事：
   開場卡在「建立距離矩陣…」、以及使用者送出的訊息根本沒送出去
   （分頁沒在繪製時 rAF 不會觸發）。要讓畫面先更新就用 `setTimeout(fn, 0)`。
5. **改完 `src\**\*.py` 一定要重啟 uvicorn**（沒有 `--reload`）；
   **改完前端一定要 `vite build`**。
6. **不要寫 watchdog、不要寫 while 迴圈自動重啟服務。**

# 回報方式

每個區塊給：總格數 / 通過 / 失敗 / 失敗的是哪幾格。
失敗的附上**打了什麼、畫面上實際回什麼、截圖檔名**。
另外附上三處 xlsx 的雜湊，證明 `dist` 是新的。

現在開始。先回三句話：1-A 你打算把急單放到哪個座標、為什麼那裡會有兩張以上的卡、
第 2 件那兩個失敗實際的錯誤訊息是什麼。
