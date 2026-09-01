from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class TDXProviderStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool
    status: str
    mode: str


class TDXProvider:
    """P0 health/status adapter; road-to-zone enrichment remains P1."""

    def __init__(self, client_id: str | None, client_secret: str | None) -> None:
        self._configured = bool(client_id and client_secret)

    def status(self) -> TDXProviderStatus:
        return TDXProviderStatus(
            enabled=self._configured,
            status="healthy" if self._configured else "disabled",
            mode="TDX" if self._configured else "UNAVAILABLE",
        )
