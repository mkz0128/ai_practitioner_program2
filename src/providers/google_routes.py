from __future__ import annotations

from dataclasses import replace
from typing import Any

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
                if not allow_fallback:
                    raise GoogleRoutesProviderError("GOOGLE_RESPONSE_INVALID")
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
            encoded = routes[0].get("polyline", {}).get("encodedPolyline") if routes else None
            if not isinstance(encoded, str) or not encoded:
                raise GoogleRoutesProviderError("GOOGLE_GEOMETRY_INVALID")
            return encoded
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
