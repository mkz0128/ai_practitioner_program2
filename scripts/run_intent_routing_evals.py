"""Run the K block of docs/scenario-evals.md: intent routing across datasets.

Why this exists
---------------
Every paraphrase test we had lived in one Playwright spec and ran against one
workbook (demo-50-relaxed.xlsx), while the demo runs on demo-50-tight.xlsx.
A tool that is picked correctly for the sentences written into a spec proves
nothing about the sentences a judge will actually say.

This runner sends each K-block sentence to the live agent against three
workbooks, twice each, and judges on evidence[-1]["tool"] -- not on whether the
prose reply reads well.

Usage
-----
    python scripts/run_intent_routing_evals.py
    python scripts/run_intent_routing_evals.py --base http://127.0.0.1:8000
    python scripts/run_intent_routing_evals.py --only K-01 K-04

Exit code is non-zero when any case fails, so it can gate a commit.
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import requests

REPO_ROOT = Path(__file__).resolve().parents[1]
SAMPLES = REPO_ROOT / "data" / "samples"

WORKBOOKS = [
    "demo-50-relaxed.xlsx",
    "demo-50-tight.xlsx",
    "demo-delivery-40-orders.xlsx",
]

REPEATS = 2


@dataclass(frozen=True)
class Case:
    case_id: str
    sentence: str
    expect_tool: str | None = None
    forbid_tools: tuple[str, ...] = ()
    forbid_remove_card: bool = False
    forbid_empty_valid_plan: bool = False
    note: str = ""


CASES: list[Case] = [
    Case("K-01", "三號車的老王最近腰傷，比較重的單先不要給他", expect_tool="preview_dispatch_rule"),
    Case("K-02", "二號車的師傅年紀大了，別讓他扛太重的東西", expect_tool="preview_dispatch_rule"),
    Case("K-03", "VEH-004 的路線別拉太長", expect_tool="preview_dispatch_rule"),
    Case(
        "K-04",
        "三號車今天不能出車",
        expect_tool="change_vehicle_availability",
        forbid_empty_valid_plan=True,
        note="若因此無解，必須明確說排不出來，不得回 0 指派卻 valid:true",
    ),
    Case(
        "K-05",
        "有辦法把 ORD-022 往前挪嗎",
        expect_tool="prioritize_order_preview",
        forbid_remove_card=True,
    ),
    Case(
        "K-06",
        "幫我看一下 ORD-005 落在誰身上",
        expect_tool="explain_assignment",
        forbid_remove_card=True,
        note="純查詢不得產生任何可按下的方案卡",
    ),
    Case(
        "K-07",
        "ORD-888 為什麼沒排到",
        forbid_tools=("remove_order_preview",),
        forbid_remove_card=True,
        note="須明確說找不到這張單",
    ),
    Case("K-08", "欸等一下，還有一箱沒算到", expect_tool="urgent_insertion_workflow"),
]


@dataclass
class Result:
    case_id: str
    sentence: str
    workbook: str
    attempt: int
    tool: str | None
    passed: bool
    reasons: list[str] = field(default_factory=list)
    http: int = 0


def build_plan(base: str, workbook: str) -> dict[str, Any]:
    path = SAMPLES / workbook
    if not path.exists():
        raise SystemExit(f"missing workbook: {path}")
    with path.open("rb") as handle:
        resp = requests.post(
            f"{base}/api/v1/datasets/import-excel",
            files={
                "file": (
                    path.name,
                    handle,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
            timeout=180,
        )
    resp.raise_for_status()
    # These MUST mirror frontend/src/api.ts createPlan(). The API's own
    # defaults are FASTEST / AUTO / AUTO, which build a materially different
    # plan from the one the demo runs on -- a 15 kg insertion is feasible
    # under BALANCED and infeasible under FASTEST. Testing against the API
    # defaults means testing a configuration no user ever sees.
    plan = requests.post(
        f"{base}/api/v1/plans",
        json={
            "dataset_id": resp.json()["dataset_id"],
            "algorithm": "ORTOOLS",
            "objective": "BALANCED",
            "route_provider_preference": "SIMULATED",
            "traffic_mode": "SIMULATED",
        },
        timeout=900,
    )
    plan.raise_for_status()
    return plan.json()


def judge(case: Case, body: dict[str, Any]) -> tuple[bool, str | None, list[str]]:
    evidence = body.get("evidence") or []
    tool = evidence[-1].get("tool") if evidence else None
    reasons: list[str] = []

    # The main Agent must actually have run. A hardcoded pre-classifier that
    # forces a tool short-circuits Runner.run, leaving runner_result_type as
    # "NoneType" and total_tokens at 0. That is a routing bypass regardless of
    # whether the tool it picked happens to be the right one -- see AGENTS.md
    # "嚴格禁止搶答式路由".
    usage = body.get("usage") or {}
    if body.get("runner_result_type") == "NoneType":
        reasons.append("runner_result_type=NoneType，主 Agent 沒有執行（搶答式路由）")
    if usage.get("total_tokens") == 0:
        reasons.append("total_tokens=0，完全沒有問過模型")

    if case.expect_tool and tool != case.expect_tool:
        reasons.append(f"tool={tool}，應為 {case.expect_tool}")
    if tool in case.forbid_tools:
        reasons.append(f"tool={tool} 被明確禁止")

    for item in evidence:
        data = item.get("data") or {}
        if case.forbid_remove_card:
            for option in data.get("options") or []:
                change = option.get("change") or {}
                if change.get("kind") == "REMOVE_ORDER":
                    reasons.append(f"產生了移除訂單卡：{option.get('option_id')}")
        if case.forbid_empty_valid_plan:
            plan_block = data.get("plan") or {}
            validator = data.get("validator") or {}
            assigned = plan_block.get("assigned_order_count")
            if assigned == 0 and validator.get("valid") is True:
                reasons.append("0 指派卻 validator.valid=true（BUG-5）")

    return (not reasons), tool, reasons


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    parser.add_argument("--only", nargs="*", default=None, help="case ids, e.g. K-01 K-04")
    parser.add_argument("--repeats", type=int, default=REPEATS)
    parser.add_argument("--json-out", default=None)
    args = parser.parse_args()

    cases = [c for c in CASES if not args.only or c.case_id in set(args.only)]
    if not cases:
        raise SystemExit("no cases selected")

    print(f"building plans against {args.base}", flush=True)
    contexts = {book: build_plan(args.base, book) for book in WORKBOOKS}
    for book, ctx in contexts.items():
        print(f"  {book:30s} {ctx['plan_id']} v{ctx['version']}", flush=True)

    results: list[Result] = []
    for case in cases:
        print(f"\n{case.case_id}  {case.sentence}", flush=True)
        if case.note:
            print(f"        note: {case.note}", flush=True)
        for book in WORKBOOKS:
            ctx = contexts[book]
            for attempt in range(1, args.repeats + 1):
                resp = requests.post(
                    f"{args.base}/api/v1/agent/chat",
                    json={
                        "session_id": f"KEVAL-{uuid.uuid4().hex[:12]}",
                        "message": case.sentence,
                        "context": {"plan_id": ctx["plan_id"], "plan_version": ctx["version"]},
                    },
                    timeout=300,
                )
                body = resp.json() if resp.content else {}
                passed, tool, reasons = judge(case, body)
                if resp.status_code >= 400:
                    passed = False
                    error_code = (body.get("error") or {}).get("code")
                    reasons.append(f"HTTP {resp.status_code} {error_code}")
                results.append(
                    Result(
                        case.case_id,
                        case.sentence,
                        book,
                        attempt,
                        tool,
                        passed,
                        reasons,
                        resp.status_code,
                    )
                )
                mark = "PASS" if passed else "FAIL"
                detail = "" if passed else "  <- " + "；".join(reasons)
                print(f"    {mark}  [{book:28s}] #{attempt}  {tool}{detail}", flush=True)

    print("\n=== summary ===", flush=True)
    failed = 0
    unstable: list[str] = []
    for case in cases:
        subset = [r for r in results if r.case_id == case.case_id]
        ok = sum(1 for r in subset if r.passed)
        if ok != len(subset):
            failed += 1
        # Same sentence, same workbook, different tool between attempts is a
        # separate failure mode from picking the wrong tool: it passes a single
        # rehearsal and fails on stage. Report it even when every attempt passed.
        for book in WORKBOOKS:
            tools = {r.tool for r in subset if r.workbook == book}
            if len(tools) > 1:
                unstable.append(f"{case.case_id} 在 {book}：{sorted(t or 'None' for t in tools)}")
        print(f"  {ok}/{len(subset)}  {case.case_id}  {case.sentence[:32]}", flush=True)

    if unstable:
        print("\n=== 不穩定（同句同資料，兩次結果不同）===", flush=True)
        for line in unstable:
            print(f"  {line}", flush=True)
        failed += len(unstable)

    total_ok = sum(1 for r in results if r.passed)
    print(f"\n{total_ok}/{len(results)} 通過，{failed} 個測項未全數通過", flush=True)

    if args.json_out:
        Path(args.json_out).write_text(
            json.dumps([r.__dict__ for r in results], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"wrote {args.json_out}", flush=True)

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
