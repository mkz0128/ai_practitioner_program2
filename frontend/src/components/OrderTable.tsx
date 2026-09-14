import { useEffect, useMemo, useRef, useState } from 'react'
import type { Plan, RouteOrderPreview, Stop } from '../types'
import { formatEta, formatNumber, formatWeight, timeSlotLabel, cn } from '../lib/utils'
import { Badge, Button, Card, CardContent, CardHeader, SectionTitle } from './ui'

type SortKey = 'vehicle' | 'sequence' | 'order' | 'timeSlot' | 'weight' | 'eta'
type SortDirection = 'asc' | 'desc'
type TableStop = Stop & { vehicleId: string }

function compareStops(left: TableStop, right: TableStop, key: SortKey): number {
  if (key === 'vehicle') return left.vehicleId.localeCompare(right.vehicleId)
  if (key === 'sequence') return left.sequence - right.sequence
  if (key === 'order') return left.order_id.localeCompare(right.order_id)
  if (key === 'timeSlot') return left.time_slot.localeCompare(right.time_slot)
  if (key === 'weight') return left.order_weight_kg - right.order_weight_kg
  return left.eta.localeCompare(right.eta)
}

function formatDelta(value: number, unit: string): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${formatNumber(Math.abs(value), 1)} ${unit}`
}

function RoutePreview({ preview, onConfirm, busy }: { preview: RouteOrderPreview; onConfirm: () => Promise<void>; busy: boolean }) {
  const etaChanges = preview.diff.eta_changes
  return <div className={cn('route-preview', preview.feasible ? 'route-preview-ok' : 'route-preview-error')} role="status" aria-label="站序預覽結果">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2"><Badge tone={preview.feasible ? 'success' : 'warning'}>{preview.feasible ? '可以換' : '不能換'}</Badge><strong className="text-sm text-slate-900">{preview.vehicle_id} 站序預覽</strong></div>
      {preview.feasible && <Button type="button" variant="secondary" disabled={busy} onClick={() => void onConfirm()}>確認套用</Button>}
    </div>
    <p className="mt-2 text-xs leading-5 text-slate-600">{preview.feasible ? '放開後仍不會立即生效，確認後才建立新版本。' : preview.reason || '站序未通過驗證，原方案沒有變更。'}</p>
    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs"><span>里程變化 <strong>{formatDelta(preview.diff.distance_delta_m / 1000, 'km')}</strong></span><span>時間變化 <strong>{formatDelta(preview.diff.duration_delta_s / 60, '分鐘')}</strong></span><span>載重率變化 <strong>{formatDelta(preview.diff.load_utilization_delta * 100, '%')}</strong></span><span>受影響 ETA <strong>{etaChanges.length} 站</strong></span></div>
    {etaChanges.length > 0 && <div className="mt-3 border-t border-slate-200 pt-2 text-xs leading-5"><p className="font-semibold text-slate-700">受影響站點</p>{etaChanges.map((change) => <p key={change.order_id}>{change.order_id}：{formatEta(change.before_eta)} → {formatEta(change.after_eta)}（{formatDelta(change.delta_minutes, '分鐘')}）</p>)}</div>}
  </div>
}

export function OrderTable({ plan, activeOrderId, onSelectOrder, onPreviewRouteOrder, onConfirmRouteOrder }: { plan: Plan; activeOrderId: string | null; onSelectOrder: (id: string) => void; onPreviewRouteOrder?: (vehicleId: string, orderIds: string[]) => Promise<RouteOrderPreview>; onConfirmRouteOrder?: (preview: RouteOrderPreview) => Promise<void> }) {
  const [sortKey, setSortKey] = useState<SortKey>('sequence')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [dragged, setDragged] = useState<{ vehicleId: string; orderId: string } | null>(null)
  const [preview, setPreview] = useState<RouteOrderPreview | null>(null)
  const [dragMessage, setDragMessage] = useState<string | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current) }, [])
  useEffect(() => { setPreview(null); setDragged(null); setDragMessage(null) }, [plan.version])

  const stops = useMemo(() => {
    const all: TableStop[] = plan.vehicles.flatMap((vehicle) => vehicle.stops.map((stop) => ({ ...stop, vehicleId: vehicle.vehicle_id })))
    return all.sort((left, right) => { const result = compareStops(left, right, sortKey); return (sortDirection === 'asc' ? result : -result) || left.vehicleId.localeCompare(right.vehicleId) || left.sequence - right.sequence })
  }, [plan.vehicles, sortDirection, sortKey])

  function sortBy(nextKey: SortKey) {
    if (nextKey === sortKey) setSortDirection((value) => value === 'asc' ? 'desc' : 'asc')
    else { setSortKey(nextKey); setSortDirection('asc') }
  }
  function sortLabel(label: string, key: SortKey): string { return sortKey === key ? `${label}（${sortDirection === 'asc' ? '升序' : '降序'}）` : `${label}（可排序）` }
  function proposedOrder(targetVehicleId: string, targetOrderId: string): string[] | null {
    if (!dragged || dragged.vehicleId !== targetVehicleId) return null
    const route = plan.vehicles.find((vehicle) => vehicle.vehicle_id === targetVehicleId)
    if (!route) return null
    const orderIds = route.stops.map((stop) => stop.order_id).filter((id) => id !== dragged.orderId)
    const targetIndex = orderIds.indexOf(targetOrderId)
    orderIds.splice(targetIndex < 0 ? orderIds.length : targetIndex, 0, dragged.orderId)
    return orderIds
  }
  function schedulePreview(targetVehicleId: string, targetOrderId: string) {
    const orderIds = proposedOrder(targetVehicleId, targetOrderId)
    if (!orderIds || !onPreviewRouteOrder) return
    const route = plan.vehicles.find((vehicle) => vehicle.vehicle_id === targetVehicleId)
    if (!route || orderIds.every((id, index) => id === route.stops[index]?.order_id)) return
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { setPreviewBusy(true); void onPreviewRouteOrder(targetVehicleId, orderIds).then(setPreview).catch((error: unknown) => setDragMessage(error instanceof Error ? error.message : '站序預覽失敗，原方案沒有變更。')).finally(() => setPreviewBusy(false)) }, 200)
  }
  function handleDrop(targetVehicleId: string, targetOrderId: string) {
    if (!dragged) return
    if (dragged.vehicleId !== targetVehicleId) { setDragMessage('跨車輛拖曳目前不支援，請先在同一台車內調整站序。'); setDragged(null); return }
    schedulePreview(targetVehicleId, targetOrderId); setDragged(null); setDragMessage('站序預覽已送出；請查看下方的可行性與代價。')
  }

  const columns: Array<[SortKey, string]> = [['vehicle', '車輛'], ['sequence', '站次'], ['order', '訂單'], ['timeSlot', '配送時段'], ['weight', '重量'], ['eta', '預估到達']]
  return <Card aria-label="訂單與配送順序"><CardHeader><SectionTitle title="訂單與配送順序" detail="拖曳同車站點調整順序；放開後先看後端試算，再確認套用。" /><Badge tone={plan.completeness.is_complete ? 'success' : 'warning'}>{plan.completeness.assigned_order_count}/{plan.completeness.total_order_count} 已安排</Badge></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><table className="data-table"><thead><tr>{columns.map(([key, label]) => <th key={key} aria-sort={sortKey === key ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" className="sort-button" onClick={() => sortBy(key)} aria-label={sortLabel(label, key)}>{label}<span className="sort-arrow" aria-hidden="true" /></button></th>)}</tr></thead><tbody>{stops.map((stop) => <tr key={`${stop.vehicleId}-${stop.order_id}`} draggable={plan.stage !== 'DISPATCHED' || stop.progress_status !== 'COMPLETED'} onDragStart={(event) => { setDragged({ vehicleId: stop.vehicleId, orderId: stop.order_id }); event.dataTransfer.effectAllowed = 'move' }} onDragOver={(event) => { event.preventDefault(); schedulePreview(stop.vehicleId, stop.order_id) }} onDrop={(event) => { event.preventDefault(); handleDrop(stop.vehicleId, stop.order_id) }} onDragEnd={() => setDragged(null)} className={cn(activeOrderId === stop.order_id && 'selected-row', dragged?.orderId === stop.order_id && 'dragging-row')} onClick={() => onSelectOrder(stop.order_id)}><td className="font-semibold">{stop.vehicleId}</td><td>{stop.sequence}</td><td className="font-semibold text-slate-900">{stop.order_id}</td><td><Badge tone="neutral">{timeSlotLabel(stop.time_slot)}</Badge></td><td>{formatWeight(stop.order_weight_kg)}</td><td className="tabular-nums">{formatEta(stop.eta)}</td></tr>)}{plan.unassigned_orders.map((orderId) => <tr key={orderId} className="bg-amber-50"><td colSpan={2}>需處理</td><td className="font-semibold">{orderId}</td><td colSpan={3}>{plan.unassigned_reasons[orderId] || '目前沒有符合全部限制的車輛。'}</td></tr>)}{stops.length === 0 && plan.unassigned_orders.length === 0 && <tr><td colSpan={6} className="py-12 text-center text-slate-500">目前沒有可顯示的配送站點。</td></tr>}</tbody></table></div>{(dragMessage || previewBusy || preview) && <div className="route-preview-wrap">{dragMessage && <p className="mb-2 text-xs font-semibold text-slate-600" role="status">{dragMessage}</p>}{previewBusy && <p className="text-xs text-slate-500" role="status">正在計算新的站序…</p>}{preview && onConfirmRouteOrder && <RoutePreview preview={preview} busy={previewBusy} onConfirm={async () => { try { await onConfirmRouteOrder(preview); setPreview(null); setDragMessage('已套用新站序；方案版本已更新。') } catch (error) { setDragMessage(error instanceof Error ? error.message : '套用站序失敗，原方案沒有變更。') } }} />}</div>}</CardContent></Card>
}
