"""Run the refusal-stability matrix for unsupported whole-order redistribution.

The matrix deliberately executes the real HTTP chat path with the same plan
parameters as the frontend.  Each refusal phrase is tested in a fresh session
for three structured application contexts so a previous tool result cannot
silently change the assertion.

Exit status is non-zero when any cell fails.
"""

from __future__ import annotations

import argparse
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests

REPO_ROOT = Path(__file__).resolve().parents[1]
SAMPLES = REPO_ROOT / "data" / "samples"
REFUSAL_PHRASES = (
    "把所有單重新分配一遍",
    "全部重排一次",
    "今天的單我想整個重新分過",
    "重新分配所有訂單",
    "可以把全部訂單重新安排嗎",
    "整批重新洗牌",
    "redistribute all orders",
    "所有單子重新配一次車",
)
PLAN_REQUEST = {
    "algorithm": "ORTOOLS",
    "objective": "BALANCED",
    "route_provider_preference": "SIMULATED",
    "traffic_mode": "SIMULATED",
}


@dataclass(frozen=True)
class ContextCase:
    name: str
    session_id: str
    plan: dict[str, Any]


def build_plan(base: str) -> dict[str, Any]:
    workbook = SAMPLES / "demo-50-relaxed.xlsx"
    with workbook.open("rb") as handle:
        imported = requests.post(
            f"{base}/api/v1/datasets/import-excel",
            files={
                "file": (
                    workbook.name,
                    handle,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
            timeout=180,
        )
    imported.raise_for_status()
    payload = {"dataset_id": imported.json()["dataset_id"], **PLAN_REQUEST}
    planned = requests.post(f"{base}/api/v1/plans", json=payload, timeout=900)
    planned.raise_for_status()
    return planned.json()


def chat(
    base: str,
    session_id: str,
    plan: dict[str, Any],
    message: str,
    *,
    action: str | None = None,
) -> dict[str, Any]:
    response = requests.post(
        f"{base}/api/v1/agent/chat",
        json={
            "session_id": session_id,
            "message": message,
            "context": {
                "plan_id": plan["plan_id"],
                "plan_version": plan["version"],
            },
            **({"action": action} if action is not None else {}),
        },
        timeout=300,
    )
    body = response.json() if response.content else {}
    if response.status_code >= 400:
        error_message = (body.get("error") or {}).get("message", response.text)
        raise RuntimeError(
            f"HTTP {response.status_code}: {error_message}"
        )
    return body


def prepare_context(base: str, plan: dict[str, Any], context_name: str) -> ContextCase:
    session_id = f"REFUSAL-{context_name}-{uuid.uuid4().hex[:12].upper()}"
    if context_name == "A-clean":
        return ContextCase(context_name, session_id, plan)
    if context_name == "B-urgent-preview":
        chat(base, session_id, plan, "請協助收集一筆臨時配送需求")
        chat(
            base,
            session_id,
            plan,
            "訂單編號 TMP-REF-001，配送區域 Z3，城市臺北市，行政區信義，"
            "地點名稱信義臨時站，緯度 25.033，經度 121.565，包裹件數 1，"
            "每件重量 2 公斤，早上配送",
        )
        preview = chat(
            base,
            session_id,
            plan,
            "請產生插單預覽",
            action="PREVIEW_URGENT",
        )
        data = (preview.get("evidence") or [])[-1].get("data") or {}
        if data.get("stage") != "PREVIEW_READY":
            raise RuntimeError(f"急單預覽未建立 PREVIEW_READY：{preview}")
        return ContextCase(context_name, session_id, plan)
    if context_name == "C-rule-preview":
        rule = chat(base, session_id, plan, "請讓三號車的單件重量不要超過 20 公斤")
        tool = (rule.get("evidence") or [])[-1].get("tool")
        if tool != "preview_dispatch_rule":
            raise RuntimeError(f"規則預覽未建立 preview_dispatch_rule：{rule}")
        return ContextCase(context_name, session_id, plan)
    raise ValueError(f"unknown context: {context_name}")


def judge(body: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    evidence = body.get("evidence") or []
    tools = [item.get("tool") for item in evidence if isinstance(item, dict)]
    usage = body.get("usage") or {}
    if "這個我不能改" not in str(body.get("message", "")):
        reasons.append("回覆沒有包含「這個我不能改」")
    if tools[-1:] != ["reject_unsupported_change"]:
        reasons.append(f"最後工具為 {tools[-1:]!r}，不是 reject_unsupported_change")
    if "plan_dispatch" in tools:
        reasons.append("evidence 出現 plan_dispatch")
    if body.get("runner_result_type") == "NoneType":
        reasons.append("runner_result_type=NoneType")
    if not isinstance(usage.get("total_tokens"), int) or usage["total_tokens"] <= 0:
        reasons.append(f"usage.total_tokens={usage.get('total_tokens')!r}")
    return reasons


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    parser.add_argument("--only", nargs="*", default=None, help="exact refusal phrases to run")
    args = parser.parse_args()

    plan = build_plan(args.base)
    print(f"plan={plan['plan_id']} v{plan['version']} params={PLAN_REQUEST}", flush=True)
    failures = 0
    total = 0
    phrases = [phrase for phrase in REFUSAL_PHRASES if not args.only or phrase in args.only]
    if not phrases:
        raise SystemExit("no phrases selected")
    for phrase in phrases:
        for context_name in ("A-clean", "B-urgent-preview", "C-rule-preview"):
            total += 1
            try:
                context = prepare_context(args.base, plan, context_name)
                body = chat(args.base, context.session_id, context.plan, phrase)
                reasons = judge(body)
                tools = [item.get("tool") for item in body.get("evidence") or []]
                usage = body.get("usage") or {}
                if reasons:
                    failures += 1
                    print(
                        f"FAIL {context_name} | {phrase} | tools={tools} "
                        f"runner={body.get('runner_result_type')} "
                        f"tokens={usage.get('total_tokens')} "
                        f"reasons={'；'.join(reasons)} | reply={body.get('message', '')}",
                        flush=True,
                    )
                else:
                    print(
                        f"PASS {context_name} | {phrase} | tools={tools} "
                        f"runner={body.get('runner_result_type')} "
                        f"tokens={usage.get('total_tokens')}",
                        flush=True,
                    )
            except Exception as exc:
                failures += 1
                print(f"FAIL {context_name} | {phrase} | error={exc}", flush=True)

    print(f"{total - failures}/{total} 通過", flush=True)
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
