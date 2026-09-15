"""Regenerate the deterministic demo workbooks with the spreadsheet skill runtime."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node") or r"C:\\Program Files\\nodejs\\node.exe"


def main() -> None:
    subprocess.run(
        [NODE, str(ROOT / "scripts" / "generate_demo_50_artifact.mjs")],
        cwd=ROOT,
        check=True,
    )


if __name__ == "__main__":
    main()
