import hashlib
import json

from src.domain.models import Dataset
from src.services.matrix import MatrixResult


def dataset_hash(dataset: Dataset) -> str:
    """Return a stable SHA-256 identity for a validated dataset snapshot."""
    canonical = json.dumps(
        dataset.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def matrix_hash(matrix: MatrixResult) -> str:
    """Return a stable identity for the exact route matrix used by a plan."""
    canonical = json.dumps(
        {
            "node_ids": matrix.node_ids,
            "distance_m": matrix.distance_m,
            "duration_s": matrix.duration_s,
            "provider_mode": matrix.provider_mode,
            "matrix_version": matrix.matrix_version,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
