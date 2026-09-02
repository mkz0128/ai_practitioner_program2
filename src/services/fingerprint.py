import hashlib
import json

from src.domain.models import Dataset


def dataset_hash(dataset: Dataset) -> str:
    """Return a stable SHA-256 identity for a validated dataset snapshot."""
    canonical = json.dumps(
        dataset.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
