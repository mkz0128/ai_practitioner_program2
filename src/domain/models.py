from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, computed_field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


class Priority(StrEnum):
    NORMAL = "NORMAL"
    HIGH = "HIGH"


class TimeSlot(StrEnum):
    MORNING = "MORNING"
    AFTERNOON = "AFTERNOON"
    EVENING = "EVENING"

    @classmethod
    def _missing_(cls, value: object) -> "TimeSlot | None":
        # Keep old demo payloads readable at the model boundary while all
        # validated data uses the v2 three-value representation.
        legacy_values = {"AM": cls.MORNING, "PM": cls.AFTERNOON}
        return legacy_values.get(value) if isinstance(value, str) else None


def normalize_time_slot(value: object) -> TimeSlot:
    if isinstance(value, TimeSlot):
        return value
    if not isinstance(value, str):
        raise TypeError("time_slot must be a string")
    return TimeSlot(value)


TimeSlotValue = Annotated[TimeSlot, BeforeValidator(normalize_time_slot)]


class VehicleStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    UNAVAILABLE = "UNAVAILABLE"


class Package(StrictModel):
    package_id: str = Field(min_length=1)
    order_id: str = Field(min_length=1)
    weight_kg: float = Field(gt=0)


class Order(StrictModel):
    order_id: str = Field(min_length=1)
    zone_code: str = Field(min_length=1)
    city: str = Field(min_length=1)
    district: str = Field(min_length=1)
    location_label: str = Field(min_length=1)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    time_slot: TimeSlotValue
    declared_package_count: int = Field(ge=1, le=3)
    priority: Priority = Priority.NORMAL
    note: str | None = None
    packages: tuple[Package, ...] = ()

    @computed_field  # type: ignore[prop-decorator]
    @property
    def total_weight_kg(self) -> float:
        return round(sum(package.weight_kg for package in self.packages), 3)


class Vehicle(StrictModel):
    vehicle_id: str = Field(min_length=1)
    vehicle_name: str = Field(min_length=1)
    max_load_kg: float = Field(gt=0)
    current_load_kg: float = Field(ge=0)
    service_zone_codes: tuple[str, ...] = ()
    depot_id: str = Field(min_length=1)
    status: VehicleStatus
    note: str | None = None


class Zone(StrictModel):
    zone_code: str = Field(min_length=1)
    zone_name: str = Field(min_length=1)
    covered_cities: tuple[str, ...] = ()
    covered_districts: tuple[str, ...] = ()
    center_latitude: float = Field(ge=-90, le=90)
    center_longitude: float = Field(ge=-180, le=180)
    tdx_city_codes: tuple[str, ...] = ()
    adjacent_zone_codes: tuple[str, ...] = ()
    enabled: bool


class Dataset(StrictModel):
    orders: tuple[Order, ...]
    packages: tuple[Package, ...]
    vehicles: tuple[Vehicle, ...]
    zones: tuple[Zone, ...]
    source_filename: str = "workbook.xlsx"
