from __future__ import annotations

from src.domain.models import Order, Package, Priority


def get_demo_urgent_order(order_id: str) -> Order | None:
    """Return a documented synthetic urgent-order fixture, when one exists.

    This lookup is intentionally inside the deterministic tool boundary. It does
    not classify user intent; the language model must first select the urgent
    preview tool and provide the order ID. Arbitrary orders remain supported by
    the strict structured urgent-order tool.
    """
    fixtures = {
        "ORD-041": Order(
            order_id="ORD-041",
            zone_code="Z4",
            city="臺北市",
            district="信義",
            location_label="示範臨時配送點",
            latitude=25.033,
            longitude=121.565,
            time_slot="PM",
            declared_package_count=1,
            priority=Priority.HIGH,
            note="公開展示用合成訂單",
            packages=(
                Package(
                    package_id="PKG-041-01",
                    order_id="ORD-041",
                    weight_kg=2.0,
                ),
            ),
        )
    }
    return fixtures.get(order_id.strip().upper())
