import type { MapData, StopProgressStatus } from '../types'
import { cn, vehicleLabel } from '../lib/utils'
import { Button, Card, CardContent, CardHeader, SectionTitle } from './ui'

function clockLabel(minutes: number): string {
  const total = 9 * 60 + minutes
  const hour = Math.floor(total / 60) % 24
  const minute = total % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function etaMinutes(value: string): number | null {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' }).formatToParts(date)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value)
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute - 9 * 60 : null
}

function statusLabel(status: StopProgressStatus): string {
  if (status === 'COMPLETED') return '已送達'
  if (status === 'CURRENT') return '目前位置'
  return '未送'
}

export function TimelineBoard({ data, timelineMinutes, unassignedCount, updating, onChange, onViewReview }: { data: MapData; timelineMinutes: number; unassignedCount: number; updating: boolean; onChange: (value: number) => void; onViewReview: () => void }) {
  const latestEta = data.routes.flatMap((route) => route.stops.map((stop) => etaMinutes(stop.eta))).filter((value): value is number => value !== null).reduce((latest, value) => Math.max(latest, value), 0)
  const timelineMax = Math.min(660, Math.max(10, Math.ceil(latestEta / 10) * 10))
  const stops = data.routes.flatMap((route) => route.stops)
  const completedCount = stops.filter((stop) => stop.status === 'COMPLETED').length
  const remainingCount = stops.length - completedCount
  const reachedEnd = timelineMinutes >= timelineMax && !updating

  return <Card aria-label="配送時間軸">
    <CardHeader>
      <SectionTitle title="配送進度時間軸" detail="拖動模擬時間；四台車同步推進" />
      <span className="text-sm font-bold text-blue-700">目前模擬時刻 {clockLabel(timelineMinutes)}</span>
    </CardHeader>
    <CardContent>
      <label className="sr-only" htmlFor="dispatch-timeline">配送時間軸</label>
      <input id="dispatch-timeline" aria-label="配送時間軸" type="range" min={0} max={timelineMax} step={1} value={Math.min(timelineMinutes, timelineMax)} onChange={(event) => onChange(Number(event.target.value))} className="timeline-slider" />
      <div className="mt-2 flex justify-between text-[11px] font-semibold text-slate-400"><span>09:00</span><span>{clockLabel(timelineMax)}</span></div>
      {reachedEnd && <div className="timeline-end" role="status">
        <div>
          <strong>{remainingCount === 0 ? '今日模擬行程已跑完' : '模擬時間已到今天終點'}</strong>
          <p>已模擬到站 {completedCount}／{stops.length} 站；尚未到站 {remainingCount} 站；另有 {unassignedCount} 張未安排訂單。這是依預估時間推進的模擬，並非實際簽收。</p>
        </div>
        <Button type="button" variant="secondary" onClick={onViewReview}>查看今日回顧</Button>
      </div>}
      <div className="mt-5 space-y-4">{data.routes.map((route) => {
        const completed = route.completed_stops.length
        return <div key={route.vehicle_id} className="timeline-row">
          <div className="flex items-center justify-between gap-3"><strong className="text-xs text-slate-800">{vehicleLabel(route.vehicle_id)}</strong><span className="text-[11px] text-slate-500">已送 {completed}／{route.stops.length} 站</span></div>
          <div className="timeline-track" aria-label={`${route.vehicle_id} 進度線`}>{route.stops.map((stop) => <div key={stop.order_id} className="timeline-stop-wrap" title={`${stop.order_id} ${statusLabel(stop.status)}`}><span aria-label={`${stop.order_id} ${statusLabel(stop.status)}`} aria-disabled={stop.status === 'COMPLETED'} draggable={false} className={cn('timeline-stop', stop.status === 'COMPLETED' && 'timeline-stop-completed', stop.status === 'CURRENT' && 'timeline-stop-current', stop.status === 'UPCOMING' && 'timeline-stop-upcoming')} /> <span className="timeline-stop-label">{stop.order_id}</span></div>)}</div>
          <div className="mt-1 flex gap-3 text-[10px] text-slate-400"><span>實心：已送</span><span>方塊：目前</span><span>空心：未送</span></div>
        </div>
      })}</div>
      <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">已完成站點已鎖定，不能調整；只能重排目前位置之後的剩餘站點。</p>
    </CardContent>
  </Card>
}
