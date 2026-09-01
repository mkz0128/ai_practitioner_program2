---
name: urgent-order-insertion
description: Preview one urgent order after the initial plan and before dispatch, without mutating the original plan until explicit confirmation.
version: 1.0.0
status: approved-spec
allowed_phases: [IMPLEMENTATION, TEST]
---

# Urgent Order Insertion Workflow

## Trigger

Add exactly one order after an initial plan is `PROPOSED` or `CONFIRMED` and before any vehicle is `DISPATCHED`, including a request for the order-41 before/after preview.

## Non-trigger

Vehicle already dispatched, depot return for pickup, GPS/live WebSocket rerouting, batch insertion, or production TMS/ERP mutation.

## Required Inputs

- `plan_id` and exact `base_plan_version`.
- One new order with 1–3 package records.
- Zone, location/coordinates, AM/PM slot, and package weights.

## Ordered Steps

1. Load exact base plan and verify it is not `DISPATCHED`.
2. Validate the new order/packages with the same dataset rules.
3. Evaluate legal vehicles, capacity, time window, and incremental route evidence.
4. Re-optimize deterministically without mutating the base plan.
5. Independently validate the candidate plan.
6. Return a new preview/proposal version with before/after diff.
7. Wait for explicit human confirmation of exact plan/version before applying.

## Tools Used

`get_dispatch_plan`, `preview_urgent_order_insertion`, `validate_dispatch_plan`, `explain_assignment`, `get_map_route_data`, `get_traffic_status`, and—only after explicit plan/version confirmation—`confirm_dispatch_plan`.

## Guardrails

- Preview never overwrites the base plan; stale/mismatched versions are rejected.
- `DISPATCHED` returns `PLAN_ALREADY_DISPATCHED`; do not auto-reroute.
- Report vehicle/sequence/load/distance/time changes, conflicts, provider mode, and confirmation requirement.
- Never invent the order or missing values.

## Failure Behavior

- Invalid order: `URGENT_ORDER_INVALID`.
- No feasible insertion: `URGENT_INSERT_UNASSIGNABLE`; preserve original plan.
- Stale version: `PLAN_VERSION_CONFLICT`.
- Dispatched: `PLAN_ALREADY_DISPATCHED` and recommend manual handling.

## Output Contract

Immutable `before`, candidate `after`, structured `diff`, feasibility/exceptions, and `requires_human_confirmation: true`; no side effect before confirmation.

## Tests

Golden cases `GD-006`–`GD-009` plus lifecycle/versioning tests in `.agent/evos/unit-tests/README.md`.
