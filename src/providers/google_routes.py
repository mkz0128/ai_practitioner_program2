from __future__ import annotations

from dataclasses import replace
from typing import Any

import httpx

from src.domain.models import Dataset
from src.services.matrix import MatrixResult, SimulatedRouteProvider


class GoogleRoutesProvider:
    """Optional server-side Routes adapter; failures visibly fall back to sim-v1."""

    endpoint = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"
    field_mask = "originIndex,destinationIndex,status,condition,distanceMeters,duration"

    def __init__(self, api_key: str | None, timeout_seconds: float = 10.0) -> None:
        self._api_key = api_key
        self._timeout_seconds = timeout_seconds

    @staticmethod
    def _waypoint(latitude: float, longitude: float) -> dict[str, Any]:
        return {
            "waypoint": {"location": {"latLng": {"latitude": latitude, "longitude": longitude}}}
        }

    def build(self, dataset: Dataset) -> MatrixResult:
        fallback = SimulatedRouteProvider().build(dataset)
        if not self._api_key:
            return replace(fallback, warning="GOOGLE_KEY_MISSING")
        orders = tuple(sorted(dataset.orders, key=lambda order: order.order_id))
        coordinates = [
            (SimulatedRouteProvider.depot_latitude, SimulatedRouteProvider.depot_longitude)
        ] + [(order.latitude, order.longitude) for order in orders]
        node_ids = ("DEPOT-001", *(order.order_id for order in orders))
        payload = {
            "origins": [self._waypoint(*coordinate) for coordinate in coordinates],
            "destinations": [self._waypoint(*coordinate) for coordinate in coordinates],
            "travelMode": "DRIVE",
            "routingPreference": "TRAFFIC_AWARE",
        }
        try:
            response = httpx.post(
                self.endpoint,
                json=payload,
                headers={"X-Goog-Api-Key": self._api_key, "X-Goog-FieldMask": self.field_mask},
                timeout=self._timeout_seconds,
            )
            response.raise_for_status()
            entries = response.json()
            if not isinstance(entries, list) or len(entries) != len(coordinates) ** 2:
                return replace(fallback, warning="GOOGLE_RESPONSE_INVALID")
            distances = [[0 for _ in coordinates] for _ in coordinates]
            durations = [[0 for _ in coordinates] for _ in coordinates]
            for entry in entries:
                origin_index = int(entry["originIndex"])
                destination_index = int(entry["destinationIndex"])
                distances[origin_index][destination_index] = int(entry["distanceMeters"])
                duration_text = str(entry["duration"]).removesuffix("s")
                durations[origin_index][destination_index] = max(0, round(float(duration_text)))
            return MatrixResult(
                node_ids=node_ids,
                distance_m=tuple(tuple(row) for row in distances),
                duration_s=tuple(tuple(row) for row in durations),
                provider_mode="GOOGLE",
                matrix_version="google-routes-v1",
            )
        except (httpx.HTTPError, KeyError, TypeError, ValueError):
            return replace(fallback, warning="GOOGLE_REQUEST_FAILED")
