"""Generate the deterministic v2 demo workbooks.

The workbooks intentionally contain only synthetic data.  Both files share the
same vehicles, zones, and depot; their order distributions are different so
the relaxed and tight demo paths exercise different planning outcomes.
"""

from __future__ import annotations

import random
import shutil
from pathlib import Path

from openpyxl import Workbook

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "data" / "samples"

ORDER_HEADERS = [
    "order_id",
    "zone_code",
    "city",
    "district",
    "location_label",
    "latitude",
    "longitude",
    "time_slot",
    "declared_package_count",
    "priority",
    "note",
]
PACKAGE_HEADERS = ["package_id", "order_id", "weight_kg"]
VEHICLE_HEADERS = [
    "vehicle_id",
    "vehicle_name",
    "max_load_kg",
    "current_load_kg",
    "service_zone_codes",
    "depot_id",
    "status",
    "note",
]
ZONE_HEADERS = [
    "zone_code",
    "zone_name",
    "covered_cities",
    "covered_districts",
    "center_latitude",
    "center_longitude",
    "tdx_city_codes",
    "adjacent_zone_codes",
    "enabled",
]

DISTRICT_CENTROIDS = {
    "北投區": (25.132, 121.501),
    "士林區": (25.093, 121.525),
    "內湖區": (25.069, 121.588),
    "南港區": (25.055, 121.607),
    "松山區": (25.058, 121.558),
    "中山區": (25.064, 121.533),
    "大同區": (25.063, 121.513),
    "萬華區": (25.028, 121.497),
    "中正區": (25.032, 121.518),
    "大安區": (25.026, 121.543),
    "信義區": (25.033, 121.571),
    "文山區": (24.989, 121.570),
    "板橋區": (25.011, 121.459),
    "新莊區": (25.036, 121.450),
    "三重區": (25.061, 121.487),
    "蘆洲區": (25.085, 121.473),
    "中和區": (24.999, 121.498),
    "永和區": (25.008, 121.515),
    "土城區": (24.972, 121.443),
    "新店區": (24.967, 121.541),
    "汐止區": (25.064, 121.655),
}

DISTRICT_CITIES = {
    "北投": "臺北市",
    "士林": "臺北市",
    "內湖": "臺北市",
    "南港": "臺北市",
    "松山": "臺北市",
    "中山": "臺北市",
    "大同": "臺北市",
    "萬華": "臺北市",
    "中正": "臺北市",
    "大安": "臺北市",
    "信義": "臺北市",
    "文山": "臺北市",
    "板橋": "新北市",
    "新莊": "新北市",
    "三重": "新北市",
    "蘆洲": "新北市",
    "中和": "新北市",
    "永和": "新北市",
    "土城": "新北市",
    "新店": "新北市",
    "汐止": "新北市",
}


def _district_points(districts: tuple[str, ...]) -> tuple[tuple[float, float], ...]:
    return tuple(DISTRICT_CENTROIDS[f"{district}區"] for district in districts)


def _zone_center(points: tuple[tuple[float, float], ...]) -> tuple[float, float]:
    return (
        sum(point[0] for point in points) / len(points),
        sum(point[1] for point in points) / len(points),
    )


def _nearest_district(latitude: float, longitude: float) -> str:
    district, _ = min(
        DISTRICT_CENTROIDS.items(),
        key=lambda item: (latitude - item[1][0]) ** 2
        + (0.9 * (longitude - item[1][1])) ** 2,
    )
    return district.removesuffix("區")


# Z codes stay stable in the API. Their geographic meaning is the fixed
# nearest-centroid grouping used by the competition demo.
ZONE_DATA = {
    "Z1": {
        "name": "北區",
        "cities": ("臺北市",),
        "districts": ("北投", "士林", "大同", "中山"),
        "points": _district_points(("北投", "士林", "大同", "中山")),
        "tdx": "TPE",
        "adjacent": "Z2|Z3",
    },
    "Z2": {
        "name": "東區",
        "cities": ("臺北市",),
        "districts": ("內湖", "南港", "松山", "信義"),
        "points": _district_points(("內湖", "南港", "松山")),
        "tdx": "TPE",
        "adjacent": "Z1|Z3|Z5",
    },
    "Z3": {
        "name": "中區",
        "cities": ("臺北市",),
        "districts": ("中正", "大安", "信義", "萬華"),
        "points": _district_points(("中正", "大安", "信義", "萬華")),
        "tdx": "TPE",
        "adjacent": "Z1|Z2|Z4|Z5",
    },
    "Z4": {
        "name": "西區",
        "cities": ("新北市",),
        "districts": ("三重", "新莊", "板橋"),
        "points": _district_points(("三重", "新莊", "板橋")),
        "tdx": "NWT",
        "adjacent": "Z1|Z5",
    },
    "Z5": {
        "name": "南區",
        "cities": ("新北市", "臺北市"),
        "districts": ("中和", "永和", "文山", "新店"),
        "points": _district_points(("中和", "永和", "文山", "新店")),
        "tdx": "NWT|TPE",
        "adjacent": "Z3|Z4",
    },
}

DISTRICT_SEQUENCES = {
    "Z1": ("北投", "士林", "大同", "中山", "士林", "大同", "北投", "士林", "大同", "士林"),
    "Z2": (
        "南港", "內湖", "松山", "南港", "內湖", "南港", "內湖", "松山",
        "內湖", "南港", "內湖", "南港", "內湖", "南港", "信義",
    ),
    "Z3": ("大安", "大安", "中正", "中正", "萬華", "大安", "中正", "萬華", "大安", "萬華"),
    "Z4": ("板橋", "板橋", "三重", "板橋", "新莊", "三重", "板橋", "板橋"),
    "Z5": ("永和", "文山", "永和", "文山", "新店", "中和", "新店", "中和"),
}

TIGHT_DISTRICT_SEQUENCES = {
    **DISTRICT_SEQUENCES,
    # The tight route deliberately crosses the southern districts in a
    # different deterministic order, making the measured Z5 service burden
    # visible without changing the fixed centroid mapping.
    "Z2": (
        "南港", "內湖", "內湖", "南港", "內湖", "南港", "內湖", "松山",
        "內湖", "南港", "內湖", "南港", "內湖", "南港", "信義",
    ),
    "Z5": ("新店", "中和", "文山", "永和", "新店", "中和", "文山"),
}

VEHICLES = (
    # Eligibility keeps neighbouring vehicles as legal fallbacks for a hard
    # rule trial; planner.py applies the fixed geographic preference for the
    # normal plan so the displayed routes remain area-coherent.
    ("VEH-001", "配送車 1", 120, 0, "Z3|Z4|Z5", "西區、南區主責；中區備援車"),
    (
        "VEH-002",
        "配送車 2",
        100,
        0,
        "Z2|Z3|Z4|Z5",
        "中區主責；東區規則重排第二備援；西區與南區備援車",
    ),
    ("VEH-003", "配送車 3", 160, 22, "Z1|Z2", "東區主責；北區備援車；保留身體負荷示範"),
    ("VEH-004", "配送車 4", 110, 0, "Z1|Z2|Z3", "北區主責；東區與中區相鄰備援車"),
)

TIME_SLOTS = ("MORNING", "AFTERNOON", "EVENING")

# Keep the relaxed fixture compatible with the importer/mapping regression
# contract while retaining the geographic redesign.  The totals are explicit
# synthetic fixture data so route capacity remains balanced after regrouping.
RELAXED_TOTAL_WEIGHT_OVERRIDES = {
    **{index: 5.0 for index in range(1, 11)},
    **{index: 7.5 for index in range(11, 25)},
    25: 6.9,
    **{index: 6.4 for index in range(26, 35)},
    35: 5.6,
    **{index: 5.2 for index in range(36, 43)},
    43: 4.8,
    44: 3.8,
    45: 3.8,
    46: 3.8,
    47: 3.8,
    48: 3.8,
    49: 3.8,
    50: 2.7,
}
TIGHT_TOTAL_WEIGHT_OVERRIDES = {
    **{index: 4.3 for index in range(2, 11)},
    11: 6.0,
    12: 2.0,
    13: 2.0,
    16: 2.0,
    18: 2.0,
    19: 2.0,
    20: 2.0,
    21: 2.0,
    22: 2.0,
    23: 2.0,
    24: 2.0,
    25: 4.0,
}
TIGHT_EXTRA_WEIGHT_OVERRIDES = {
    # Keep the east route near capacity in the baseline while leaving a
    # strict 5 kg trial genuinely infeasible and the 20 kg trial feasible.
    # These are synthetic package weights, not a solver-side exception.
    1: 6.0,
    35: 6.0,
}


def _make_workbook(
    output_path: Path,
    seed: int,
    zone_sequence: tuple[str, ...],
    tight: bool,
) -> None:
    rng = random.Random(seed)
    workbook = Workbook()
    orders_sheet = workbook.active
    orders_sheet.title = "orders"
    packages_sheet = workbook.create_sheet("packages")
    vehicles_sheet = workbook.create_sheet("vehicles")
    zones_sheet = workbook.create_sheet("zones")

    orders_sheet.append(ORDER_HEADERS)
    packages_sheet.append(PACKAGE_HEADERS)
    vehicles_sheet.append(VEHICLE_HEADERS)
    zones_sheet.append(ZONE_HEADERS)

    for vehicle_id, vehicle_name, max_load, current_load, service_zones, note in VEHICLES:
        vehicles_sheet.append(
            [
                vehicle_id,
                vehicle_name,
                max_load,
                current_load,
                service_zones,
                "DEPOT-001",
                "AVAILABLE",
                note,
            ]
        )

    for zone_code, data in ZONE_DATA.items():
        cities = data["cities"] if "cities" in data else (data["city"],)
        zones_sheet.append(
            [
                zone_code,
                data["name"],
                "|".join(cities),
                "|".join(data["districts"]),
                _zone_center(data["points"])[0],
                _zone_center(data["points"])[1],
                data["tdx"],
                data["adjacent"],
                True,
            ]
        )

    tight_zone_overrides = {14: "Z2", 15: "Z2", 17: "Z2"}
    zone_occurrences: dict[str, int] = {}
    for index, zone_code in enumerate(zone_sequence, start=1):
        if tight:
            zone_code = tight_zone_overrides.get(index, zone_code)
        # Keep high-priority stops inside the first time-window group of their
        # vehicle so the deterministic route remains geographically ordered.
        priority = "HIGH" if index in {7, 19, 31} else "NORMAL"
        generated_package_count = 1 + rng.randrange(3)
        package_count = generated_package_count
        relaxed_weight_ranges = {
            "Z1": (5.5, 7.0),
            "Z2": (8.0, 10.0),
            "Z3": (5.5, 7.0),
            "Z4": (5.5, 6.5),
            "Z5": (3.5, 4.5),
        }
        tight_weight_ranges = {
            "Z1": (6.0, 8.0),
            "Z2": (1.5, 3.5),
            "Z3": (5.5, 7.5),
            "Z4": (3.2, 4.8),
            "Z5": (2.5, 3.5),
        }
        low, high = (tight_weight_ranges if tight else relaxed_weight_ranges)[zone_code]
        total_weight = round(low + rng.random() * (high - low), 1)

        if not tight:
            # Preserve the long-standing 99-package mapping fixture shape so
            # importer regressions continue to exercise the same cell paths.
            package_count = {1: 1, 2: 1, 3: 3}.get(index, 2)
            total_weight = RELAXED_TOTAL_WEIGHT_OVERRIDES[index]

        if tight:
            # Keep the three F2 demo orders in the same Z2 service area and
            # evening window. They are single-package orders in the 22-28 kg
            # band, so the strict 20 kg rule can move exactly these orders
            # without creating a second data source or changing the fixed seed.
            medium_weight_overrides = {14: 22.0, 15: 22.0, 17: 22.0}
            light_route_overrides = {28: 4.5, 29: 4.5, 30: 4.5}
            if index in TIGHT_TOTAL_WEIGHT_OVERRIDES:
                package_count = 1
                total_weight = TIGHT_TOTAL_WEIGHT_OVERRIDES[index]
            if index in TIGHT_EXTRA_WEIGHT_OVERRIDES:
                total_weight = TIGHT_EXTRA_WEIGHT_OVERRIDES[index]
            if index in medium_weight_overrides:
                package_count = 1
                total_weight = medium_weight_overrides[index]
            elif index in light_route_overrides:
                package_count = 1
                total_weight = light_route_overrides[index]
            elif zone_code == "Z2":
                # The east-area tight route intentionally contains light
                # orders around the three medium F2 examples. Keep them as a
                # single package so the generated split never creates a
                # non-positive package weight.
                package_count = 1

        if tight and index == 41:
            # This is the deterministic heavy Z2 order used by F1-14. It is
            # in the east service area and makes the body-load rule visible.
            zone_code = "Z2"
            package_count = 1
            total_weight = 45.0
        if tight and index == 50:
            # No vehicle can legally carry this single package.  Keeping this
            # as an order, rather than dropping it in the generator, exercises
            # the planner's deterministic UNASSIGNABLE path.
            zone_code = "Z5"
            package_count = 1
            total_weight = 170.0

        data = ZONE_DATA[zone_code]
        occurrence = zone_occurrences.get(zone_code, 0)
        district_sequence = (
            TIGHT_DISTRICT_SEQUENCES if tight else DISTRICT_SEQUENCES
        )[zone_code]
        district = district_sequence[min(occurrence, len(district_sequence) - 1)]
        zone_occurrences[zone_code] = occurrence + 1
        base_latitude, base_longitude = DISTRICT_CENTROIDS[f"{district}區"]
        # Keep every generated coordinate in its centroid's district. The
        # small deterministic offset prevents all stops in one district from
        # occupying the exact same map pixel while preserving nearest-centroid
        # classification.
        offset = ((index % 3) - 1) * 0.00035
        latitude = round(base_latitude + offset, 6)
        longitude = round(base_longitude + offset * 0.9, 6)
        district = _nearest_district(latitude, longitude)
        city = DISTRICT_CITIES[district]
        time_slot = {
            "Z1": "MORNING",
            "Z2": "MORNING",
            "Z3": "AFTERNOON",
            "Z4": "AFTERNOON",
            "Z5": "EVENING",
        }[zone_code]
        if tight and index == 41:
            time_slot = "AFTERNOON"
        if tight and index == 50:
            time_slot = "EVENING"

        order_id = f"ORD-{index:03d}"
        orders_sheet.append(
            [
                order_id,
                zone_code,
                city,
                district,
                f"{district}示範配送點 {index:02d}",
                latitude,
                longitude,
                time_slot,
                package_count,
                priority,
                f"seed={seed}; synthetic v2 demo fixture",
            ]
        )

        if not tight:
            # Consume the same random draws as the original generated package
            # count, but split deterministically after changing the fixture
            # shape.  This keeps later order totals stable for the fixed seed.
            for _ in range(generated_package_count - 1):
                rng.random()
            base_weight = round(total_weight / package_count, 1)
            package_weights = [base_weight] * (package_count - 1)
            package_weights.append(
                round(total_weight - sum(package_weights), 1)
            )
        elif package_count == 1:
            package_weights = (total_weight,)
        else:
            remaining = total_weight
            package_weights = []
            for package_index in range(package_count - 1):
                minimum_for_rest = 1.0 * (package_count - package_index - 1)
                maximum_for_current = remaining - minimum_for_rest
                weight = round(min(maximum_for_current, 1.0 + rng.random() * 4.0), 1)
                package_weights.append(weight)
                remaining = round(remaining - weight, 1)
            package_weights.append(remaining)

        for package_index, weight in enumerate(package_weights, start=1):
            packages_sheet.append([f"PKG-{index:03d}-{package_index:02d}", order_id, weight])

    for sheet in workbook.worksheets:
        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = sheet.dimensions
        sheet.column_dimensions["A"].width = 18

    output_path.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(output_path)


def main() -> None:
    # The zone order is fixed; only the generated point, package, priority, and
    # time-slot details use the seed.  This makes fixture differences deliberate
    # and keeps the shared vehicle/zone/depot contract obvious.
    relaxed_zones = ("Z1",) * 10 + ("Z2",) * 14 + ("Z3",) * 10 + ("Z4",) * 8 + ("Z5",) * 8
    tight_zone_list = list(relaxed_zones)
    tight_zone_list[40], tight_zone_list[42] = tight_zone_list[42], tight_zone_list[40]
    tight_zones = tuple(tight_zone_list)
    generated_files = (
        OUTPUT_DIR / "demo-50-relaxed.xlsx",
        OUTPUT_DIR / "demo-50-tight.xlsx",
    )
    _make_workbook(generated_files[0], 260905, relaxed_zones, False)
    _make_workbook(generated_files[1], 260906, tight_zones, True)
    public_dir = ROOT / "frontend" / "public"
    public_dir.mkdir(parents=True, exist_ok=True)
    for workbook_path in generated_files:
        shutil.copyfile(workbook_path, public_dir / workbook_path.name)
    print("created=data/samples/demo-50-relaxed.xlsx seed=260905 orders=50")
    print("created=data/samples/demo-50-tight.xlsx seed=260906 orders=50")


if __name__ == "__main__":
    main()
