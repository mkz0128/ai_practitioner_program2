# 控制塔操作元件驗收表

本表只列目前主要控制塔會顯示的操作。不存在實際行為的裝飾按鈕不得保留。

| 操作 | 使用者目的 | 實際行為 | 驗收證據 |
|---|---|---|---|
| 附加訂單檔案 | 開啟資料操作 | 顯示上傳、40 張範例與範例下載 | `control-tower.spec.ts` |
| 上傳 Excel | 選擇 `.xlsx` | 附件與文字同一輪送出後匯入及驗證 | `live-control-tower.spec.ts` |
| 使用 40 張範例訂單 | 使用匿名示範資料 | 取得 Repository 內的固定範例檔並附加 | `AgentPanel` 元件測試／瀏覽器流程 |
| 下載範例格式 | 下載支援欄位的範例 | 下載 `demo-delivery-40-orders.xlsx` | `control-tower.spec.ts` |
| 送出 | 提交自然語言要求 | 呼叫 `/api/v1/agent/chat`；Enter 同行為 | Agent／Playwright tests |
| 停止 | 中止等待中的回答 | 取消目前 HTTP request，不變更方案 | `live-control-tower.spec.ts` |
| 重試 | 重送最後一則使用者文字 | 重新經 Agent API 處理 | `AgentPanel` 元件行為 |
| 顯示全部路線／車輛 | 篩選地圖 | 同步切換地圖路線透明度與清單 | `MapPanel`／Playwright |
| 移至其他車輛 | 無障礙換車操作 | 呼叫後端 Reassignment Preview | `VehiclePanel.test.tsx` |
| 拖曳訂單 | 用滑鼠預覽換車 | 與下拉選單共用同一 Preview API | `VehiclePanel.test.tsx` |
| 比較三種方案 | 比較速度、載重與時段取捨 | 同一 Matrix 重新求解三種 objective | `test_top5_features.py` |
| 延遲 10／20／30 分鐘 | 查看時段風險 | 回傳 deterministic ETA 餘裕與受影響訂單 | `test_top5_features.py` |
| 查看版本 | 查看不可變版本 | 列出 V1、V2、V3 狀態與建立時間 | `test_top5_features.py` |
| 復原為此版本 | 以舊版建立新草稿 | 新增版本並重新執行方案檢查 | `test_top5_features.py` |
| 套用變更／取消變更 | 決定是否接受 Preview | 確認後建立版本；取消保留原方案 | API／Playwright tests |
| 確認方案 | 確認完整合法方案 | 僅 `ORTOOLS`、完整、規則通過的草稿可確認 | `test_formal_plan_guardrails.py` |

主畫面不得顯示 Raw JSON、內部錯誤碼或 Provider／Matrix／Validator 等工程術語；技術追蹤資訊只放在收合區或測試報告。
