from __future__ import annotations

import time
from math import asin, cos, radians, sin, sqrt
from typing import Any

import httpx
from pydantic import BaseModel, ConfigDict, Field

from src.domain.models import Dataset
from src.services.planner import PlanResult


class TDXProviderStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool
    status: str
    mode: str
    data_status: str = "NOT_QUERIED"


class TDXTrafficEvent(BaseModel):
    """Minimal, non-sensitive event projection used by the UI and risk evidence."""

    model_config = ConfigDict(extra="forbid")

    event_id: str = Field(min_length=1)
    event_type: str = Field(min_length=1)
    description: str = Field(min_length=1)
    severity: str = Field(min_length=1)
    city_code: str | None = None
    road_name: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    affected_zone_codes: tuple[str, ...] = ()


class TDXTrafficResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: str
    data_status: str
    events: list[TDXTrafficEvent] = []
    warning: str | None = None


class TDXProvider:
    """TDX OAuth and traffic adapter with explicit unavailable states."""

    token_url = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token"

    def __init__(
        self,
        client_id: str | None,
        client_secret: str | None,
        *,
        api_base_url: str = "https://tdx.transportdata.tw",
        traffic_endpoint: str = "/api/basic/v2/Road/Traffic/Live/City",
        timeout_seconds: float = 10.0,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._api_base_url = api_base_url.rstrip("/")
        self._traffic_endpoint = traffic_endpoint
        self._timeout_seconds = timeout_seconds
        self._access_token: str | None = None
        self._token_expires_at = 0.0

    def status(self) -> TDXProviderStatus:
        configured = bool(self._client_id and self._client_secret)
        return TDXProviderStatus(
            enabled=configured,
            status="healthy" if configured else "disabled",
            mode="TDX" if configured else "UNAVAILABLE",
        )

    def _get_access_token(self) -> str:
        if self._access_token and time.monotonic() < self._token_expires_at:
            return self._access_token
        if not self._client_id or not self._client_secret:
            raise RuntimeError("TDX_CREDENTIALS_MISSING")
        try:
            response = httpx.post(
                self.token_url,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                },
                timeout=self._timeout_seconds,
            )
            response.raise_for_status()
            body = response.json()
            token = body.get("access_token") if isinstance(body, dict) else None
            if not isinstance(token, str) or not token:
                raise RuntimeError("TDX_TOKEN_RESPONSE_INVALID")
            expires_in = body.get("expires_in", 300) if isinstance(body, dict) else 300
            self._access_token = token
            self._token_expires_at = time.monotonic() + max(30.0, float(expires_in) - 30.0)
            return token
        except RuntimeError:
            raise
        except httpx.TimeoutException as exc:
            raise RuntimeError("TDX_TOKEN_TIMEOUT") from exc
        except httpx.HTTPStatusError as exc:
            raise RuntimeError(f"TDX_TOKEN_HTTP_{exc.response.status_code}") from None
        except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
            raise RuntimeError("TDX_TOKEN_REQUEST_FAILED") from exc

    @staticmethod
    def _text(raw: dict[str, Any], *keys: str, default: str = "未命名事件") -> str:
        for key in keys:
            value = raw.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return default

    @staticmethod
    def _coordinate(raw: dict[str, Any], key: str) -> float | None:
        value = raw.get(key)
        return value if isinstance(value, (int, float)) else None

    @classmethod
    def _event(cls, raw: dict[str, Any], index: int) -> TDXTrafficEvent:
        position = raw.get("Position") or raw.get("position") or {}
        if not isinstance(position, dict):
            position = {}
        latitude = cls._coordinate(raw, "Latitude") or cls._coordinate(raw, "latitude")
        longitude = cls._coordinate(raw, "Longitude") or cls._coordinate(raw, "longitude")
        latitude = latitude or cls._coordinate(position, "Latitude") or cls._coordinate(
            position, "latitude"
        )
        longitude = longitude or cls._coordinate(position, "Longitude") or cls._coordinate(
            position, "longitude"
        )
        zones = raw.get("AffectedZoneCodes") or raw.get("affected_zone_codes") or ()
        if isinstance(zones, str):
            zones = (zones,)
        if not isinstance(zones, (list, tuple)):
            zones = ()
        return TDXTrafficEvent(
            event_id=cls._text(raw, "EventID", "event_id", "id", default=f"TDX-EVENT-{index:03d}"),
            event_type=cls._text(raw, "EventType", "event_type", "type", default="ROAD_EVENT"),
            description=cls._text(
                raw, "Description", "description", "Comment", default="TDX 道路事件"
            ),
            severity=cls._text(raw, "Severity", "severity", default="UNKNOWN"),
            city_code=cls._text(raw, "CityCode", "city_code", default="") or None,
            road_name=cls._text(raw, "RoadName", "road_name", "Road", default="") or None,
            latitude=latitude,
            longitude=longitude,
            affected_zone_codes=tuple(str(zone) for zone in zones if str(zone).strip()),
        )

    def fetch_traffic(self, *, city_codes: tuple[str, ...] = ("NWT", "TPE")) -> TDXTrafficResult:
        """Fetch a small live event projection without returning raw provider payloads."""
        if not self._client_id or not self._client_secret:
            return TDXTrafficResult(
                mode="UNAVAILABLE",
                data_status="CREDENTIALS_MISSING",
                warning="TDX_CREDENTIALS_MISSING",
            )
        try:
            token = self._get_access_token()
            response = httpx.get(
                f"{self._api_base_url}{self._traffic_endpoint}",
                params={"$format": "JSON"},
                headers={"Authorization": f"Bearer {token}"},
                timeout=self._timeout_seconds,
            )
            response.raise_for_status()
            body = response.json()
            rows = (
                body
                if isinstance(body, list)
                else body.get("value", [])
                if isinstance(body, dict)
                else []
            )
            events = [
                self._event(row, index)
                for index, row in enumerate(rows)
                if isinstance(row, dict)
            ]
            filtered = [
                event for event in events if not event.city_code or event.city_code in city_codes
            ]
            return TDXTrafficResult(
                mode="TDX", data_status="EVENTS_FOUND" if filtered else "NO_EVENTS", events=filtered
            )
        except RuntimeError as exc:
            return TDXTrafficResult(mode="UNAVAILABLE", data_status="ERROR", warning=str(exc))
        except httpx.TimeoutException:
            return TDXTrafficResult(
                mode="UNAVAILABLE", data_status="ERROR", warning="TDX_TRAFFIC_TIMEOUT"
            )
        except httpx.HTTPStatusError as exc:
            return TDXTrafficResult(
                mode="UNAVAILABLE",
                data_status="ERROR",
                warning=f"TDX_TRAFFIC_HTTP_{exc.response.status_code}",
            )
        except (httpx.HTTPError, TypeError, ValueError, KeyError):
            return TDXTrafficResult(
                mode="UNAVAILABLE", data_status="ERROR", warning="TDX_TRAFFIC_REQUEST_FAILED"
            )


def _distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    earth_radius_m = 6_371_000
    d_lat = radians(lat2 - lat1)
    d_lon = radians(lon2 - lon1)
    a = sin(d_lat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(d_lon / 2) ** 2
    return earth_radius_m * 2 * asin(sqrt(a))


def correlate_events_to_plan(
    dataset: Dataset, plan: PlanResult, events: list[TDXTrafficEvent], radius_m: float = 2_000
) -> list[dict[str, Any]]:
    """Match only explicit city/zone/coordinate evidence to route stops."""
    orders = {order.order_id: order for order in dataset.orders}
    zone_city_codes = {
        zone.zone_code: set(zone.tdx_city_codes) for zone in dataset.zones
    }
    risks: list[dict[str, Any]] = []
    for event in events:
        affected_routes: list[dict[str, Any]] = []
        for route in plan.routes:
            matched_orders: list[str] = []
            for stop in route.stops:
                order = orders.get(stop.order_id)
                if order is None:
                    continue
                city_match = bool(
                    event.city_code
                    and event.city_code
                    in ({order.city, order.zone_code} | zone_city_codes.get(order.zone_code, set()))
                )
                zone_match = bool(set(event.affected_zone_codes) & {order.zone_code})
                coordinate_match = bool(
                    event.latitude is not None
                    and event.longitude is not None
                    and _distance_m(
                        event.latitude, event.longitude, order.latitude, order.longitude
                    )
                    <= radius_m
                )
                if city_match or zone_match or coordinate_match:
                    matched_orders.append(order.order_id)
            if matched_orders:
                affected_routes.append(
                    {
                        "vehicle_id": route.vehicle_id,
                        "order_ids": matched_orders,
                        "match_basis": "TDX evidence",
                    }
                )
        if affected_routes:
            risks.append(
                {
                    "event_id": event.event_id,
                    "severity": event.severity,
                    "description": event.description,
                    "affected_routes": affected_routes,
                }
            )
    return risks
