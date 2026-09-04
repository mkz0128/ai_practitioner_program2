"""Normalize an XLSX ZIP container for a stable, reproducible artifact hash."""

from __future__ import annotations

import os
import re
import sys
import zipfile
from pathlib import Path


def normalize(path: Path) -> None:
    temporary = path.with_name(f".{path.name}.normalized.tmp")
    with zipfile.ZipFile(path, "r") as source:
        entries = {name: source.read(name) for name in source.namelist()}
    relationship_pattern = re.compile(rb"R[0-9a-f]{16}")
    relationship_ids: dict[bytes, bytes] = {}
    for name in sorted(entries):
        for relationship_id in relationship_pattern.findall(entries[name]):
            if relationship_id not in relationship_ids:
                relationship_ids[relationship_id] = f"R{len(relationship_ids) + 1}".encode()
    for name, data in entries.items():
        for source_id, target_id in relationship_ids.items():
            data = data.replace(source_id, target_id)
        entries[name] = data
    with zipfile.ZipFile(
        temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
    ) as target:
        for name in sorted(entries):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            target.writestr(info, entries[name])
    os.replace(temporary, path)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: normalize_xlsx.py PATH")
    normalize(Path(sys.argv[1]))
