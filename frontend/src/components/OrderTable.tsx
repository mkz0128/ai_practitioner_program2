import { useEffect, useRef, useState } from 'react'
import type { CrossVehicleRouteOrderPreview, Plan, RouteOrderPreview, Stop } from '../types'
import { formatEta, formatNumber, formatWeight, timeSlotLabel, cn } from '../lib/utils'
import { Badge, Button, Card, CardContent, CardHeader, SectionTitle } from './ui'

type Preview = RouteOrderPreview | CrossVehicleRouteOrderPreview
type DraggedOrder = { vehicleId: string; orderId: string }

function isCrossPreview(preview: Preview): preview is CrossVehicleRouteOrderPreview {
  return 'source_vehicle_id' in preview
}

function delta(value: number, unit: string): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${formatNumber(Math.abs(value), 1)} ${unit}`
}

function StopDetails({ stop }: { stop: Stop }) {
  return <div className="board-order-details" role="region" aria-label={`${stop.order_id} 配送明細`}><span>時段：{timeSlotLabel(stop.time_slot)}</span><span>重量：{formatWeight(stop.order_weight_kg)}</span><span>預估到達：{formatEta(stop.eta)}</span>{stop.reason?.summary && <span>推薦理由：{stop.reason.summary}</span>}</div>
}

function SameVehiclePreview({ preview, onConfirm, busy }: { preview: RouteOrderPreview; onConfirm?: () => Promise<void>; busy: boolean }) {
  return <div className={cn('route-preview', preview.feasible ? 'route-preview-ok' : 'route-preview-error')} role="status" aria-label="站序預覽結果"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Badge tone={preview.feasible ? 'success' : 'warning'}>{preview.feasible ? '可以換' : '不能換'}</Badge><strong className="text-sm text-slate-900">{preview.vehicle_id} 新站序</strong></div>{preview.feasible && onConfirm && <Button type="button" variant="secondary" disabled={busy} onClick={() => void onConfirm()}>套用變更</Button>}</div><p className="mt-2 text-xs leading-5 text-slate-600">{preview.feasible ? '放開後先試算，確認後才建立新版本。' : preview.reason || '站序未通過驗證，原方案沒有變更。'}</p><div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs"><span>路程 <strong>{delta(preview.diff.distance_delta_m / 1000, 'km')}</strong></span><span>時間 <strong>{delta(preview.diff.duration_delta_s / 60, '分鐘')}</strong></span><span>載重率 <strong>{delta(preview.diff.load_utilization_delta * 100, '%')}</strong></span><span>受影響站點 <strong>{preview.diff.eta_changes.length} 站</strong></span></div>{preview.diff.eta_changes.length > 0 && <div className="mt-3 border-t border-slate-200 pt-2 text-xs leading-5"><p className="font-semibold text-slate-700">ETA 變化</p>{preview.diff.eta_changes.slice(0, 8).map((change) => <p key={change.order_id}>{change.order_id}：{formatEta(change.before_eta)} → {formatEta(change.after_eta)}（{delta(change.delta_minutes, '分鐘')}）</p>)}</div>}</div>
}

function CrossVehiclePreview({ preview, onConfirm, busy }: { preview: CrossVehicleRouteOrderPreview; onConfirm?: () => Promise<void>; busy: boolean }) {
  return <div className={cn('route-preview', preview.feasible ? 'route-preview-ok' : 'route-preview-error')} role="status" aria-label="跨車站序預覽結果"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Badge tone={preview.feasible ? 'success' : 'warning'}>{preview.feasible ? '可以換' : '不能換'}</Badge><strong className="text-sm text-slate-900">{preview.order_id} {preview.source_vehicle_id} → {preview.target_vehicle_id}</strong></div>{preview.feasible && onConfirm && <Button type="button" variant="secondary" disabled={busy} onClick={() => void onConfirm()}>套用變更</Button>}</div><p className="mt-2 text-xs leading-5 text-slate-600">{preview.feasible ? '跨車換站先試算，確認後才建立新版本。' : preview.reason || '跨車站序未通過驗證，原方案沒有變更。'}</p><div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs"><span>雙車路程 <strong>{delta(preview.diff.distance_delta_m / 1000, 'km')}</strong></span><span>雙車時間 <strong>{delta(preview.diff.duration_delta_s / 60, '分鐘')}</strong></span><span>{preview.source_vehicle_id} 載重 <strong>{delta(preview.diff.source_load_delta_kg, 'kg')}</strong></span><span>{preview.target_vehicle_id} 載重 <strong>{delta(preview.diff.target_load_delta_kg, 'kg')}</strong></span></div>{preview.diff.eta_changes.length > 0 && <div className="mt-3 border-t border-slate-200 pt-2 text-xs leading-5"><p className="font-semibold text-slate-700">受影響站點 ETA</p>{preview.diff.eta_changes.slice(0, 8).map((change) => <p key={change.order_id}>{change.order_id}：{formatEta(change.before_eta)} → {formatEta(change.after_eta)}（{delta(change.delta_minutes, '分鐘')}）</p>)}</div>}</div>
}

function orderIdsForDrop(route: Plan['vehicles'][number], dragged: DraggedOrder, targetOrderId: string): string[] | null {
  if (route.vehicle_id !== dragged.vehicleId) return null
  const orderIds = route.stops.map((stop) => stop.order_id).filter((id) => id !== dragged.orderId)
  const targetIndex = orderIds.indexOf(targetOrderId)
  orderIds.splice(targetIndex < 0 ? orderIds.length : targetIndex, 0, dragged.orderId)
  return orderIds
}

export function OrderTable({ plan, activeOrderId, manualVehicleId, manualOrderId, onSelectOrder, onHistoryMove, onPreviewRouteOrder, onConfirmRouteOrder, onPreviewCrossVehicleRouteOrder, onConfirmCrossVehicleRouteOrder }: { plan: Plan; activeOrderId: string | null; manualVehicleId?: string | null; manualOrderId?: string | null; onSelectOrder: (id: string) => void; onHistoryMove?: (direction: 'undo' | 'redo') => Promise<void>; onPreviewRouteOrder?: (vehicleId: string, orderIds: string[]) => Promise<RouteOrderPreview>; onConfirmRouteOrder?: (preview: RouteOrderPreview) => Promise<void>; onPreviewCrossVehicleRouteOrder?: (sourceVehicleId: string, targetVehicleId: string, orderId: string, targetSequence: number) => Promise<CrossVehicleRouteOrderPreview>; onConfirmCrossVehicleRouteOrder?: (preview: CrossVehicleRouteOrderPreview) => Promise<void> }) {
  const [dragged, setDragged] = useState<DraggedOrder | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [dragMessage, setDragMessage] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  const previewRequestId = useRef(0)
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current) }, [])
  useEffect(() => { setPreview(null); setDragged(null); setDragMessage(null) }, [plan.version])

  function scheduleSameVehiclePreview(vehicleId: string, targetOrderId: string, draggedOrder = dragged) {
    if (!draggedOrder || !onPreviewRouteOrder) return
    const route = plan.vehicles.find((item) => item.vehicle_id === vehicleId)
    if (!route) return
    const orderIds = orderIdsForDrop(route, draggedOrder, targetOrderId)
    if (!orderIds || orderIds.every((id, index) => id === route.stops[index]?.order_id)) return
    if (timer.current !== null) window.clearTimeout(timer.current)
    const requestId = ++previewRequestId.current
    timer.current = window.setTimeout(() => { if (requestId !== previewRequestId.current) return; setPreviewBusy(true); void onPreviewRouteOrder(vehicleId, orderIds).then((result) => { if (requestId === previewRequestId.current) setPreview(result) }).catch((error: unknown) => { if (requestId === previewRequestId.current) setDragMessage(error instanceof Error ? error.message : '站序預覽失敗，原方案沒有變更。') }).finally(() => { if (requestId === previewRequestId.current) setPreviewBusy(false) }) }, 200)
  }

  function scheduleCrossVehiclePreview(targetVehicleId: string, targetSequence: number, draggedOrder = dragged) {
    if (!draggedOrder || !onPreviewCrossVehicleRouteOrder) return
    if (timer.current !== null) window.clearTimeout(timer.current)
    const requestId = ++previewRequestId.current
    timer.current = window.setTimeout(() => { if (requestId !== previewRequestId.current) return; setPreviewBusy(true); void onPreviewCrossVehicleRouteOrder(draggedOrder.vehicleId, targetVehicleId, draggedOrder.orderId, targetSequence).then((result) => { if (requestId === previewRequestId.current) setPreview(result) }).catch((error: unknown) => { if (requestId === previewRequestId.current) setDragMessage(error instanceof Error ? error.message : '跨車預覽失敗，原方案沒有變更。') }).finally(() => { if (requestId === previewRequestId.current) setPreviewBusy(false) }) }, 200)
  }

  function handleDrop(event: React.DragEvent, targetVehicleId: string, targetSequence: number, targetOrderId?: string) {
    const droppedOrderId = event.dataTransfer.getData('text/plain')
    const droppedVehicleId = droppedOrderId
      ? plan.vehicles.find((vehicle) => vehicle.stops.some((stop) => stop.order_id === droppedOrderId))?.vehicle_id
      : undefined
    const activeDragged = droppedOrderId && droppedVehicleId
      ? { vehicleId: droppedVehicleId, orderId: droppedOrderId }
      : dragged
    if (!activeDragged) return
    if (activeDragged.vehicleId === targetVehicleId && targetOrderId) scheduleSameVehiclePreview(targetVehicleId, targetOrderId, activeDragged)
    else if (activeDragged.vehicleId !== targetVehicleId) scheduleCrossVehiclePreview(targetVehicleId, targetSequence, activeDragged)
    setDragged(null)
    setDragMessage('已送出站序試算；請查看下方的可行性與代價。')
  }

  return <Card aria-label="訂單看板"><CardHeader><SectionTitle title="訂單看板" detail="拖曳訂單調整車輛與站序；放開後先試算，確認才套用。" /><Badge tone={plan.completeness.is_complete ? 'success' : 'warning'}>{plan.completeness.assigned_order_count}/{plan.completeness.total_order_count} 已安排</Badge></CardHeader><CardContent>{onHistoryMove && <div className="order-board-history"><Button type="button" variant="outline" onClick={() => void onHistoryMove('undo')}>上一步</Button><Button type="button" variant="outline" onClick={() => void onHistoryMove('redo')}>下一步</Button></div>}{manualVehicleId && (() => { const vehicle = plan.vehicles.find((item) => item.vehicle_id === manualVehicleId); if (!vehicle) return null; const completedCount = vehicle.stops.filter((stop) => stop.progress_status === 'COMPLETED').length; const targetStop = manualOrderId ? vehicle.stops.find((stop) => stop.order_id === manualOrderId) : null; return <div className="order-board-manual" role="status">正在手動調整 {manualVehicleId} 的剩餘 {vehicle.stops.length - completedCount} 站。{manualOrderId && targetStop ? `${manualOrderId} 要在 ${formatEta(targetStop.eta)} 前送達。` : ''}</div> })()}<div className="order-board" role="list" aria-label="四台車訂單看板">{plan.vehicles.map((vehicle) => <section key={vehicle.vehicle_id} className={cn('order-board-column', manualVehicleId === vehicle.vehicle_id && 'order-board-column-manual', dragged && dragged.vehicleId !== vehicle.vehicle_id && 'order-board-column-target')} aria-label={`${vehicle.vehicle_id} 訂單欄`} onDragOver={(event) => { event.preventDefault(); if (event.target !== event.currentTarget) return; if (dragged && dragged.vehicleId !== vehicle.vehicle_id) scheduleCrossVehiclePreview(vehicle.vehicle_id, vehicle.stops.length + 1) }} onDrop={(event) => { event.preventDefault(); handleDrop(event, vehicle.vehicle_id, vehicle.stops.length + 1) }}><div className="order-board-heading"><strong>{vehicle.vehicle_id}</strong><span>{vehicle.order_count} 張</span></div><div className="order-board-stops">{vehicle.stops.map((stop) => { const locked = plan.stage === 'DISPATCHED' && stop.progress_status === 'COMPLETED'; const expanded = activeOrderId === stop.order_id; return <div key={stop.order_id} data-order-id={stop.order_id} className={cn('order-board-stop', locked && 'order-board-stop-locked', dragged?.orderId === stop.order_id && 'dragging-row')} draggable={!locked} onDragStart={(event) => { if (locked) { event.preventDefault(); setDragMessage(`${stop.order_id} 已送達，不能拖曳。`); return } setDragged({ vehicleId: vehicle.vehicle_id, orderId: stop.order_id }); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', stop.order_id) }} onDragOver={(event) => { event.preventDefault(); if (dragged && dragged.vehicleId === vehicle.vehicle_id) scheduleSameVehiclePreview(vehicle.vehicle_id, stop.order_id); else if (dragged) scheduleCrossVehiclePreview(vehicle.vehicle_id, stop.sequence) }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); handleDrop(event, vehicle.vehicle_id, stop.sequence, stop.order_id) }} onDragEnd={() => setDragged(null)}><button type="button" className="order-board-order" onClick={() => onSelectOrder(expanded ? '' : stop.order_id)} aria-expanded={expanded}><span className="order-board-sequence">{stop.sequence}</span><span className="font-semibold">{stop.order_id}</span>{locked && <Badge tone="neutral">已送達</Badge>}</button>{expanded && <StopDetails stop={stop} />}</div> })}</div><div className="order-board-total"><span>載重</span><strong>{formatWeight(vehicle.planned_load_kg)} / {formatWeight(vehicle.max_load_kg)}</strong><span>{formatNumber(vehicle.load_utilization * 100, 0)}%</span></div></section>)}</div>{plan.unassigned_orders.length > 0 && <div className="order-board-unassigned" role="status"><strong>未安排</strong>{plan.unassigned_orders.map((orderId) => <span key={orderId}>{orderId}：{plan.unassigned_reasons[orderId] || '目前沒有符合全部限制的車輛。'}</span>)}</div>}{(dragMessage || previewBusy || preview) && <div className="route-preview-wrap">{dragMessage && <p className="mb-2 text-xs font-semibold text-slate-600" role="status">{dragMessage}</p>}{previewBusy && <p className="text-xs text-slate-500" role="status">正在計算新的站序…</p>}{preview && (isCrossPreview(preview) ? <CrossVehiclePreview preview={preview} busy={previewBusy} onConfirm={onConfirmCrossVehicleRouteOrder ? async () => { try { await onConfirmCrossVehicleRouteOrder(preview); setPreview(null); setDragMessage('已套用跨車站序；方案版本已更新。') } catch (error) { setDragMessage(error instanceof Error ? error.message : '套用站序失敗，原方案沒有變更。') } } : undefined} /> : <SameVehiclePreview preview={preview} busy={previewBusy} onConfirm={onConfirmRouteOrder ? async () => { try { await onConfirmRouteOrder(preview); setPreview(null); setDragMessage('已套用新站序；方案版本已更新。') } catch (error) { setDragMessage(error instanceof Error ? error.message : '套用站序失敗，原方案沒有變更。') } } : undefined} />)}</div>}</CardContent></Card>
}
