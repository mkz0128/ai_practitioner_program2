# Changelog

## Unreleased — 2026-09-02

### Added

- Precise workbook missing-field errors for order/package/field paths with manual-review markers.
- Deterministic evidence-grounded Plan stop recommendations for zone, weight, load, time, and matrix order.
- Computed urgent-insert reassignment, sequence, vehicle-load, and distance/time deltas.
- Executable competition acceptance tests and the Chinese `scripts/run_p0_demo.py` preview walkthrough.
- Golden Dataset cases GD-026–GD-030 for field validation, evidence, urgent diff, demo, and Validator gates.

### Safety

- P0 remains `READY_FOR_HUMAN_REVIEW — not DONE`; the demo never Dispatches or deploys.
- Urgent insertion now compares the exact OR-Tools base plan and defaults to validated `MINIMAL_CHANGE`; full replan requires explicit mode, reason, and movement scope.

## 0.1.0-spec — 2026-09-01

### Added

- Canonical product specification for the explainable delivery dispatch Copilot.
- Single-Agent architecture and two workflow Skills.
- REST API and frontend handoff contracts.
- Deterministic validation, optimization, plan versioning, and fallback requirements.
- Version-locked Python toolchain and resolved dependency lock.
- Project-specific observability, denial-of-wallet, security, Evals, and human approval rules.
- Four-sheet input template and fixed-seed 40-order demo dataset plan.

### Security

- Feature implementation remains locked pending `APPROVE_IMPLEMENTATION`.
- Production, secrets, PII, deployment, external writes, and user confirmation impersonation are prohibited.
