import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatResponse, ColumnMappingResponse, DispatchDeviationSuggestion, DispatchRuleEvidence, DispatchRuleOption, UrgentPlanOption } from '../types'
import { formatEta, formatNumber, cn } from '../lib/utils'
import { fieldLabel, fieldLabels, formatValidationError } from '../lib/fieldLabels'
import { Badge, Button, Card, CardContent, CardHeader, SectionTitle } from './ui'

type ChatAction = 'PREVIEW_URGENT'
type ChatSubmitResult = { response: ChatResponse | null; error?: string }
interface Message { role: 'user' | 'assistant'; text: string; attachment?: string; response?: ChatResponse; options?: UrgentPlanOption[]; ruleOptions?: DispatchRuleOption[]; ruleEvidence?: DispatchRuleEvidence; deviationSuggestions?: DispatchDeviationSuggestion[] }
interface ActivityState { skill: string; phase: string }
export interface PendingMapping { file: File; response: ColumnMappingResponse }
interface ChatPanelProps { onChat: (message: string, action?: ChatAction) => Promise<ChatSubmitResult>; onInspectFile: (file: File) => Promise<ColumnMappingResponse | null>; onImportFile: (file: File, mapping?: Record<string, Record<string, string>>, mappingName?: string) => Promise<void>; onConfirmOption?: (option: UrgentPlanOption) => Promise<void>; onConfirmRule?: (option: DispatchRuleOption) => Promise<void>; onConfirmDeviation?: (suggestion: DispatchDeviationSuggestion) => Promise<void>; onManualAdjust?: (option: UrgentPlanOption) => void; busy: boolean; onStop: () => void; plan: boolean; activity?: ActivityState | null }

const canonicalFields: Record<string, string[]> = {
  orders: ['order_id', 'zone_code', 'city', 'district', 'location_label', 'latitude', 'longitude', 'time_slot', 'declared_package_count', 'priority', 'note'],
  packages: ['package_id', 'order_id', 'weight_kg'],
  vehicles: ['vehicle_id', 'vehicle_name', 'max_load_kg', 'current_load_kg', 'service_zone_codes', 'depot_id', 'status', 'note'],
  zones: ['zone_code', 'zone_name', 'covered_cities', 'covered_districts', 'center_latitude', 'center_longitude', 'tdx_city_codes', 'adjacent_zone_codes', 'enabled'],
}
const requiredFields: Record<string, string[]> = { orders: ['location_label', 'time_slot'], packages: ['weight_kg'] }

function evidenceMessage(response: ChatResponse): string {
  const missing = response.evidence.find((item) => item.tool === 'request_missing_fields')
  if (missing && Array.isArray(missing.data.missing_fields)) return `還需要補充：${missing.data.missing_fields.map((item) => fieldLabel(String(item))).join('、')}。`
  const highestLoad = response.evidence.find((item) => item.tool === 'highest_load_vehicle')
  if (highestLoad && typeof highestLoad.data.vehicle_id === 'string' && typeof highestLoad.data.planned_load_kg === 'number') {
    const limit = typeof highestLoad.data.max_load_kg === 'number' ? `，載重上限 ${formatNumber(highestLoad.data.max_load_kg)} kg` : ''
    return `${highestLoad.data.vehicle_id} 目前計畫載重 ${formatNumber(highestLoad.data.planned_load_kg)} kg${limit}。`
  }
  const lowestLoad = response.evidence.find((item) => item.tool === 'lowest_load_vehicle')
  if (lowestLoad && typeof lowestLoad.data.vehicle_id === 'string' && typeof lowestLoad.data.remaining_capacity_kg === 'number') {
    return `${lowestLoad.data.vehicle_id} 目前剩餘容量 ${formatNumber(lowestLoad.data.remaining_capacity_kg)} kg。`
  }
  const vehicleLoad = response.evidence.find((item) => item.tool === 'vehicle_load')
  if (vehicleLoad && typeof vehicleLoad.data.vehicle_id === 'string' && typeof vehicleLoad.data.planned_load_kg === 'number' && typeof vehicleLoad.data.max_load_kg === 'number' && typeof vehicleLoad.data.load_utilization === 'number' && typeof vehicleLoad.data.remaining_capacity_kg === 'number') {
    return `${vehicleLoad.data.vehicle_id} 目前計畫載重 ${formatNumber(vehicleLoad.data.planned_load_kg, 1)} kg，上限 ${formatNumber(vehicleLoad.data.max_load_kg, 1)} kg，使用率 ${formatNumber(vehicleLoad.data.load_utilization * 100, 1)}%，剩餘容量 ${formatNumber(vehicleLoad.data.remaining_capacity_kg, 1)} kg。`
  }
  const missingOrder = response.evidence.find((item) => item.data.status === 'ORDER_NOT_FOUND')
  if (missingOrder && typeof missingOrder.data.order_id === 'string') return `找不到訂單 ${missingOrder.data.order_id}，資料中沒有這張訂單。`
  return response.message
}

function responseCards(response: ChatResponse): { urgent: UrgentPlanOption[]; rules: DispatchRuleOption[]; ruleEvidence?: DispatchRuleEvidence; deviations: DispatchDeviationSuggestion[] } {
  const urgent: UrgentPlanOption[] = []
  const rules: DispatchRuleOption[] = []
  const deviations: DispatchDeviationSuggestion[] = []
  let ruleEvidence: DispatchRuleEvidence | undefined
  for (const entry of response.evidence) {
    if (entry.tool === 'inspect_dispatch_deviations' && entry.data.view === 'SUGGESTIONS' && Array.isArray(entry.data.suggestions)) {
      for (const suggestion of entry.data.suggestions) {
        if (suggestion && typeof suggestion === 'object') deviations.push(suggestion as unknown as DispatchDeviationSuggestion)
      }
    }
    if (entry.tool === 'preview_dispatch_rule') {
      ruleEvidence = entry.data as unknown as DispatchRuleEvidence
      if (!Array.isArray(entry.data.options)) continue
      for (const raw of entry.data.options) {
        if (!raw || typeof raw !== 'object') continue
        const option = raw as { mode?: string }
        if (option.mode === 'RULE') rules.push(raw as DispatchRuleOption)
      }
      continue
    }
    if (!Array.isArray(entry.data.options)) continue
    for (const raw of entry.data.options) {
      if (!raw || typeof raw !== 'object') continue
      const option = raw as { mode?: string }
      if (option.mode === 'RULE') rules.push(raw as DispatchRuleOption)
      else urgent.push(raw as UrgentPlanOption)
    }
  }
  return { urgent, rules, ruleEvidence, deviations }
}

function isUrgentReviewReady(response: ChatResponse): boolean {
  const workflow = response.evidence.find((item) => item.tool === 'urgent_insertion_workflow')
  return workflow?.data.stage === 'REVIEW_READY'
}

const toolDisplay: Record<string, { skill: string; label: string }> = {
  plan_dispatch: { skill: '每日排班', label: '方案試算' }, preview_dispatch_rule: { skill: '每日排班', label: '司機規則試算' }, inspect_plan_overview: { skill: '每日排班', label: '方案總覽查詢' }, explain_assignment: { skill: '每日排班', label: '配送分配查詢' }, explain_unassigned: { skill: '每日排班', label: '未安排原因查詢' }, highest_load_vehicle: { skill: '每日排班', label: '車輛資料查詢' }, lowest_load_vehicle: { skill: '每日排班', label: '車輛資料查詢' }, vehicle_load: { skill: '每日排班', label: '車輛資料查詢' }, compare_strategies: { skill: '每日排班', label: '方案比較' }, query_plan_version: { skill: '每日排班', label: '方案版本查詢' }, begin_urgent_insertion: { skill: '臨時插單', label: '新增急單整理' }, request_missing_fields: { skill: '臨時插單', label: '急單欄位檢查' }, preview_urgent_insert: { skill: '臨時插單', label: '急單求解' }, preview_structured_urgent_insert: { skill: '臨時插單', label: '急單求解' }, preview_multiple_urgent_insert: { skill: '臨時插單', label: '多張急單求解' }, reassign_order_preview: { skill: '臨時插單', label: '換車方案試算' }, change_order_constraint: { skill: '臨時插單', label: '訂單限制試算' }, remove_order_preview: { skill: '臨時插單', label: '移除訂單試算' }, prioritize_order_preview: { skill: '途中調整', label: '提前送達重排' }, inspect_dispatch_deviations: { skill: '途中調整', label: '配送偏差查詢' }, simulate_delay: { skill: '途中調整', label: '延遲風險試算' }, change_frozen_stops: { skill: '途中調整', label: '凍結站點調整' }, enforce_hard_time_windows: { skill: '途中調整', label: '時段限制試算' },
}

function toolActivity(response: ChatResponse): { skill: string; label: string } | null {
  const tool = response.evidence.at(-1)?.tool
  return tool ? toolDisplay[tool] || null : null
}

function optionAssignment(option: UrgentPlanOption): string {
  if (option.change) return option.change.order_id ? `調整訂單 ${option.change.order_id}，其他既有指派維持可核對。` : '依目前要求重新計算，既有方案尚未套用。'
  if (option.inserted_orders.length === 0) return '既有訂單維持可核對的車輛與站點安排。'
  return option.inserted_orders.map((item) => item.status === 'ASSIGNED' ? `${item.order_id} → ${item.vehicle_id} 第 ${item.sequence} 站${item.responsibility ? `（${item.responsibility}）` : ''}` : `${item.order_id} → 需人工處理`).join('；')
}

function delta(value: number | null, unit: string): string {
  if (value === null) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${formatNumber(Math.abs(value), 1)} ${unit}`
}

function optionEta(option: UrgentPlanOption): string {
  const assigned = option.inserted_orders.find((item) => item.status === 'ASSIGNED')
  return formatEta(assigned?.eta || option.estimated_eta)
}

/**
 * 代價指標一律「標籤左、數字右」排成兩欄。
 * 先前用 sm:grid-cols-5，但 Tailwind 斷點看的是視窗寬度而不是容器寬度，
 * 在 392px 的對話面板裡會硬擠成五欄，把「最小餘裕」斷成「最小餘／裕」。
 */
function Metric({ label, value }: { label: string; value: string }) {
  // 標籤結尾保留一個半形空格：拆成兩個元素之後，元素的 textContent 會直接相黏
  // （「換車0 張」），讓既有驗收測試找不到「換車 0 張」。空格在 flex 版面上看不出來，
  // 但讓畫面文字與先前完全一致。
  return (
    <span className="flex items-baseline justify-between gap-2 whitespace-nowrap">
      <span className="text-slate-500">{`${label} `}</span>
      <strong className="font-bold tabular-nums text-slate-900">{value}</strong>
    </span>
  )
}

function OptionCards({ options, onConfirmOption, onManualAdjust }: { options: UrgentPlanOption[]; onConfirmOption?: (option: UrgentPlanOption) => Promise<void>; onManualAdjust?: (option: UrgentPlanOption) => void }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [cancelled, setCancelled] = useState(false)
  const [confirmed, setConfirmed] = useState<string | null>(null)
  if (cancelled) return <div className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600" role="status">已取消這組方案卡，原方案版本沒有變更。</div>
  return <div className="mt-4 space-y-3" role="group" aria-label="臨時插單方案">{options.map((option) => {
    const active = option.option_id === selected
    const content = <><div className="flex items-start justify-between gap-2.5"><div className="min-w-0"><span className="block text-[11px] font-bold tracking-wide text-blue-600">{option.label}</span><strong className="mt-0.5 block text-sm leading-5 text-slate-900">{option.title}</strong></div><Badge tone={option.selectable ? 'success' : 'warning'}>{option.selectable ? '可選' : '需人工處理'}</Badge></div><p className="mt-3 text-sm font-medium leading-6 text-slate-700">{optionAssignment(option)}</p><p className="mt-2 text-xs leading-5 text-slate-500">{option.rationale}</p>{option.selectable && <div className="mt-3 border-t border-slate-100 pt-3"><div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs"><Metric label="距離" value={delta(option.cost.distance_delta_km, 'km')} /><Metric label="時間" value={delta(option.cost.duration_delta_min, '分鐘')} /><Metric label="換車" value={`${option.cost.vehicle_change_count} 張`} />{option.reordered_order_count ? <Metric label="改序" value={`${option.reordered_order_count} 張`} /> : <Metric label="最小餘裕" value={option.cost.minimum_capacity_slack_kg === null ? '—' : `${option.cost.minimum_capacity_slack_kg.toFixed(1)} kg`} />}</div><div className="mt-2.5 flex items-baseline justify-between gap-2 whitespace-nowrap rounded-lg bg-slate-50 px-2.5 py-2"><span className="text-xs text-slate-500">{'預估送達 '}</span><strong className="text-sm font-bold tabular-nums text-slate-900">{optionEta(option)}</strong></div></div>}</>
    const canManualAdjust = option.change?.kind === 'PRIORITIZE_ORDER' && onManualAdjust
    if (!option.selectable) {
      return <div key={option.option_id}><button type="button" aria-pressed={active} className={cn('urgent-card urgent-card-unavailable w-full text-left', active && 'urgent-card-selected')} onClick={() => canManualAdjust && setSelected(option.option_id)}>{content}</button>{active && canManualAdjust && <div className="flex flex-wrap items-center gap-2 rounded-b-lg bg-blue-50 px-3 py-2"><Button type="button" variant="outline" onClick={() => onManualAdjust(option)}>我自己排</Button><Button type="button" variant="ghost" onClick={() => setCancelled(true)}>取消</Button></div>}</div>
    }
    return <div key={option.option_id}><button type="button" aria-pressed={active} className={cn('urgent-card w-full text-left', active && 'urgent-card-selected')} onClick={() => setSelected(option.option_id)}>{content}</button>{active && <div className="flex flex-wrap items-center gap-2 rounded-b-lg bg-blue-50 px-3 py-2"><Button type="button" variant="secondary" disabled={confirmed === option.option_id} onClick={async () => { if (!onConfirmOption) return; try { await onConfirmOption(option); setConfirmed(option.option_id) } catch { /* App renders the deterministic request error. */ } }}>確認套用</Button>{canManualAdjust && <Button type="button" variant="outline" onClick={() => onManualAdjust(option)}>我自己排</Button>}<Button type="button" variant="ghost" onClick={() => setCancelled(true)}>取消</Button><span className="text-xs font-semibold text-blue-800">{confirmed === option.option_id ? '已建立新版本。' : '確認後才會建立新版本。'}</span></div>}</div>
  })}{selected && !confirmed && <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800" role="status">已選擇 {options.find((option) => option.option_id === selected)?.label}，請確認套用或取消。</div>}</div>
}

function SuggestionCards({ suggestions, onConfirm }: { suggestions: DispatchDeviationSuggestion[]; onConfirm?: (suggestion: DispatchDeviationSuggestion) => Promise<void> }) {
  const [confirmed, setConfirmed] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return <div className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600" role="status">先保留目前參數，尚未套用建議。</div>
  return <div className="mt-3 space-y-2" role="group" aria-label="配送參數建議"><p className="text-sm font-semibold text-slate-900">建議調整以下參數：</p>{suggestions.map((suggestion) => <div key={suggestion.suggestion_id} className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-3"><p className="text-sm text-slate-700">{suggestion.message}</p><div className="mt-2 flex flex-wrap items-center gap-2"><Button type="button" variant="secondary" disabled={confirmed === suggestion.suggestion_id} onClick={async () => { if (!onConfirm) return; await onConfirm(suggestion); setConfirmed(suggestion.suggestion_id) }}>套用建議</Button><Button type="button" variant="ghost" onClick={() => setDismissed(true)}>先不要</Button>{confirmed === suggestion.suggestion_id && <span className="text-xs font-semibold text-blue-800">已記錄，重新排班後生效。</span>}</div></div>)}</div>
}

function RuleCards({ options, evidence, onConfirmRule }: { options: DispatchRuleOption[]; evidence?: DispatchRuleEvidence; onConfirmRule?: (option: DispatchRuleOption) => Promise<void> }) {
  const [confirmed, setConfirmed] = useState(false)
  const [cancelled, setCancelled] = useState(false)
  const conflicts = evidence?.conflicts || []
  const resolutions = evidence?.resolution_options || []
  if (cancelled) return <div className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600" role="status">已取消這次規則試算，原方案沒有變更。</div>
  if (evidence?.status === 'NEEDS_CLARIFICATION') {
    if (evidence.clarification_mode === 'PARAMETERS') return null
    return <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-3 text-sm text-blue-900"><p className="font-semibold">請選擇禁止型規則</p>{evidence.options && evidence.options.length > 0 && <div className="mt-2 grid gap-1.5">{evidence.options.map((option) => <div key={String(option.rule_type)} className="rounded-lg bg-white px-3 py-2 text-xs text-slate-700">{/* 中文的 min-content 是「一個字」，flex 會把標籤壓成直排。
    兩邊都必須 whitespace-nowrap，並允許整列換行。 */}
<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"><strong className="whitespace-nowrap text-slate-900">{String(option.label)}</strong><span className="whitespace-nowrap tabular-nums text-slate-500">目前 {String(option.current_value)} {String(option.unit)}</span></div>{Boolean(option.current_detail) && <span className="mt-1 block leading-5 text-slate-500">{String(option.current_detail)}</span>}</div>)}</div>}</div>
  }
  return <div className="mt-3 space-y-3" role="group" aria-label="司機規則試算方案"><div className={cn('rounded-lg border px-3 py-3', evidence?.status === 'CONFLICT' ? 'border-amber-200 bg-amber-50' : 'border-blue-100 bg-blue-50')}><div className="flex items-start justify-between gap-3"><div><strong className="text-sm text-slate-900">{evidence?.rule?.summary || options[0]?.title || '規則試算'}</strong>{evidence?.rule?.additional_rule?.summary && <strong className="mt-1 block text-sm text-slate-900">{evidence.rule.additional_rule.summary}</strong>}</div><Badge tone={evidence?.status === 'CONFLICT' ? 'warning' : 'success'}>{evidence?.status === 'CONFLICT' ? '有衝突' : '可試算'}</Badge></div>{evidence?.trial && <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-blue-100 pt-3 text-xs"><Metric label="影響" value={`${evidence.trial.affected_order_count} 張`} /><Metric label="未安排" value={`${evidence.trial.unassigned_orders.length} 張`} /><Metric label="距離" value={delta(evidence.trial.distance_delta_m / 1000, 'km')} /><Metric label="時間" value={delta(evidence.trial.duration_delta_s / 60, '分鐘')} /></div>}{evidence?.trial && evidence.trial.affected_order_ids.length > 3 && <details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer font-semibold">查看受影響訂單</summary><p className="mt-1 leading-5">{evidence.trial.affected_order_ids.join('、')}</p></details>}{conflicts.length > 0 && <div className="mt-3 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs leading-5 text-amber-900"><p className="font-semibold">衝突原因</p>{conflicts.map((conflict) => <p key={conflict.rule_id}>{conflict.rule_id}：{conflict.order_ids.join('、')}；{conflict.reason}</p>)}<div className="mt-2 flex flex-wrap gap-2">{resolutions.map((item) => <Button key={item.action} type="button" variant="outline" onClick={() => undefined}>{String(item.label)}</Button>)}</div></div>}{options.length > 0 && <div className="mt-3 flex items-center gap-2"><Button type="button" variant="secondary" disabled={confirmed} onClick={async () => { const option = options[0]; if (!onConfirmRule || !option) return; await onConfirmRule(option); setConfirmed(true) }}>套用</Button><Button type="button" variant="ghost" disabled={confirmed} onClick={() => setCancelled(true)}>取消</Button><span className="text-xs font-semibold text-blue-800">{confirmed ? '已套用；重新排班後生效。' : '試算通過後才會建立規則。'}</span></div>}</div></div>
}

export function MappingReview({ pending, value, onChange, name, onNameChange, onConfirm, onCancel, busy }: { pending: PendingMapping; value: Record<string, Record<string, string>>; onChange: (sheet: string, source: string, target: string) => void; name: string; onNameChange: (value: string) => void; onConfirm: () => void; onCancel: () => void; busy: boolean }) {
  const { missing, duplicates } = useMemo(() => {
    const missingFields: string[] = []
    const duplicateFields: string[] = []
    for (const [sheet, fields] of Object.entries(requiredFields)) {
      const mappedTargets = new Set(Object.values(value[sheet] || {}))
      for (const field of fields) if (!mappedTargets.has(field)) missingFields.push(`${sheet}.${field}`)
    }
    for (const [sheet, sourceMap] of Object.entries(value)) {
      const seen = new Set<string>()
      for (const target of Object.values(sourceMap)) {
        if (seen.has(target)) duplicateFields.push(`${sheet}.${target}`)
        seen.add(target)
      }
    }
    return { missing: missingFields, duplicates: duplicateFields }
  }, [value])
  const blockers = [...missing, ...duplicates]
  return <div className="mapping-review" aria-label="欄位對映確認"><div className="flex items-start justify-between gap-3"><div><h3 className="text-base font-bold text-slate-900">請確認欄位對映</h3><p className="mt-1 text-xs leading-5 text-slate-500">只對映欄位名稱；儲存格資料不會由 AI 填補。</p></div><Badge tone={blockers.length ? 'warning' : 'info'}>{blockers.length ? `需修正 ${blockers.length} 項` : '可確認'}</Badge></div><div className="mapping-table-wrap"><table className="mapping-table"><thead><tr><th>工作表</th><th>來源欄位</th><th>對映到</th><th>信心度</th><th>樣本</th></tr></thead><tbody>{pending.response.entries.map((entry) => <tr key={`${entry.sheet}-${entry.source}`}><td>{entry.sheet}</td><td className="font-semibold">{entry.source || '未命名欄位'}</td><td><select aria-label={`欄位 ${entry.sheet} ${entry.source}`} value={value[entry.sheet]?.[entry.source] || ''} onChange={(event) => onChange(entry.sheet, entry.source, event.target.value)}><option value="">不對映</option>{canonicalFields[entry.sheet]?.map((field) => <option key={field} value={field}>{fieldLabels[field] || field}</option>)}</select></td><td>{Math.round(entry.confidence * 100)}%</td><td className="text-slate-500">{entry.sample_values.join('、') || '沒有樣本'}</td></tr>)}</tbody></table></div>{blockers.length > 0 && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">{missing.length > 0 && <div><strong>請補齊必要欄位：</strong>{missing.map((field) => fieldLabel(field) || field).join('、')}</div>}{duplicates.length > 0 && <div><strong>請移除重複對映：</strong>{duplicates.map((field) => fieldLabels[field.split('.').at(-1) || field] || field).join('、')}</div>}</div>}<div className="mt-4 flex flex-wrap items-end gap-2"><label className="min-w-[220px] flex-1 text-xs font-semibold text-slate-600">保存名稱（選填）<input value={name} onChange={(event) => onNameChange(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal outline-none focus:border-blue-500" placeholder="例如：供應商 A" /></label><Button type="button" variant="secondary" disabled={busy || blockers.length > 0} onClick={onConfirm}>確認欄位對映</Button><Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>取消</Button></div></div>
}

export function ChatPanel({ onChat, onInspectFile, onImportFile, onConfirmOption, onConfirmRule, onConfirmDeviation, onManualAdjust, busy, onStop, plan, activity }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [pendingMapping, setPendingMapping] = useState<PendingMapping | null>(null)
  const [mappingDraft, setMappingDraft] = useState<Record<string, Record<string, string>>>({})
  const [mappingName, setMappingName] = useState('')
  const [thinkingPhase, setThinkingPhase] = useState('正在理解你的需求…')
  const [sending, setSending] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const log = useRef<HTMLDivElement>(null)
  const isBusy = busy || sending
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight }, [messages, isBusy])

  async function submit(message = text, selectedFile = file, action?: ChatAction) {
    const value = message.trim() || (selectedFile ? '請檢查這份配送資料並建立方案。' : '')
    if ((!value && !selectedFile) || isBusy) return
    setSending(true)
    setText(''); setFile(null)
    setThinkingPhase('正在理解你的需求…')
    setMessages((items) => [...items, { role: 'user', text: value, attachment: selectedFile?.name }, { role: 'assistant', text: '' }])
    try {
      if (selectedFile) {
        try {
          const mapping = await onInspectFile(selectedFile)
          if (mapping?.status === 'INVALID') {
            const details = mapping.error?.field_errors || []
            throw new Error([mapping.error?.message || '工作簿驗證失敗。', ...details.map(formatValidationError)].join('；'))
          }
          if (mapping?.requires_confirmation) {
            setPendingMapping({ file: selectedFile, response: mapping }); setMappingDraft(mapping.mapping); setMappingName('')
            setMessages((items) => items.map((item, index) => index === items.length - 1 ? { ...item, text: '我已讀取表頭與少量樣本，請先確認欄位對映；我不會自行填補資料值。' } : item))
          } else {
            await onImportFile(selectedFile, mapping?.mapping)
            setMessages((items) => items.map((item, index) => index === items.length - 1 ? { ...item, text: '已送出檔案，正在進行資料驗證與排班。' } : item))
          }
        } catch (error) { setMessages((items) => items.map((item, index) => index === items.length - 1 ? { ...item, text: error instanceof Error ? error.message : '檔案處理失敗。' } : item)) }
        return
      }
      // 只是讓「理解你的需求…」有機會畫出來再送出。
      // 絕對不要用 requestAnimationFrame——分頁沒有在繪製時 rAF 不會觸發，
      // 這一行會擋在 onChat 前面，導致「訊息根本沒送出去」但畫面顯示計算中。
      // 2026-09-14 實測：performance 裡完全沒有 agent/chat 這筆請求，
      // 後端同一句話 8 秒就回完，畫面卻永遠停在「這題比較久，仍在計算」。
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
       setThinkingPhase('正在理解你的需求…')
      const result = await onChat(value, action)
      setThinkingPhase('正在整理結果…')
      const cards = result.response ? responseCards(result.response) : { urgent: [], rules: [], ruleEvidence: undefined, deviations: [] }
      const assistantText = result.response ? evidenceMessage(result.response) : result.error?.trim() || '這則訊息未完成，請再試一次。'
      setMessages((items) => items.map((item, index) => index === items.length - 1 ? { ...item, text: assistantText, response: result.response || undefined, options: cards.urgent, ruleOptions: cards.rules, ruleEvidence: cards.ruleEvidence, deviationSuggestions: cards.deviations } : item))
    } finally {
      setSending(false)
    }
  }

  async function confirmMapping() {
    if (!pendingMapping) return
    try {
      await onImportFile(pendingMapping.file, mappingDraft, mappingName.trim() || undefined)
      setPendingMapping(null); setMappingDraft({}); setMappingName('')
    } catch (error) {
      setMessages((items) => items.map((item, index) => index === items.length - 1 ? { ...item, text: error instanceof Error ? error.message : '對映後的檔案處理失敗。' } : item))
    }
  }
  function chooseFile(candidate: File | undefined) { if (!candidate) return; if (!candidate.name.toLowerCase().endsWith('.xlsx')) { setMessages((items) => [...items, { role: 'assistant', text: '目前只接受 .xlsx Excel 檔案，請重新選擇。' }]); return } if (candidate.size === 0) { setMessages((items) => [...items, { role: 'assistant', text: '這個檔案沒有內容，請重新選擇 Excel。' }]); return } setFile(candidate) }
  function updateMapping(sheet: string, source: string, target: string) { setMappingDraft((current) => { const nextSheet = { ...(current[sheet] || {}) }; if (target) nextSheet[source] = target; else delete nextSheet[source]; return { ...current, [sheet]: nextSheet } }) }

  const emptyPrompt = !plan ? <div className="file-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); chooseFile(event.dataTransfer.files?.[0]) }}><strong>先放入今天的訂單</strong><span>把 Excel 拖到這裡，或點下方「附加檔案」選擇檔案。</span></div> : null
  return <Card className="flex min-h-[620px] flex-col" aria-label="AI 調度助理"><CardHeader><SectionTitle title="調度對話" detail={plan ? '所有方案先預覽，再由調度員確認。' : '上傳資料後，從這裡查看排班結果。'} /><Badge tone="success">可用</Badge></CardHeader><CardContent className="flex min-h-0 flex-1 flex-col gap-4"><div ref={log} className="chat-log" aria-live="polite">{messages.length === 0 && emptyPrompt}{messages.map((message, index) => <div key={`${message.role}-${index}`} className={cn('mb-4 max-w-[94%]', message.role === 'user' ? 'ml-auto' : 'mr-auto')}><div className={cn('rounded-2xl px-4 py-3 text-sm leading-6', message.role === 'user' ? 'rounded-br-md bg-slate-900 text-white' : 'rounded-bl-md border border-slate-200 bg-white text-slate-700')}><div className={cn('mb-1 text-[11px] font-bold', message.role === 'user' ? 'text-slate-300' : 'text-slate-400')}>{message.role === 'user' ? '你' : '調度助理'}</div>{message.attachment && <div className="mb-2 rounded-lg bg-white/10 px-3 py-2 text-xs">附件：{message.attachment}</div>}{message.role === 'assistant' && message.response && toolActivity(message.response) && <span className="chat-activity-skill">{toolActivity(message.response)?.skill} · {toolActivity(message.response)?.label}</span>}<div>{message.text || (isBusy && index === messages.length - 1 ? <>{activity && <span className="chat-activity-skill">● 正在執行：{activity.skill}</span>}<span>{activity?.phase || thinkingPhase}</span><span className="chat-thinking-dots" aria-hidden="true">...</span></> : '')}</div>{message.response && isUrgentReviewReady(message.response) && <div className="mt-3"><Button type="button" variant="secondary" disabled={isBusy} onClick={() => void submit('產生插單預覽', undefined, 'PREVIEW_URGENT')}>產生插單預覽</Button></div>}{message.options && message.options.length > 0 && <OptionCards options={message.options} onConfirmOption={onConfirmOption} onManualAdjust={onManualAdjust} />}{(message.ruleOptions && message.ruleOptions.length > 0 || message.ruleEvidence) && <RuleCards options={message.ruleOptions || []} evidence={message.ruleEvidence} onConfirmRule={onConfirmRule} />}{message.deviationSuggestions && message.deviationSuggestions.length > 0 && <SuggestionCards suggestions={message.deviationSuggestions} onConfirm={onConfirmDeviation} />}</div></div>)}</div>{pendingMapping && <MappingReview pending={pendingMapping} value={mappingDraft} onChange={updateMapping} name={mappingName} onNameChange={setMappingName} onConfirm={() => void confirmMapping()} onCancel={() => { setPendingMapping(null); setMappingDraft({}) }} busy={isBusy} />}{/* 次要動作集中在同一排，把整個寬度讓給輸入框——Demo 要打的是長句子 */}
<div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3"><Button type="button" variant="ghost" className="text-xs" disabled={isBusy} onClick={() => fileInput.current?.click()}>附加檔案</Button></div><div className="flex flex-col gap-2"><div className="flex items-end gap-2"><textarea value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() } }} className="min-h-10 flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" placeholder="輸入配送需求…" aria-label="輸入訊息" rows={1} disabled={isBusy} /><Button type="button" variant="secondary" className="shrink-0" disabled={isBusy || (!text.trim() && !file)} onClick={() => void submit()}>送出</Button>{isBusy && <Button type="button" variant="danger" className="shrink-0" onClick={onStop}>停止</Button>}</div>{file && <div className="flex items-center justify-between gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800" role="status"><span className="min-w-0 truncate">待上傳：{file.name}</span><button type="button" className="shrink-0 whitespace-nowrap font-semibold underline" onClick={() => setFile(null)}>移除</button></div>}</div><input ref={fileInput} className="file-input" type="file" accept=".xlsx" aria-label="上傳 Excel" onChange={(event) => { chooseFile(event.target.files?.[0]); event.currentTarget.value = '' }} /></CardContent></Card>
}
