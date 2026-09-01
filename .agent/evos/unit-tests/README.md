# Deterministic Unit and Contract Tests

Tests are the executable contract for the deterministic core. OpenAI, Google, and TDX are replaced by fakes/fixtures unless a separately marked external integration test is run.

## Required Suites

- **Workbook**: four sheets/columns, unique IDs, orphan packages, package count, positive weight, coordinates, zones, `AM|PM`, vehicle loads, and `|` list parsing.
- **Domain**: exact package/order weight arithmetic, no split/duplicate, capacity including current load, service zones, availability, time windows, lunch, and depot start/end.
- **Optimizer**: fixed matrix repeatability, concentrated-demand redistribution, lexicographic objective, and explicit partial infeasibility.
- **Validator**: independently reject overload, duplication, cross-zone, unavailable vehicle, time, lunch, and depot violations even if solver claims success.
- **Lifecycle**: allowed transitions, immutable preview, exact version confirmation, stale version conflict, dispatched rejection, and audit events.
- **Providers**: Google/TDX/OpenAI timeout/auth failure, labeled fallback, and deterministic REST continuity.
- **API**: strict schema, stable error envelope, request ID, OpenAPI snapshot, configured CORS, and wildcard rejection outside local tests.
- **Security/Evals**: prompt injection cannot bypass approval; numeric claims trace to evidence; limits fail closed.

## Naming and Traceability

- Name tests `test_<condition>_<expected_result>`.
- Link every test to a Spec/AC or Golden case ID.
- Unit tests are order-independent, fixed-clock, fixed-seed, and network-free.

## Quality Gate

`pytest`, `ruff check`, `mypy`, OpenAPI/schema snapshot, and all critical Golden cases pass with no critical regression.
