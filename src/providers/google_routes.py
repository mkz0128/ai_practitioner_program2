from __future__ import annotations

from dataclasses import replace
from time import monotonic
from typing import Any, ClassVar

import httpx

from src.domain.models import Dataset
from src.services.matrix import MatrixResult, SimulatedRouteProvider


class GoogleRoutesProviderError(RuntimeError):
    """Safe provider error; message never contains credentials or request headers."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class GoogleRoutesProvider:
    """Server-side Routes adapter with explicit optional fallback semantics."""

    endpoint = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"
    field_mask = "originIndex,destinationIndex,status,condition,distanceMeters,duration"
    # Google limits non-transit ComputeRouteMatrix requests to 625 elements.
    # Keep both dimensions at most 25 so a 40-order dataset (plus depot) is
    # fetched through bounded requests without falling back to simulation.
    max_batch_dimension = 25
    cache_ttl_seconds = 900.0
    _matrix_cache: ClassVar[
        dict[tuple[tuple[float, float], ...], tuple[float, MatrixResult]]
    ] = {}
    _geometry_cache: ClassVar[dict[tuple[tuple[float, float], ...], tuple[float, str]]] = {}

    def __init__(self, api_key: str | None, timeout_seconds: float = 10.0) -> None:
        self._api_key = api_key
        self._timeout_seconds = timeout_seconds

    @staticmethod
    def _waypoint(latitude: float, longitude: float) -> dict[str, Any]:
        return {
            "waypoint": {"location": {"latLng": {"latitude": latitude, "longitude": longitude}}}
        }

    @staticmethod
    def _location(latitude: float, longitude: float) -> dict[str, Any]:
        return {"location": {"latLng": {"latitude": latitude, "longitude": longitude}}}

    def _request_entries(
        self,
        origins: list[tuple[float, float]],
        destinations: list[tuple[float, float]],
    ) -> list[tuple[int, int, int, int]]:
        assert self._api_key is not None
        payload = {
            "origins": [self._waypoint(*coordinate) for coordinate in origins],
            "destinations": [self._waypoint(*coordinate) for coordinate in destinations],
            "travelMode": "DRIVE",
            "routingPreference": "TRAFFIC_AWARE",
        }
        response = httpx.post(
            self.endpoint,
            json=payload,
            headers={"X-Goog-Api-Key": self._api_key, "X-Goog-FieldMask": self.field_mask},
            timeout=self._timeout_seconds,
        )
        response.raise_for_status()
        entries = response.json()
        expected_count = len(origins) * len(destinations)
        if not isinstance(entries, list) or len(entries) != expected_count:
            raise GoogleRoutesProviderError("GOOGLE_RESPONSE_INVALID")
        parsed: list[tuple[int, int, int, int]] = []
        for entry in entries:
            origin_index = int(entry["originIndex"])
            destination_index = int(entry["destinationIndex"])
            if not (0 <= origin_index < len(origins)):
                raise GoogleRoutesProviderError("GOOGLE_RESPONSE_INVALID")
            if not (0 <= destination_index < len(destinations)):
                raise GoogleRoutesProviderError("GOOGLE_RESPONSE_INVALID")
            if entry.get("condition") not in (None, "ROUTE_EXISTS"):
                raise GoogleRoutesProviderError("GOOGLE_ROUTE_UNAVAILABLE")
            distance_value = entry.get("distanceMeters")
            duration_value = entry.get("duration")
            same_node = origins[origin_index] == destinations[destination_index]
            if distance_value is None and same_node:
                distance_value = 0
            if duration_value is None and same_node:
                duration_value = "0s"
            if distance_value is None or duration_value is None:
                raise GoogleRoutesProviderError("GOOGLE_RESPONSE_INVALID")
            duration_text = str(duration_value).removesuffix("s")
            parsed.append(
                (
                    origin_index,
                    destination_index,
                    int(distance_value),
                    max(0, round(float(duration_text))),
                )
            )
        return parsed

    @classmethod
    def _cached_matrix(
        cls, coordinates: tuple[tuple[float, float], ...]
    ) -> MatrixResult | None:
        cached = cls._matrix_cache.get(coordinates)
        if cached is None:
            return None
        expires_at, matrix = cached
        if monotonic() >= expires_at:
            del cls._matrix_cache[coordinates]
            return None
        return matrix

    @classmethod
    def _cache_matrix(
        cls, coordinates: tuple[tuple[float, float], ...], matrix: MatrixResult
    ) -> None:
        cls._matrix_cache[coordinates] = (monotonic() + cls.cache_ttl_seconds, matrix)

    def build(self, dataset: Dataset, *, allow_fallback: bool = True) -> MatrixResult:
        fallback = SimulatedRouteProvider().build(dataset)
        if not self._api_key:
            if not allow_fallback:
                raise GoogleRoutesProviderError("GOOGLE_KEY_MISSING")
            return replace(fallback, warning="GOOGLE_KEY_MISSING")
        orders = tuple(sorted(dataset.orders, key=lambda order: order.order_id))
        coordinates = [
            (SimulatedRouteProvider.depot_latitude, SimulatedRouteProvider.depot_longitude)
        ] + [(order.latitude, order.longitude) for order in orders]
        node_ids = ("DEPOT-001", *(order.order_id for order in orders))
        try:
            coordinate_key = tuple(coordinates)
            cached = self._cached_matrix(coordinate_key)
            if cached is not None:
                return cached
            distances = [[0 for _ in coordinates] for _ in coordinates]
            durations = [[0 for _ in coordinates] for _ in coordinates]
            batch_size = self.max_batch_dimension
            for origin_start in range(0, len(coordinates), batch_size):
                origin_indexes = range(
                    origin_start, min(origin_start + batch_size, len(coordinates))
                )
                for destination_start in range(0, len(coordinates), batch_size):
                    destination_indexes = range(
                        destination_start,
                        min(destination_start + batch_size, len(coordinates)),
                    )
                    origin_list = list(origin_indexes)
                    destination_list = list(destination_indexes)
                    entries = self._request_entries(
                        [coordinates[index] for index in origin_list],
                        [coordinates[index] for index in destination_list],
                    )
                    for origin_index, destination_index, distance, duration in entries:
                        row = origin_list[origin_index]
                        column = destination_list[destination_index]
                        distances[row][column] = distance
                        durations[row][column] = duration
            result = MatrixResult(
                node_ids=node_ids,
                distance_m=tuple(tuple(row) for row in distances),
                duration_s=tuple(tuple(row) for row in durations),
                provider_mode="GOOGLE",
                matrix_version="google-routes-v1",
            )
            self._cache_matrix(coordinate_key, result)
            return result
        except GoogleRoutesProviderError:
            raise
        except httpx.HTTPStatusError as exc:
            if not allow_fallback:
                raise GoogleRoutesProviderError(f"GOOGLE_HTTP_{exc.response.status_code}") from None
            return replace(fallback, warning="GOOGLE_HTTP_ERROR")
        except httpx.TimeoutException:
            if not allow_fallback:
                raise GoogleRoutesProviderError("GOOGLE_TIMEOUT") from None
            return replace(fallback, warning="GOOGLE_TIMEOUT")
        except (httpx.HTTPError, KeyError, TypeError, ValueError):
            if not allow_fallback:
                raise GoogleRoutesProviderError("GOOGLE_REQUEST_FAILED") from None
            return replace(fallback, warning="GOOGLE_REQUEST_FAILED")

    def extend_matrix(
        self,
        base_matrix: MatrixResult,
        base_node_ids: tuple[str, ...],
        base_coordinates: list[tuple[float, float]],
        node_ids: tuple[str, ...],
        coordinates: list[tuple[float, float]],
        *,
        allow_fallback: bool = True,
    ) -> MatrixResult:
        """Extend an existing live matrix by fetching only new rows and columns."""
        fallback = MatrixResult(
            node_ids=node_ids,
            distance_m=tuple(tuple(0 for _ in node_ids) for _ in node_ids),
            duration_s=tuple(tuple(0 for _ in node_ids) for _ in node_ids),
            provider_mode="SIMULATED",
            matrix_version="sim-v1",
            warning="GOOGLE_KEY_MISSING",
        )
        if not self._api_key:
            if not allow_fallback:
                raise GoogleRoutesProviderError("GOOGLE_KEY_MISSING")
            return replace(fallback, warning="GOOGLE_KEY_MISSING")
        coordinate_key = tuple(coordinates)
        cached = self._cached_matrix(coordinate_key)
        if cached is not None:
            return cached
        base_indexes = {node_id: index for index, node_id in enumerate(base_node_ids)}
        new_indexes = [
            index for index, node_id in enumerate(node_ids) if node_id not in base_indexes
        ]
        if not new_indexes:
            return base_matrix
        distances = [[0 for _ in node_ids] for _ in node_ids]
        durations = [[0 for _ in node_ids] for _ in node_ids]
        for target_row, base_row in base_indexes.items():
            for target_column, base_column in base_indexes.items():
                row = base_indexes[target_row]
                column = base_indexes[target_column]
                distances[row][column] = base_matrix.distance_m[base_row][base_column]
                durations[row][column] = base_matrix.duration_s[base_row][base_column]
        try:
            new_coordinates = [coordinates[index] for index in new_indexes]
            all_entries = self._request_entries(new_coordinates, coordinates)
            for origin_index, destination_index, distance, duration in all_entries:
                row = new_indexes[origin_index]
                distances[row][destination_index] = distance
                durations[row][destination_index] = duration
            existing_indexes = [
                index for index in range(len(node_ids)) if index not in new_indexes
            ]
            existing_coordinates = [coordinates[index] for index in existing_indexes]
            column_entries = self._request_entries(existing_coordinates, new_coordinates)
            for origin_index, destination_index, distance, duration in column_entries:
                row = existing_indexes[origin_index]
                column = new_indexes[destination_index]
                distances[row][column] = distance
                durations[row][column] = duration
            result = MatrixResult(
                node_ids=node_ids,
                distance_m=tuple(tuple(row) for row in distances),
                duration_s=tuple(tuple(row) for row in durations),
                provider_mode="GOOGLE",
                matrix_version="google-routes-v1",
            )
            self._cache_matrix(coordinate_key, result)
            return result
        except GoogleRoutesProviderError:
            raise
        except httpx.HTTPStatusError as exc:
            if not allow_fallback:
                raise GoogleRoutesProviderError(f"GOOGLE_HTTP_{exc.response.status_code}") from None
            return replace(fallback, warning="GOOGLE_HTTP_ERROR")
        except httpx.TimeoutException:
            if not allow_fallback:
                raise GoogleRoutesProviderError("GOOGLE_TIMEOUT") from None
            return replace(fallback, warning="GOOGLE_TIMEOUT")
        except (httpx.HTTPError, KeyError, TypeError, ValueError):
            if not allow_fallback:
                raise GoogleRoutesProviderError("GOOGLE_REQUEST_FAILED") from None
            return replace(fallback, warning="GOOGLE_REQUEST_FAILED")

    def build_route_geometry(
        self, coordinates: list[tuple[float, float]], *, allow_fallback: bool = True
    ) -> str:
        """Return an encoded Google polyline for one ordered route.

        Geometry is fetched separately from the matrix because the matrix endpoint only
        returns distance and duration. The fallback is intentionally a deterministic
        coordinate path and is labelled by the caller as simulated.
        """
        fallback = ";".join(f"{latitude},{longitude}" for latitude, longitude in coordinates)
        if not self._api_key:
            if not allow_fallback:
                raise GoogleRoutesProviderError("GOOGLE_KEY_MISSING")
            return f"simulated:{fallback}"
        if len(coordinates) < 2:
            if not allow_fallback:
                raise GoogleRoutesProviderError("GOOGLE_ROUTE_TOO_SHORT")
            return f"simulated:{fallback}"
        geometry_key = tuple(coordinates)
        cached_geometry = self._geometry_cache.get(geometry_key)
        if cached_geometry is not None:
            expires_at, encoded = cached_geometry
            if monotonic() < expires_at:
                return encoded
            del self._geometry_cache[geometry_key]
        origin = self._location(*coordinates[0])
        destination = self._location(*coordinates[-1])
        payload = {
            "origin": origin,
            "destination": destination,
            "intermediates": [self._location(*coordinate) for coordinate in coordinates[1:-1]],
            "travelMode": "DRIVE",
            "routingPreference": "TRAFFIC_AWARE",
            "polylineQuality": "OVERVIEW",
            "polylineEncoding": "ENCODED_POLYLINE",
        }
        try:
            response = httpx.post(
                "https://routes.googleapis.com/directions/v2:computeRoutes",
                json=payload,
                headers={
                    "X-Goog-Api-Key": self._api_key,
                    "X-Goog-FieldMask": (
                        "routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration"
                    ),
                },
                timeout=self._timeout_seconds,
            )
            response.raise_for_status()
            body = response.json()
            routes = body.get("routes") if isinstance(body, dict) else None
            encoded_polyline = (
                routes[0].get("polyline", {}).get("encodedPolyline") if routes else None
            )
            if not isinstance(encoded_polyline, str) or not encoded_polyline:
                raise GoogleRoutesProviderError("GOOGLE_GEOMETRY_INVALID")
            self._geometry_cache[geometry_key] = (
                monotonic() + self.cache_ttl_seconds,
                encoded_polyline,
            )
            return encoded_polyline
        except GoogleRoutesProviderError:
            if not allow_fallback:
                raise
            return f"simulated:{fallback}"
        except httpx.HTTPStatusError as exc:
            if not allow_fallback:
                raise GoogleRoutesProviderError(f"GOOGLE_HTTP_{exc.response.status_code}") from None
            return f"simulated:{fallback}"
        except httpx.TimeoutException:
            if not allow_fallback:
                raise GoogleRoutesProviderError("GOOGLE_TIMEOUT") from None
            return f"simulated:{fallback}"
        except (httpx.HTTPError, KeyError, TypeError, ValueError):
            if not allow_fallback:
                raise GoogleRoutesProviderError("GOOGLE_GEOMETRY_FAILED") from None
            return f"simulated:{fallback}"
