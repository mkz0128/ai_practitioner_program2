# Project Agent Instructions

Before every round, read in this order:

1. `spec-driven/ACTIVE_SPEC.md`
2. `docs/project-status.md`
3. `docs/validation-report.md`
4. `.agent/guardrails.md`
5. `.agent/developer.md`
6. Only the relevant file under `.agent/skills/`

Round progress protocol:

1. Put exactly one primary task in `project-status.md` → `NOW`.
2. Check whether the work changes requirements or architecture before execution.
3. Make the approved change and run its tests/validation.
4. Update `DONE THIS ROUND` and `LAST VALIDATION` with evidence.
5. Put unresolved items in `OPEN ISSUES` or true blockers in `BLOCKED`.
6. Set the next single `NOW`; keep no more than three entries in `NEXT`.
7. Do not create separate `NOW.md`, `TODO.md`, or `DONE.md` files.

Issue routing:

- Requirement Change: draft a Spec change and wait for human approval before code.
- Code Bug: create a reproducing failing test, then fix and run regression tests.
- Data Issue: record affected fields/orders; never invent missing data.
- External Provider Issue: enable fallback and record the provider error.
- Architecture Change: provide impact analysis and wait for human approval.

Permanent rules:

- This product uses exactly one application Agent. Do not add handoffs, A2A, or a multi-Agent topology.
- LLM duties are intent understanding, tool selection, error summarization, and evidence-grounded explanation only.
- Weight arithmetic, dataset validation, assignment, routing, time windows, plan transitions, and all numeric claims are deterministic code responsibilities.
- Never invent orders, weights, coordinates, distances, ETA, traffic, assignments, or reasons. Explanations must cite structured tool evidence.
- Do not read or expose real `.env` values, secrets, customer PII, full workbook payloads, or private reasoning.
- No deployment, push, destructive filesystem action, production mutation, payment, or plan confirmation without explicit scoped approval.
- Preserve `feature_code_allowed: false` until the user sends the exact approval command `APPROVE_IMPLEMENTATION`.
- Before declaring work complete, run the applicable deterministic tests and Evals, then report evidence and remaining risk.

Workflow routing:

- Initial daily planning: `.agent/skills/daily-dispatch.md`
- Pre-dispatch urgent insertion: `.agent/skills/urgent-order-insertion.md`
- `example-skill.md` is a retained template, not an active product workflow.
