import type { MapData, Plan } from '../types'

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

/**
 * 四台車的進度線：實心＝已送、方塊＝目前位置、空心＝未送。
 * 上車前全部是未送；已發車後隨時間軸推進。
 */
export function FleetRail({
  data,
  plan,
  activeVehicle,
  onSelectVehicle,
}: {
  data: MapData | null
  plan: Plan
  activeVehicle: string | null
  onSelectVehicle: (vehicleId: string | null) => void
}) {
  const routes = data?.routes ?? []
  if (routes.length === 0) return null

  return (
    <section className="fleet-rail" aria-label="車輛進度">
      <div className="fleet-rail-head">
        <span className="fleet-rail-title">車輛進度</span>
        <span className="fleet-rail-legend">
          <i className="legend-done" aria-hidden="true" />已送
          <i className="legend-now" aria-hidden="true" />目前
          <i className="legend-next" aria-hidden="true" />未送
        </span>
      </div>

      <div className="fleet-rail-grid">
        {routes.map((route) => {
          const vehicle = plan.vehicles.find((item) => item.vehicle_id === route.vehicle_id)
          const total = route.stops.length
          const done = route.stops.filter((stop) => stop.status === 'COMPLETED').length
          const selected = activeVehicle === route.vehicle_id

          return (
            <button
              key={route.vehicle_id}
              type="button"
              aria-pressed={selected}
              aria-label={`${route.vehicle_id} 進度 ${done} / ${total} 站`}
              className={selected ? 'fleet-row fleet-row-active' : 'fleet-row'}
              onClick={() => onSelectVehicle(selected ? null : route.vehicle_id)}
            >
              <span className="fleet-id">
                <i style={{ background: route.color }} aria-hidden="true" />
                {route.vehicle_id}
              </span>

              <span className="fleet-track">
                <span className="fleet-base" aria-hidden="true" />
                {total > 0 && (
                  <span
                    className="fleet-done"
                    style={{ width: pct(done / total), background: route.color }}
                    aria-hidden="true"
                  />
                )}
                {route.stops.map((stop, index) => {
                  const left = total > 1 ? (index / (total - 1)) * 100 : 0
                  const style =
                    stop.status === 'COMPLETED'
                      ? { left: `${left}%`, background: route.color, borderColor: route.color }
                      : stop.status === 'CURRENT'
                        ? { left: `${left}%`, borderColor: route.color }
                        : { left: `${left}%` }
                  return (
                    <span
                      key={stop.order_id}
                      className={`fleet-dot fleet-dot-${stop.status.toLowerCase()}`}
                      style={style}
                      title={stop.order_id}
                      aria-hidden="true"
                    />
                  )
                })}
              </span>

              <span className="fleet-meta">
                <strong>
                  {done}/{total}
                </strong>
                <span> 站</span>
                {vehicle && <span className="fleet-load"> · 載重 {pct(vehicle.load_utilization)}</span>}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
