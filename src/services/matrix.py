from dataclasses import dataclass
from math import asin, cos, radians, sin, sqrt

from src.domain.models import Dataset


@dataclass(frozen=True)
class MatrixResult:
    node_ids: tuple[str, ...]
    distance_m: tuple[tuple[int, ...], ...]
    duration_s: tuple[tuple[int, ...], ...]
    provider_mode: str = "SIMULATED"
    matrix_version: str = "sim-v1"


def _distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> int:
    earth_radius_m = 6_371_000
    d_lat = radians(lat2 - lat1)
    d_lon = radians(lon2 - lon1)
    a = sin(d_lat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(d_lon / 2) ** 2
    return max(1, round(earth_radius_m * 2 * asin(sqrt(a))))


class SimulatedRouteProvider:
    """Pure fixed-matrix provider; no external calls or secrets."""

    depot_latitude = 25.0131533
    depot_longitude = 121.4599675

    def build(self, dataset: Dataset) -> MatrixResult:
        orders = tuple(sorted(dataset.orders, key=lambda order: order.order_id))
        coordinates = [(self.depot_latitude, self.depot_longitude)] + [
            (order.latitude, order.longitude) for order in orders
        ]
        node_ids = ("DEPOT-001", *(order.order_id for order in orders))
        distances: list[tuple[int, ...]] = []
        durations: list[tuple[int, ...]] = []
        for origin in coordinates:
            distance_row: list[int] = []
            duration_row: list[int] = []
            for destination in coordinates:
                distance = 0 if origin == destination else _distance_m(*origin, *destination)
                distance_row.append(distance)
                duration_row.append(0 if distance == 0 else max(60, round(distance / 8)))
            distances.append(tuple(distance_row))
            durations.append(tuple(duration_row))
        return MatrixResult(
            node_ids=node_ids, distance_m=tuple(distances), duration_s=tuple(durations)
        )
