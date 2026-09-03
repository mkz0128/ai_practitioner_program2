import type { MapData, Plan } from '../types'

interface RouteTaskListProps {
  data: MapData | null
  plan: Plan | null
  activeVehicle: string | null
  onSelectVehicle: (vehicleId: string | null) => void
  onSelectOrder: (orderId: string) => void
}

export function RouteTaskList({ data, plan, activeVehicle, onSelectVehicle, onSelectOrder }: RouteTaskListProps) {
  const routes = data?.routes.filter((route) => !activeVehicle || route.vehicle_id === activeVehicle) ?? []
  return <aside className="panel route-task-panel" aria-label="路線任務清單">
    <div className="panel-heading"><div><div className="eyebrow">即時檢視</div><h2>配送任務</h2><p>{routes.reduce((sum, route) => sum + route.stops.length, 0)} 個站點 · 點選以聚焦</p></div><span className="status-chip simulated">預覽模式</span></div>
    <div className="route-list-body">
      {routes.map((route) => {
        const vehicle = plan?.vehicles.find((item) => item.vehicle_id === route.vehicle_id)
        return <div className={`route-task-group ${activeVehicle === route.vehicle_id ? 'active' : ''}`} key={route.vehicle_id}>
          <button type="button" className="route-group-header" onClick={() => onSelectVehicle(activeVehicle === route.vehicle_id ? null : route.vehicle_id)}><span className="route-color" style={{ background: route.color }} /><strong>{route.vehicle_id}</strong><span>{vehicle?.load_utilization ? `${(vehicle.load_utilization * 100).toFixed(0)}%` : '—'}</span></button>
          <div className="route-stops">{route.stops.map((stop) => <button type="button" key={stop.order_id} className="route-stop" onClick={() => onSelectOrder(stop.order_id)}><span className="stop-number">{stop.sequence}</span><span><strong>{stop.order_id}</strong><small>{stop.eta} · {stop.order_id === 'DEPOT-001' ? '配送中心' : '配送站點'}</small></span><span className="status-chip live">途中</span></button>)}</div>
        </div>
      })}
      {!routes.length && <div className="empty-detail"><span>⌖</span><p>建立方案後顯示路線任務。</p></div>}
    </div>
  </aside>
}
