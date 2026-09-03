import { useMemo } from 'react'
import type { Plan } from '../types'

interface OrderDetailPanelProps {
  plan: Plan | null
  orderId: string | null
}

export function OrderDetailPanel({ plan, orderId }: OrderDetailPanelProps) {
  const detail = useMemo(() => {
    if (!plan || !orderId) return null
    for (const vehicle of plan.vehicles) {
      const stop = vehicle.stops.find((item) => item.order_id === orderId)
      if (stop) return { vehicle, stop }
    }
    return null
  }, [orderId, plan])

  return (
    <aside className="panel order-detail-panel" aria-label="訂單詳情">
      <div className="panel-heading"><div><div className="eyebrow">選取的配送任務</div><h2>{detail?.stop.order_id ?? '訂單詳情'}</h2><p>{detail?.stop.location_label ?? '從左側表格選擇一張訂單'}</p></div>{detail && <span className="status-chip live">已安排</span>}</div>
      <div className="panel-body detail-body">
        {!detail && <div className="empty-detail"><span>⌖</span><p>選擇訂單後查看車輛、時段與 AI 摘要。</p></div>}
        {detail && <>
          <div className="detail-kv-grid"><div><span>配送車輛</span><strong>{detail.vehicle.vehicle_id}</strong></div><div><span>配送順序</span><strong>第 {detail.stop.sequence} 站</strong></div><div><span>貨物重量</span><strong>{detail.stop.order_weight_kg.toFixed(1)} kg</strong></div><div><span>服務時段</span><strong>{detail.stop.time_slot}</strong></div></div>
          <div className="ai-summary"><div className="summary-title"><span className="sparkle">✦</span> AI 摘要</div><p>{detail.stop.reason?.summary ?? '此訂單已由確定性排程工具安排。'}</p><div className="evidence-pills"><span>區域可服務</span><span>{detail.stop.reason?.evidence.time_window_legal ? '時段合法' : '需複核時段'}</span><span>{detail.stop.leg_distance_m.toLocaleString()} m 距離</span></div></div>
          <div className="timeline"><div className="timeline-title">配送里程碑</div><div className="timeline-item done"><i />資料已驗證<span>欄位與包裹重量確認</span></div><div className="timeline-item done"><i />已加入配送方案<span>{detail.vehicle.vehicle_id} · 第 {detail.stop.sequence} 站</span></div><div className="timeline-item pending"><i />等待人工確認<span>確認後才可進入下一流程</span></div></div>
        </>}
      </div>
    </aside>
  )
}
