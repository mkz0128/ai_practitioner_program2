"""Confirm the local backend is up AND can actually reach OpenAI.

Started twice before with a backend that answered /ready but could not reach the
provider, which made every acceptance run fail with AGENT_PROVIDER_UNAVAILABLE.
Checking /ready alone is not enough, so this makes one real agent call.

    .venv\\Scripts\\python.exe scripts\\backend_health_probe.py

Exit code 0 means the backend is usable for acceptance runs.
"""

from __future__ import annotations

import random
import sys
import time
from pathlib import Path

import requests

BASE = "http://127.0.0.1:8000"
WORKBOOK = Path(__file__).resolve().parents[1] / "data" / "samples" / "demo-50-tight.xlsx"
PLAN_REQUEST = {
    "algorithm": "ORTOOLS",
    "objective": "BALANCED",
    "route_provider_preference": "SIMULATED",
    "traffic_mode": "SIMULATED",
}


def main() -> int:
    try:
        with WORKBOOK.open("rb") as handle:
            imported = requests.post(
                f"{BASE}/api/v1/datasets/import-excel",
                files={
                    "file": (
                        WORKBOOK.name,
                        handle,
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    )
                },
                timeout=300,
            )
        imported.raise_for_status()
        dataset_id = imported.json()["dataset_id"]

        planned = requests.post(
            f"{BASE}/api/v1/plans",
            json={"dataset_id": dataset_id, **PLAN_REQUEST},
            timeout=900,
        )
        planned.raise_for_status()
        plan = planned.json()

        started = time.time()
        reply = requests.post(
            f"{BASE}/api/v1/agent/chat",
            json={
                "session_id": f"HEALTH-{random.randint(1, 99999)}",
                "message": "哪台車載重最高",
                "context": {"plan_id": plan["plan_id"], "plan_version": plan["version"]},
            },
            timeout=300,
        )
        elapsed = time.time() - started
        body = reply.json() if reply.content else {}
        tools = [item.get("tool") for item in (body.get("evidence") or [])]
        usage = body.get("usage") or {}
        print(
            f"HTTP {reply.status_code}  {elapsed:.1f}s  tools={tools}  "
            f"tokens={usage.get('total_tokens')}",
            flush=True,
        )
        print("回覆:", (body.get("message") or "")[:140], flush=True)
        if reply.status_code != 200 or not tools:
            print("後端起來了，但這一輪沒有叫到任何工具", flush=True)
            return 1
    except Exception as exc:
        print(f"打不到後端或打不到 OpenAI：{type(exc).__name__}: {exc}", flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
