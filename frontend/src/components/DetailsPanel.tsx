import { useMemo, useState } from 'react'
import type { Plan, UrgentPreview } from '../types'

interface DetailsPanelProps {
  plan: Plan | null
  preview: UrgentPreview | null
  onPreview: () => Promise<void>
  onConfirm: () => Promise<void>
  busy: boolean
  activeOrderId?: string | null
  onSelectOrder?: (orderId: string) => void
}

function violationLabel(key: string): string {
  const labels: Record<string, string> = { overload: '超載', cross_zone: '跨服務區', duplicate: '重複指派', time_window: '時段違規' }
  return labels[key] || key
}

export function DetailsPanel({ plan, preview, onPreview, onConfirm, busy, activeOrderId, onSelectOrder }: DetailsPanelProps) {
  const [tab, setTab] = useState<'routes' | 'exceptions' | 'preview'>('routes')
  const stops = useMemo(() => plan?.vehicles.flatMap((vehicle) => vehicle.stops.map((stop) => ({ ...stop, vehicleId: vehicle.vehicle_id }))) || [], [plan])
  return (
    <section className="panel bottom-panel" aria-label="配送明細">
      <div className="tabs">
        <button className={`tab ${tab === 'routes' ? 'active' : ''}`} onClick={() => setTab('routes')}>配送順序與理由</button>
        <button className={`tab ${tab === 'exceptions' ? 'active' : ''}`} onClick={() => setTab('exceptions')}>例外案件</button>
        <button className={`tab ${tab === 'preview' ? 'active' : ''}`} onClick={() => setTab('preview')}>ORD-041 插單差異</button>
      </div>
      <div className="panel-body">
        {tab === 'routes' && <div className="table-wrap"><table><thead><tr><th>車輛</th><th>順序</th><th>訂單</th><th>地點</th><th>時段</th><th>重量</th><th>ETA</th><th>推薦理由（證據）</th></tr></thead><tbody>{stops.length ? stops.map((stop) => <tr key={`${stop.vehicleId}-${stop.order_id}`} className={activeOrderId === stop.order_id ? 'selected-row' : ''} onClick={() => onSelectOrder?.(stop.order_id)}><td>{stop.vehicleId}</td><td>{stop.sequence}</td><td><strong>{stop.order_id}</strong></td><td>{stop.location_label}</td><td><span className="status-chip neutral">{stop.time_slot}</span></td><td>{stop.order_weight_kg.toFixed(1)} kg</td><td>{stop.eta}</td><td className="reason">{stop.reason?.summary || '無可用理由'}<br /><span className="hint">{stop.reason ? `服務區域符合 · 時段合法 · ${Number(stop.reason.evidence.leg_distance_m ?? stop.leg_distance_m).toLocaleString()} m` : ''}</span></td></tr>) : <tr><td colSpan={8} className="empty-cell">尚未建立配送方案。</td></tr>}</tbody></table></div>}
        {tab === 'exceptions' && <div>{plan?.unassigned_orders.length ? <div className="exception-list">{plan.unassigned_orders.map((orderId) => <div className="exception" key={orderId}><span>⚠</span><div><strong>{orderId}</strong><br />{plan.unassigned_reasons[orderId] || '未提供原因'}</div></div>)}</div> : <div className="success-box">目前沒有未安排訂單；各車均通過獨立 Validator。</div>}{plan && <div className="validation-summary"><strong>{plan.validation.valid ? 'Validator 通過' : '需要人工複核'}</strong>{Object.entries(plan.validation.violations).map(([key, count]) => <span key={key}>{violationLabel(key)} {count}</span>)}</div>}</div>}
        {tab === 'preview' && <div>{!preview && <div className="hint">按下「預覽 ORD-041」取得後端計算的插單前後差異。</div>}{preview && <><div className="success-box">模式：{preview.mode}（{preview.mode === 'MINIMAL_CHANGE' ? '最小變動插入' : '完整重新排程'}） · 影響 {preview.affected_vehicle_count} 台車 · 換車 {preview.moved_order_count} 張</div><div className="details-grid"><div className="comparison-card"><strong>插單前</strong><span>{preview.before.assigned_order_count} 張已安排 · {preview.before.assigned_weight_kg.toFixed(1)} kg</span><small>{preview.before.vehicles.map((vehicle) => `${vehicle.vehicle_id} ${vehicle.planned_load_kg.toFixed(1)} kg`).join(' · ')}</small></div><div className="comparison-card"><strong>插單後</strong><span>{preview.after.assigned_order_count} 張已安排 · {preview.after.assigned_weight_kg.toFixed(1)} kg</span><small>{preview.after.vehicles.map((vehicle) => `${vehicle.vehicle_id} ${vehicle.planned_load_kg.toFixed(1)} kg`).join(' · ')}</small></div></div><table className="diff-table"><tbody><tr><th>換車</th><td>{preview.diff.reassigned_orders.length} 張</td></tr><tr><th>順序變更</th><td>{preview.diff.sequence_changes.length} 筆</td></tr><tr><th>載重變更</th><td>{preview.diff.vehicle_load_changes.length} 台車</td></tr><tr><th>距離差異</th><td className={preview.diff.total_distance_delta_m > 0 ? 'delta-positive' : ''}>{preview.diff.total_distance_delta_m > 0 ? '+' : ''}{preview.diff.total_distance_delta_m} m</td></tr><tr><th>時間差異</th><td className={preview.diff.total_duration_delta_s > 0 ? 'delta-positive' : ''}>{preview.diff.total_duration_delta_s > 0 ? '+' : ''}{preview.diff.total_duration_delta_s} 秒</td></tr></tbody></table></>}</div>}
        {plan && <div className="approval-bar"><span className="hint">{plan.state === 'CONFIRMED' ? '此方案已由調度員確認。' : '方案仍為 PROPOSED，未經確認不得 Dispatch。'}</span><span><button className="control-button secondary" onClick={() => void onPreview()} disabled={busy || plan.state === 'DISPATCHED'}>預覽 ORD-041</button>{preview && <button className="control-button" onClick={() => void onConfirm()} disabled={busy || plan.state === 'DISPATCHED'} style={{ marginLeft: 7 }}>人工確認預覽</button>}</span></div>}
      </div>
    </section>
  )
}
