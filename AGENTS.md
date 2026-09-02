# 專案 Agent 指示

每輪開始時，依下列順序讀取：

1. `spec-driven/ACTIVE_SPEC.md`
2. `docs/project-status.md`
3. `docs/validation-report.md`
4. `.agent/guardrails.md`
5. `.agent/developer.md`
6. `.agent/skills/` 下與本輪相關的檔案

每輪進度流程：

1. 在 `project-status.md` 的 `NOW` 放入唯一主要工作。
2. 執行前確認是否會改變需求或架構。
3. 執行已核准的變更，並跑測試／驗證。
4. 以證據更新 `DONE THIS ROUND` 與 `LAST VALIDATION`。
5. 未解決事項放入 `OPEN ISSUES`；真正的阻塞才放入 `BLOCKED`。
6. 指定下一個單一 `NOW`；`NEXT` 不超過三項。
7. 不得建立獨立的 `NOW.md`、`TODO.md` 或 `DONE.md`。

問題分流：

- Requirement Change：提出 Spec 修改草案，人工核准前不得修改程式。
- Code Bug：建立可重現的失敗測試，再修正並執行 regression tests。
- Data Issue：記錄受影響的 fields/orders；不得捏造缺漏資料。
- External Provider Issue：啟用 fallback 並記錄 provider error。
- Architecture Change：提出影響分析並等待人工核准。

永久規則：

- 本產品固定使用一個 application Agent，不得加入 handoffs、A2A 或 multi-Agent topology。
- LLM 只負責 intent understanding、tool selection、error summarization 與 evidence-grounded explanation。
- Weight arithmetic、dataset validation、assignment、routing、time windows、plan transitions 與所有 numeric claims 均由 deterministic code 負責。
- 絕不捏造 orders、weights、coordinates、distances、ETA、traffic、assignments 或 reasons；explanations 必須引用 structured tool evidence。
- 不得讀取或暴露 real `.env` values、secrets、customer PII、完整 workbook payload 或 private reasoning。
- 未取得明確範圍核准，不得 deployment、push、destructive filesystem action、production mutation、payment 或 plan confirmation。
- 在使用者輸入精確核准命令 `APPROVE_IMPLEMENTATION` 前，維持 `feature_code_allowed: false`。
- 宣告完成前，執行適用的 deterministic tests 與 Evals，再回報 evidence 與 remaining risk。

工作流程分流：

- Initial daily planning: `.agent/skills/daily-dispatch.md`
- Pre-dispatch urgent insertion: `.agent/skills/urgent-order-insertion.md`
- `example-skill.md` 僅作為保留的模板，不是目前啟用的產品工作流程。
