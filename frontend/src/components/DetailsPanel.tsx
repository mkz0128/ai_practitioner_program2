import { useMemo, useState } from 'react'
import type { Plan, UrgentPreview } from '../types'

interface DetailsPanelProps {
  plan: Plan | null
  preview: UrgentPreview | null
  onConfirm: () => Promise<void>
  onCancelPreview?: () => Promise<void>
  busy: boolean
  activeOrderId?: string | null
  onSelectOrder?: (orderId: string) => void
}

function violationLabel(key: string): string {
  const labels: Record<string, string> = { overload: '超載', cross_zone: '跨服務區', duplicate: '重複指派', time_window: '時段違規' }
  return labels[key] || key
}

export function DetailsPanel({ plan, preview, onConfirm, onCancelPreview, busy, activeOrderId, onSelectOrder }: DetailsPanelProps) {
  const [tab, setTab] = useState<'routes' | 'exceptions' | 'preview'>('routes')
  const stops = useMemo(() => plan?.vehicles.flatMap((vehicle) => vehicle.stops.map((stop) => ({ ...stop, vehicleId: vehicle.vehicle_id }))) || [], [plan])
  return (
    <section className="panel bottom-panel" aria-label="配送明細">
      <div className="tabs">
        <button className={`tab ${tab === 'routes' ? 'active' : ''}`} onClick={() => setTab('routes')}>配送順序與理由</button>
        <button className={`tab ${tab === 'exceptions' ? 'active' : ''}`} onClick={() => setTab('exceptions')}>需要處理的訂單</button>
        <button className={`tab ${tab === 'preview' ? 'active' : ''}`} onClick={() => setTab('preview')}>臨時插單差異</button>
      </div>
      <div className="panel-body">
        {tab === 'routes' && <div className="table-wrap"><table><thead><tr><th>車輛</th><th>順序</th><th>訂單</th><th>地點</th><th>時段</th><th>重量</th><th>預計到達</th><th>推薦理由</th></tr></thead><tbody>{stops.length ? stops.map((stop) => <tr key={`${stop.vehicleId}-${stop.order_id}`} className={activeOrderId === stop.order_id ? 'selected-row' : ''} onClick={() => onSelectOrder?.(stop.order_id)}><td>{stop.vehicleId}</td><td>{stop.sequence}</td><td><strong>{stop.order_id}</strong></td><td>{stop.location_label}</td><td><span className="status-chip neutral">{stop.time_slot === 'AM' ? '上午' : '下午'}</span></td><td>{stop.order_weight_kg.toFixed(1)} kg</td><td>{stop.eta}</td><td className="reason">{stop.reason?.summary || '尚無安排理由'}<br /><span className="hint">{stop.reason ? `服務區域符合 · 時段合法 · 本段 ${Number(stop.reason.evidence.leg_distance_m ?? stop.leg_distance_m).toLocaleString()} 公尺` : ''}</span></td></tr>) : <tr><td colSpan={8} className="empty-cell">尚未建立配送方案。</td></tr>}</tbody></table></div>}
        {tab === 'exceptions' && <div>{plan?.unassigned_orders.length ? <div className="exception-list">{plan.unassigned_orders.map((orderId) => <div className="exception" key={orderId}><span>⚠</span><div><strong>{orderId} 目前無法安排</strong><br />可服務此區域的車輛目前沒有足夠載重或合法時段。<br /><small>建議先預覽重新安排，或交由調度人員處理。</small></div></div>)}</div> : <div className="success-box">目前沒有需要處理的訂單。</div>}{plan && <div className="validation-summary"><strong>{plan.rule_check.passed ? '方案檢查通過' : '需要人工複核'}</strong>{Object.entries(plan.rule_check.violations).map(([key, count]) => <span key={key}>{violationLabel(key)} {count}</span>)}</div>}</div>}
        {tab === 'preview' && <div>{!preview && <div className="hint">在對話中提出臨時插單需求後，這裡會顯示後端計算的前後差異。</div>}{preview && <><div className="success-box">{preview.mode === 'MINIMAL_CHANGE' ? '最小變動插入' : '完整重新排程'} · 影響 {preview.affected_vehicle_count} 台車 · 換車 {preview.moved_order_count} 張</div><div className="details-grid"><div className="comparison-card"><strong>插單前</strong><span>{preview.before.assigned_order_count} 張已安排 · {preview.before.assigned_weight_kg.toFixed(1)} kg</span><small>{preview.before.vehicles.map((vehicle) => `${vehicle.vehicle_id} ${vehicle.planned_load_kg.toFixed(1)} kg`).join(' · ')}</small></div><div className="comparison-card"><strong>插單後</strong><span>{preview.after.assigned_order_count} 張已安排 · {preview.after.assigned_weight_kg.toFixed(1)} kg</span><small>{preview.after.vehicles.map((vehicle) => `${vehicle.vehicle_id} ${vehicle.planned_load_kg.toFixed(1)} kg`).join(' · ')}</small></div></div><table className="diff-table"><tbody><tr><th>換車</th><td>{preview.diff.reassigned_orders.length} 張</td></tr><tr><th>順序變更</th><td>{preview.diff.sequence_changes.length} 筆</td></tr><tr><th>載重變更</th><td>{preview.diff.vehicle_load_changes.length} 台車</td></tr><tr><th>距離差異</th><td className={preview.diff.total_distance_delta_m > 0 ? 'delta-positive' : ''}>{preview.diff.total_distance_delta_m > 0 ? '+' : ''}{preview.diff.total_distance_delta_m} m</td></tr><tr><th>時間差異</th><td className={preview.diff.total_duration_delta_s > 0 ? 'delta-positive' : ''}>{preview.diff.total_duration_delta_s > 0 ? '+' : ''}{preview.diff.total_duration_delta_s} 秒</td></tr></tbody></table></>}</div>}
        {plan && <div className="approval-bar"><span className="hint">{plan.state === 'CONFIRMED' ? '此版本已由調度員確認。' : plan.confirmability.can_confirm || preview ? '方案尚待人工確認；確認後才會套用。' : `目前不可確認：${plan.completeness.unassigned_order_count ? `仍有 ${plan.completeness.unassigned_order_count} 張需要處理` : '方案檢查尚未通過'}`}</span><span><button className="control-button" onClick={() => void onConfirm()} disabled={busy || plan.state === 'DISPATCHED' || (!preview && !plan.confirmability.can_confirm)} title={!preview && !plan.confirmability.can_confirm ? '請先處理所有未安排訂單與規則問題' : undefined}>{preview ? '套用變更' : '確認方案'}</button>{preview && onCancelPreview && <button className="control-button ghost" onClick={() => void onCancelPreview()} disabled={busy}>取消變更</button>}</span></div>}
      </div>
    </section>
  )
}
