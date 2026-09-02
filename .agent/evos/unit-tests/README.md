# 確定性單元與契約測試

測試是確定性核心的可執行契約。除非明確執行標記為 live 的 external integration test，否則 OpenAI、Google 與 TDX 均以 fakes／fixtures 取代。

## 必要測試套件

- **Workbook**：四張工作表／欄位、唯一 ID、孤兒 package、package count、正重量、座標、zones、`AM|PM`、vehicle loads 與 `|` list parsing。
- **Domain**：精確 package/order weight arithmetic、不可拆單／重複、含 current load 的 capacity、service zones、availability、time windows、lunch 與 depot start/end。
- **Optimizer**：固定 matrix 可重現性、集中需求重新分配、lexicographic objective 與明確的 partial infeasibility。
- **Validator**：即使 solver 宣稱成功，也要獨立拒絕 overload、duplication、cross-zone、unavailable vehicle、time、lunch 與 depot violations。
- **Lifecycle**：允許的 transitions、immutable preview、exact version confirmation、stale version conflict、dispatched rejection 與 audit events。
- **Providers**：Google／TDX／OpenAI timeout／auth failure、標示清楚的 fallback 與 deterministic REST continuity。
- **API**：strict schema、stable error envelope、request ID、OpenAPI snapshot、configured CORS 與 local test 以外的 wildcard rejection。
- **Security/Evals**：prompt injection 不得繞過 approval；numeric claims 必須追溯至 evidence；limits 必須 fail closed。

## 命名與追溯

- 測試命名為 `test_<condition>_<expected_result>`。
- 每項測試連結至 Spec／AC 或 Golden case ID。
- Unit tests 必須 order-independent、fixed-clock、fixed-seed 且 network-free。

## 品質閘門

`pytest`、`ruff check`、`mypy`、OpenAPI/schema snapshot 與所有 critical Golden cases 必須通過，且不得有 critical regression。
