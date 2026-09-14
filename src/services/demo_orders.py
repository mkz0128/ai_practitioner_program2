from __future__ import annotations

from src.domain.models import Order, Package, Priority, TimeSlot


def get_demo_urgent_order(order_id: str) -> Order | None:
    """Return a documented synthetic urgent-order fixture, when one exists.

    This lookup is intentionally inside the deterministic tool boundary. It does
    not classify user intent; the language model must first select the urgent
    preview tool and provide the order ID. Arbitrary orders remain supported by
    the strict structured urgent-order tool.
    """
    def build_fixture(fixture_id: str) -> Order:
        return Order(
            order_id=fixture_id,
            # Keep the public demo stop near the existing Z1 service area but
            # away from every base-demo coordinate, so an insertion has a real
            # deterministic distance and duration cost.
            zone_code="Z1",
            city="新北市",
            district="板橋",
            location_label="示範臨時配送點",
            latitude=25.033664,
            longitude=121.448133,
            time_slot=TimeSlot.MORNING,
            declared_package_count=1,
            priority=Priority.HIGH,
            note="公開展示用合成訂單",
            packages=(
                Package(
                    package_id=f"PKG-{fixture_id}-01",
                    order_id=fixture_id,
                    weight_kg=2.0,
                ),
            ),
        )

    normalized_id = order_id.strip().upper()
    fixtures = {
        "ORD-041": build_fixture("ORD-041"),
        "URG-DEMO-041": build_fixture("URG-DEMO-041"),
    }
    return fixtures.get(normalized_id)
