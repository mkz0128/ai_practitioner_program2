import { useMemo, useState } from 'react'
import type { Plan, UrgentPreview } from '../types'

interface DetailsPanelProps {
  plan: Plan | null
  preview: UrgentPreview | null
  onPreview: () => Promise<void>
  onConfirm: () => Promise<void>
  busy: boolean
}

export function DetailsPanel({ plan, preview, onPreview, onConfirm, busy }: DetailsPanelProps) {
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
        {tab === 'routes' && <div className="table-wrap"><table><thead><tr><th>車輛</th><th>順序</th><th>訂單</th><th>地點</th><th>時段</th><th>重量</th><th>ETA</th><th>推薦理由（證據）</th></tr></thead><tbody>{stops.length ? stops.map((stop) => <tr key={`${stop.vehicleId}-${stop.order_id}`}><td>{stop.vehicleId}</td><td>{stop.sequence}</td><td>{stop.order_id}</td><td>{stop.location_label}</td><td>{stop.time_slot}</td><td>{stop.order_weight_kg.toFixed(1)} kg</td><td>{stop.eta}</td><td className="reason">{stop.reason?.summary || '無可用理由'}<br /><span className="hint">{stop.reason ? `區域 ${String(stop.reason.evidence.vehicle_zone_eligible)} · 時段 ${String(stop.reason.evidence.time_window_legal)} · 距離 ${String(stop.reason.evidence.leg_distance_m)}m` : ''}</span></td></tr>) : <tr><td colSpan={8}>尚未建立配送方案。</td></tr>}</tbody></table></div>}
        {tab === 'exceptions' && <div>{plan?.unassigned_orders.length ? <div className="exception-list">{plan.unassigned_orders.map((orderId) => <div className="exception" key={orderId}><span>⚠</span><div><strong>{orderId}</strong><br />{plan.unassigned_reasons[orderId] || '未提供原因'}</div></div>)}</div> : <div className="success-box">目前沒有未安排訂單；可查看各車 Validator 結果。</div>}{plan && <pre className="evidence">{JSON.stringify(plan.validation, null, 2)}</pre>}</div>}
        {tab === 'preview' && <div>{!preview && <div className="hint">按下「預覽 ORD-041」取得後端計算的 before／after 差異。</div>}{preview && <><div className="success-box">模式：{preview.mode} · 影響車輛：{preview.affected_vehicle_count} · 換車訂單：{preview.moved_order_count}</div><div className="details-grid"><div><strong>插單前</strong><pre className="evidence">{JSON.stringify({ assigned: preview.before.assigned_order_count, weight: preview.before.assigned_weight_kg, vehicles: preview.before.vehicles }, null, 2)}</pre></div><div><strong>插單後</strong><pre className="evidence">{JSON.stringify({ assigned: preview.after.assigned_order_count, weight: preview.after.assigned_weight_kg, vehicles: preview.after.vehicles }, null, 2)}</pre></div></div><table><tbody><tr><th>換車</th><td>{preview.diff.reassigned_orders.length} 張</td></tr><tr><th>順序變更</th><td>{preview.diff.sequence_changes.length} 筆</td></tr><tr><th>距離差異</th><td className={preview.diff.total_distance_delta_m > 0 ? 'delta-positive' : ''}>{preview.diff.total_distance_delta_m} m</td></tr><tr><th>時間差異</th><td className={preview.diff.total_duration_delta_s > 0 ? 'delta-positive' : ''}>{preview.diff.total_duration_delta_s} s</td></tr></tbody></table></>}</div>}
        {plan && <div className="approval-bar"><span className="hint">{plan.state === 'CONFIRMED' ? '此方案已由調度員確認。' : '方案仍為 PROPOSED，未經確認不得 Dispatch。'}</span><span><button className="control-button secondary" onClick={() => void onPreview()} disabled={busy || plan.state === 'DISPATCHED'}>預覽 ORD-041</button>{preview && <button className="control-button" onClick={() => void onConfirm()} disabled={busy || plan.state === 'DISPATCHED'} style={{ marginLeft: 7 }}>人工確認預覽</button>}</span></div>}
      </div>
    </section>
  )
}
