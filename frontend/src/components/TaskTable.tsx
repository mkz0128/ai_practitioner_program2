import { useMemo, useState } from 'react'
import type { Plan, Stop } from '../types'

interface TaskTableProps {
  plan: Plan | null
  activeOrderId: string | null
  onSelectOrder: (orderId: string) => void
}

type TaskRow = Stop & { vehicleId: string; vehicleName: string }

export function TaskTable({ plan, activeOrderId, onSelectOrder }: TaskTableProps) {
  const [query, setQuery] = useState('')
  const [slot, setSlot] = useState<'ALL' | 'AM' | 'PM'>('ALL')
  const rows = useMemo<TaskRow[]>(
    () => plan?.vehicles.flatMap((vehicle) => vehicle.stops.map((stop) => ({ ...stop, vehicleId: vehicle.vehicle_id, vehicleName: vehicle.vehicle_name }))) ?? [],
    [plan],
  )
  const filtered = rows.filter((row) => {
    const matchesQuery = !query || `${row.order_id} ${row.location_label} ${row.vehicleId}`.toLowerCase().includes(query.toLowerCase())
    return matchesQuery && (slot === 'ALL' || row.time_slot === slot)
  })

  return (
    <section className="panel task-table-panel" aria-label="配送任務表">
      <div className="panel-heading">
        <div><div className="eyebrow">今日配送</div><h2>配送任務</h2><p>依方案順序檢視每一張已安排訂單</p></div>
        {plan && <span className="status-chip live">{plan.summary.assigned_order_count} 張已安排</span>}
      </div>
      <div className="panel-body task-table-body">
        <div className="table-toolbar">
          <label className="search-field"><span aria-hidden="true">⌕</span><input aria-label="搜尋配送任務" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋訂單、地點或車輛" /></label>
          <div className="filter-group" aria-label="時段篩選">
            {(['ALL', 'AM', 'PM'] as const).map((value) => <button type="button" key={value} className={`filter-pill ${slot === value ? 'active' : ''}`} onClick={() => setSlot(value)}>{value === 'ALL' ? '全部時段' : `${value} 時段`}</button>)}
          </div>
        </div>
        <div className="table-wrap task-table-wrap">
          <table>
            <thead><tr><th>訂單</th><th>配送地點</th><th>車輛</th><th>順序</th><th>時段</th><th>重量</th><th>狀態</th></tr></thead>
            <tbody>
              {!plan && <tr><td colSpan={7} className="empty-cell">請先上傳 Excel 並建立今日方案。</td></tr>}
              {plan && filtered.map((row) => <tr key={row.order_id} className={activeOrderId === row.order_id ? 'selected-row' : ''} onClick={() => onSelectOrder(row.order_id)}>
                <td><strong>{row.order_id}</strong><div className="muted">配送訂單</div></td><td>{row.location_label}</td><td>{row.vehicleId}<div className="muted">{row.vehicleName}</div></td><td>第 {row.sequence} 站</td><td><span className={`status-chip ${row.time_slot === 'AM' ? 'neutral' : 'simulated'}`}>{row.time_slot}</span></td><td>{row.order_weight_kg.toFixed(1)} kg</td><td><span className="status-chip live">已安排</span></td>
              </tr>)}
              {plan && !filtered.length && <tr><td colSpan={7} className="empty-cell">找不到符合條件的配送任務。</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
