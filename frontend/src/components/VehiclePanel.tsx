import { useState } from 'react'
import type { Plan } from '../types'

interface VehiclePanelProps {
  plan: Plan | null
  activeVehicle: string | null
  onSelectVehicle: (vehicleId: string) => void
  onReassignPreview?: (orderId: string, targetVehicleId: string) => void
}

export function VehiclePanel({ plan, activeVehicle, onSelectVehicle, onReassignPreview }: VehiclePanelProps) {
  const [draggedOrder, setDraggedOrder] = useState<string | null>(null)
  const [expandedVehicles, setExpandedVehicles] = useState<Record<string, boolean>>({})
  const vehicleIds = plan?.vehicles.map((vehicle) => vehicle.vehicle_id) ?? []
  const humanReason = (reason: string | undefined) => reason === 'UNASSIGNABLE'
    ? '可服務此區域的車輛目前沒有足夠載重或合法時段。'
    : reason || '目前條件不足，請交由調度人員檢查。'
  return (
    <section className="panel vehicle-panel" aria-label="車輛與需要處理的訂單">
      <div className="panel-heading"><h2>車輛與需要處理的訂單</h2>{plan && <span className={`status-chip ${plan.rule_check.passed ? 'live' : 'blocked'}`}>{plan.rule_check.passed ? '方案檢查通過' : '方案檢查未通過'}</span>}</div>
      <div className="panel-body">
        {!plan && <p className="hint">建立方案後會顯示每台車的載重、任務與可調整項目。</p>}
        <div className="vehicle-list vehicle-list-horizontal">
          {plan?.vehicles.map((vehicle) => <article className={`vehicle-card ${activeVehicle === vehicle.vehicle_id ? 'active' : ''}`} key={vehicle.vehicle_id} onDragOver={(event) => { event.preventDefault() }} onDrop={(event) => { event.preventDefault(); const orderId = draggedOrder || event.dataTransfer.getData('text/plain'); if (orderId) onReassignPreview?.(orderId, vehicle.vehicle_id); setDraggedOrder(null) }}>
            <button type="button" className="vehicle-select" onClick={() => onSelectVehicle(vehicle.vehicle_id)}><span className="vehicle-title"><span><i className="vehicle-status-dot" />{vehicle.vehicle_id}</span><span>{(vehicle.load_utilization * 100).toFixed(1)}%</span></span></button>
            <div className="vehicle-meta">{vehicle.vehicle_name} · {vehicle.order_count} 張訂單</div>
            <div className="progress"><span style={{ width: `${Math.min(100, vehicle.load_utilization * 100)}%` }} /></div>
            <div className="vehicle-stats"><span>{vehicle.planned_load_kg.toFixed(1)} / {vehicle.max_load_kg.toFixed(1)} kg</span><span>{vehicle.total_distance_m.toLocaleString()} m</span></div>
            <div className="vehicle-orders" aria-label={`${vehicle.vehicle_id} 訂單`}>
              {vehicle.stops.slice(0, expandedVehicles[vehicle.vehicle_id] ? vehicle.stops.length : 6).map((stop) => <div key={stop.order_id} className="order-move-row" draggable onDragStart={(event) => { setDraggedOrder(stop.order_id); event.dataTransfer.setData('text/plain', stop.order_id) }}><span className="order-chip">{stop.order_id}</span><select aria-label={`將 ${stop.order_id} 移至其他車輛`} defaultValue="" onChange={(event) => { if (event.target.value) onReassignPreview?.(stop.order_id, event.target.value); event.currentTarget.value = '' }}><option value="">移至其他車輛</option>{vehicleIds.filter((id) => id !== vehicle.vehicle_id).map((id) => <option key={id} value={id}>{id}</option>)}</select></div>)}
              {vehicle.stops.length > 6 && <button type="button" className="expand-orders" onClick={() => setExpandedVehicles((current) => ({ ...current, [vehicle.vehicle_id]: !current[vehicle.vehicle_id] }))}>{expandedVehicles[vehicle.vehicle_id] ? '收合訂單' : `查看全部 ${vehicle.stops.length} 張訂單`}</button>}
              {vehicle.stops.length === 0 && <span className="unused-reason">{vehicle.unused_reason || '此車目前沒有配送任務。'}</span>}
            </div>
          </article>)}
        </div>
        {plan && plan.unassigned_orders.length > 0 && <div className="exception-list">{plan.unassigned_orders.map((orderId) => <div className="exception" key={orderId}><span>⚠</span><div><strong>{orderId} 目前無法安排</strong><p>{humanReason(plan.unassigned_reasons[orderId])}</p><small>建議：預覽重新安排，或交由調度人員處理。</small></div></div>)}</div>}
        {plan && !plan.rule_check.passed && <div className="error-box">方案仍有載重、區域、重複或時段問題，目前不可確認。</div>}
      </div>
    </section>
  )
}
