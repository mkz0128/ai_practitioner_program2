import type { Plan } from '../types'

interface VehiclePanelProps {
  plan: Plan | null
  activeVehicle: string | null
  onSelectVehicle: (vehicleId: string) => void
}

export function VehiclePanel({ plan, activeVehicle, onSelectVehicle }: VehiclePanelProps) {
  return (
    <section className="panel vehicle-panel" aria-label="車輛與例外案件">
      <div className="panel-heading"><div><div className="eyebrow">配送資源</div><h2>車輛與例外案件</h2><p>點選車輛可同步地圖與路線</p></div>{plan && <span className={`status-chip ${plan.validation.valid ? 'live' : 'blocked'}`}>{plan.validation.valid ? 'Validator 通過' : '需人工複核'}</span>}</div>
      <div className="panel-body">
        {!plan && <p className="hint">建立方案後顯示車輛卡片與例外。</p>}
        <div className="vehicle-list vehicle-list-horizontal">
          {plan?.vehicles.map((vehicle) => <button className={`vehicle-card ${activeVehicle === vehicle.vehicle_id ? 'active' : ''}`} key={vehicle.vehicle_id} onClick={() => onSelectVehicle(vehicle.vehicle_id)}>
            <div className="vehicle-title"><span><i className="vehicle-status-dot" />{vehicle.vehicle_id}</span><span>{(vehicle.load_utilization * 100).toFixed(1)}%</span></div>
            <div className="vehicle-meta">{vehicle.vehicle_name} · {vehicle.order_count} 張訂單</div>
            <div className="progress"><span style={{ width: `${Math.min(100, vehicle.load_utilization * 100)}%` }} /></div>
            <div className="vehicle-stats"><span>{vehicle.planned_load_kg.toFixed(1)} / {vehicle.max_load_kg.toFixed(1)} kg</span><span>{vehicle.total_distance_m.toLocaleString()} m</span></div>
          </button>)}
        </div>
        {plan && plan.unassigned_orders.length > 0 && <div className="exception-list"><div className="exception"><span>⚠</span><div><strong>未安排訂單 {plan.unassigned_orders.length} 張</strong><br />{plan.unassigned_orders.map((orderId) => `${orderId}：${plan.unassigned_reasons[orderId] || '請查看 Validator evidence'}`).join('；')}</div></div></div>}
        {plan && Object.values(plan.validation.violations).some((count) => count > 0) && <div className="error-box">Validator 發現限制違規，方案不可確認。請檢查下方明細。</div>}
      </div>
    </section>
  )
}
