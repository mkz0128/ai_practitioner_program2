import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, chat, confirmCrossVehicleRouteOrder, confirmDispatchParameter, confirmDispatchRule, confirmPlan, confirmRouteOrder, createPlan, deactivateDispatchRule, getDispatchRules, getMapData, getPlanVersions, getProviderStatus, importWorkbook, inspectWorkbook, NetworkRequestError, previewCrossVehicleRouteOrder, previewRouteOrder, resetRuntimeState, restorePlan, simulateDeparture, startLoading, NETWORK_FAILURE_MESSAGE } from './api'
import { ChatPanel } from './components/ChatPanel'
import { MapView } from './components/MapView'
import { OrderTable } from './components/OrderTable'
import { Badge, Button, Card, CardContent } from './components/ui'
import { VehicleBoard } from './components/VehicleBoard'
import { TimelineBoard } from './components/TimelineBoard'
import { FleetRail } from './components/FleetRail'
import { DeviationBoard } from './components/DeviationBoard'
import { formatNumber } from './lib/utils'
import { formatValidationError } from './lib/fieldLabels'
import type { ChatResponse, ColumnMappingResponse, CrossVehicleRouteOrderPreview, DispatchDeviationSuggestion, DispatchRuleOption, DispatchRuleRecord, MapData, Plan, ProviderStatus, RouteOrderPreview, UrgentPlanOption } from './types'
import './styles.css'

type ActivityState = { skill: string; phase: string }

function createSessionId(): string {
  return `CONVERSATION-${crypto.randomUUID()}`
}

function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    const labels: Record<string, string> = { AGENT_UNAVAILABLE: 'AI 助理目前未連線；資料匯入與確定性排班仍可使用。', AGENT_RUN_FAILED: 'AI 助理暫時無法完成這次要求，請重試。', INVALID_XLSX: '這個檔案不是可讀取的 Excel，請提供有效的 .xlsx 檔案。', INVALID_HEADERS: '工作表欄位需要先完成對映確認。', DUPLICATE_ID: '發現重複的訂單編號，請修正後再上傳。' }
    if (error.fieldErrors.length > 0) return `${error.message} ${error.fieldErrors.map(formatValidationError).join('；')}`
    return (labels[error.code] || error.message).trim() || '這次要求未完成，請再試一次。'
  }
  if (error instanceof NetworkRequestError || error instanceof TypeError) return NETWORK_FAILURE_MESSAGE
  return error instanceof Error ? error.message : '操作失敗，請稍後再試。'
}

function mappingError(response: ColumnMappingResponse): string {
  const details = response.error?.field_errors || []
  const labels: Record<string, string> = {
    INVALID_FILE_TYPE: '只接受 .xlsx 檔案。',
    INVALID_XLSX: '這個檔案不是可讀取的 Excel，請提供有效的 .xlsx 檔案。',
    EMPTY_WORKBOOK: '這個檔案沒有內容，請重新選擇 Excel。',
    INVALID_SHEETS: '工作表需要包含 orders、packages、vehicles、zones。',
    DATASET_VALIDATION_FAILED: '工作簿驗證失敗。',
  }
  const code = response.error?.code || ''
  return [labels[code] || response.error?.message || '工作簿驗證失敗。', ...details.map(formatValidationError)].join('；')
}

function stageLabel(stage: Plan['stage']): string {
  if (stage === 'LOADED') return '上車後'
  if (stage === 'DISPATCHED') return '已發車'
  return '上車前'
}

function previewInsertedOrderId(response: ChatResponse): string | null {
  const workflow = response.evidence.find((item) => item.tool === 'urgent_insertion_workflow')
  const preview = workflow?.data.preview
  if (!preview || typeof preview !== 'object' || !Array.isArray((preview as Record<string, unknown>).inserted_orders)) return null
  const inserted = (preview as Record<string, unknown>).inserted_orders as unknown[]
  const first = inserted.find((item) => item !== null && typeof item === 'object' && typeof (item as Record<string, unknown>).order_id === 'string')
  return first && typeof (first as Record<string, unknown>).order_id === 'string' ? (first as Record<string, unknown>).order_id as string : null
}

function DispatchRuleBoard({ rules, activeCount, expanded, busy, onToggle, onDeactivate }: { rules: DispatchRuleRecord[]; activeCount: number; expanded: boolean; busy: boolean; onToggle: () => void; onDeactivate: (ruleId: string) => void; rulesExpanded?: boolean }) {
  if (rules.length === 0) return null
  return <Card aria-label="司機規則清單"><CardContent><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="mt-1 text-base font-bold text-slate-900">已套用 {formatNumber(activeCount)} 條規則</h2></div><Button type="button" variant="outline" aria-expanded={expanded} onClick={onToggle}>{expanded ? '收合規則清單' : '展開規則清單'}</Button></div>{expanded && <div className="mt-4 space-y-3">{rules.map((rule) => <div key={rule.rule_id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><strong className="text-sm text-slate-900">{rule.summary}</strong><Badge tone={rule.active_now ? 'success' : 'neutral'}>{rule.active_now ? '啟用中' : '已停用'}</Badge></div>{rule.active_now && <Button type="button" variant="ghost" disabled={busy} onClick={() => onDeactivate(rule.rule_id)}>停用</Button>}</div><p className="mt-2 text-xs leading-5 text-slate-600">原句：{rule.source_utterance}</p>{rule.expires_at && <p className="mt-1 text-xs text-slate-500">到期：{rule.expires_at}</p>}</div>)}</div>}</CardContent></Card>
}

export default function App() {
  const [sessionId, setSessionId] = useState(createSessionId)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [map, setMap] = useState<MapData | null>(null)
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [dispatchRules, setDispatchRules] = useState<DispatchRuleRecord[]>([])
  const [activeRuleCount, setActiveRuleCount] = useState(0)
  const [rulesExpanded, setRulesExpanded] = useState(false)
  const [activeVehicle, setActiveVehicle] = useState<string | null>(null)
  const [activeOrder, setActiveOrder] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [activity, setActivity] = useState<ActivityState | null>(null)
  const [timelineMinutes, setTimelineMinutes] = useState(120)
  const [confirmedParameterSuggestions, setConfirmedParameterSuggestions] = useState<string[]>([])
  const [showDeviationSuggestions, setShowDeviationSuggestions] = useState(false)
  const [conversationOrderId, setConversationOrderId] = useState<string | null>(null)
  const [manualAdjustTarget, setManualAdjustTarget] = useState<{ vehicleId: string | null; orderId: string | null }>({ vehicleId: null, orderId: null })
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => { getProviderStatus().then((result) => setProviders(result.providers)).catch(() => setProviders([])); getDispatchRules().then((result) => { setDispatchRules(result.rules); setActiveRuleCount(result.active_count) }).catch(() => { setDispatchRules([]); setActiveRuleCount(0) }) }, [])

  const refreshDispatchRules = useCallback(async () => {
    const result = await getDispatchRules()
    setDispatchRules(result.rules)
    setActiveRuleCount(result.active_count)
  }, [])

  const loadFile = useCallback(async (file: File, columnMapping?: Record<string, Record<string, string>>, mappingName?: string) => {
    setBusy(true); setError(null); setNotice('讀取今日訂單…'); setActivity({ skill: '每日排班', phase: '讀取訂單…' })
    abortRef.current?.abort(); const controller = new AbortController(); abortRef.current = controller
    try {
      const imported = await importWorkbook(file, columnMapping, mappingName, controller.signal)
      if (!imported.validation.is_valid) { setError(imported.validation.errors.map(formatValidationError).join('；') || '資料需要人工複核，請先修正。'); return }
      setNotice('建立距離矩陣…'); setActivity({ skill: '每日排班', phase: '建立距離矩陣…' })
      // 這裡只是讓「建立距離矩陣…」有機會畫出來再往下跑。
      // 不要用 requestAnimationFrame——分頁沒有在繪製時（視窗被蓋住、
      // 投影切換、瀏覽器面板隱藏）rAF 永遠不會觸發，整個開場就卡死在這一行。
      // 2026-09-14 實測：Playwright 有在繪製所以看不出來，真的開瀏覽器就中。
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
      setNotice('OR-Tools 求解中…'); setActivity({ skill: '每日排班', phase: 'OR-Tools 求解中…' })
      const created = await createPlan(imported.dataset_id, 'BALANCED', controller.signal)
      setActivity({ skill: '每日排班', phase: '獨立驗證中…' }); setPlan(created); setConversationOrderId(created.vehicles.find((vehicle) => vehicle.stops.length > 0)?.stops[0]?.order_id || null); setMap(await getMapData(created.plan_id, created.version, controller.signal)); await refreshDispatchRules(); setNotice(`已完成 ${formatNumber(created.completeness.assigned_order_count)}／${formatNumber(created.completeness.total_order_count)} 張訂單的排班，方案待人工確認。`)
    } catch (requestError) { if (!(requestError instanceof DOMException && requestError.name === 'AbortError')) setError(friendlyError(requestError)) } finally { setBusy(false); setActivity(null) }
  }, [refreshDispatchRules])

  const inspectFile = useCallback(async (file: File): Promise<ColumnMappingResponse | null> => {
    setBusy(true); setError(null); setNotice(null); setActivity({ skill: '每日排班', phase: '讀取訂單…' })
    abortRef.current?.abort(); const controller = new AbortController(); abortRef.current = controller
    try {
      const result = await inspectWorkbook(file, controller.signal)
      return result.status === 'CANONICAL' ? null : result
    } finally {
      setBusy(false); setActivity(null)
    }
  }, [])

  const handleInitialFile = useCallback(async (file: File) => {
    if (!file) return
    try {
      const mapping = await inspectFile(file)
      if (mapping?.status === 'INVALID') { setError(mappingError(mapping)); return }
      if (mapping?.requires_confirmation) {
        setError('這份檔案需要欄位對映確認，請從調度對話的「附加檔案」上傳並確認。')
        return
      }
      await loadFile(file, mapping?.mapping)
    } catch (requestError) {
      setError(friendlyError(requestError))
    }
  }, [inspectFile, loadFile])

  const onChat = useCallback(async (message: string, action?: 'PREVIEW_URGENT'): Promise<{ response: ChatResponse | null; error?: string }> => {
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    try {
      const response = await chat(sessionId, message, { plan_id: plan?.plan_id || null, plan_version: plan?.version || null, dataset_id: plan?.dataset_id || null, order_id: conversationOrderId, stage: plan?.stage || 'PRE_LOAD', timeline_minutes: plan?.stage === 'DISPATCHED' ? timelineMinutes : null }, controller.signal, action)
      const deviationView = response.evidence.find((entry) => entry.tool === 'inspect_dispatch_deviations')?.data.view
      if (deviationView === 'SUGGESTIONS') setShowDeviationSuggestions(true)
      if (deviationView === 'SUMMARY') setShowDeviationSuggestions(false)
      const insertedOrderId = previewInsertedOrderId(response)
      if (insertedOrderId) setConversationOrderId(insertedOrderId)
      const priorityPreviewVersion = response.evidence.find(
        (entry) => entry.tool === 'prioritize_order_preview',
      )?.data.preview_version
      if (
        response.plan_id &&
        typeof priorityPreviewVersion === 'number'
      ) {
        setMap(
          await getMapData(
            response.plan_id,
            priorityPreviewVersion,
            undefined,
            plan?.stage === 'DISPATCHED' ? timelineMinutes : undefined,
          ),
        )
      }
      return { response }
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === 'AbortError') return { response: null, error: '已停止這次計算。' }
      return { response: null, error: friendlyError(requestError) }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [conversationOrderId, plan, sessionId, timelineMinutes])

  const handleConfirmOption = useCallback(async (option: UrgentPlanOption) => {
    if (busy) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const confirmed = await confirmPlan(option.plan_id, option.preview_version, sessionId)
      setPlan(confirmed)
      setMap(await getMapData(confirmed.plan_id, confirmed.version))
      if (option.change?.order_id) setConversationOrderId(option.change.order_id)
      setNotice(`已確認${option.label}，建立新版本 v${confirmed.version}；原版本仍保留。`)
    } catch (requestError) { setError(friendlyError(requestError)) } finally { setBusy(false) }
  }, [busy, sessionId])

  const handleConfirmRule = useCallback(async (option: DispatchRuleOption) => {
    if (!plan || busy || !option.plan_id || option.base_version === null) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const result = await confirmDispatchRule(option)
      await refreshDispatchRules()
      const replanned = await createPlan(plan.dataset_id, plan.objective || 'BALANCED')
      setPlan(replanned)
      setMap(await getMapData(replanned.plan_id, replanned.version))
      setConversationOrderId(replanned.vehicles.find((vehicle) => vehicle.stops.length > 0)?.stops[0]?.order_id || null)
      setRulesExpanded(true)
      const ruleCountText = option.rule.additional_rule ? '1 條規則設定（含兩項限制）' : `${formatNumber(result.active_count)} 條規則`
      setNotice(`已套用 ${ruleCountText}；已依新規則重新排班。`)
    } catch (requestError) { setError(friendlyError(requestError)) } finally { setBusy(false) }
  }, [busy, plan, refreshDispatchRules])

  const handleConfirmDeviation = useCallback(async (suggestion: DispatchDeviationSuggestion) => {
    if (!plan || busy || plan.stage !== 'DISPATCHED') return
    setBusy(true); setError(null); setNotice(null)
    try {
      await confirmDispatchParameter(plan.plan_id, plan.version, suggestion.zone_code, suggestion.from_service_minutes, suggestion.to_service_minutes)
      setConfirmedParameterSuggestions((current) => current.includes(suggestion.suggestion_id) ? current : [...current, suggestion.suggestion_id])
      setShowDeviationSuggestions(true)
      setMap(await getMapData(plan.plan_id, plan.version, undefined, timelineMinutes))
      setNotice(`已確認 ${suggestion.zone_code} 服務時間 ${suggestion.from_service_minutes} → ${suggestion.to_service_minutes} 分鐘；重新排班後生效。`)
    } catch (requestError) { setError(friendlyError(requestError)) } finally { setBusy(false) }
  }, [busy, plan, timelineMinutes])

  const handleManualAdjust = useCallback((option: UrgentPlanOption) => {
    const vehicleId = option.current_state?.vehicle_id || null
    const orderId = option.change?.order_id || null
    setManualAdjustTarget({ vehicleId, orderId })
    window.setTimeout(() => { document.querySelector('[aria-label="訂單看板"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, 0)
  }, [])

  const handleDeactivateRule = useCallback(async (ruleId: string) => {
    if (busy) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const result = await deactivateDispatchRule(ruleId)
      await refreshDispatchRules()
      setNotice(`規則已停用，目前已套用 ${formatNumber(result.active_count)} 條規則。`)
    } catch (requestError) { setError(friendlyError(requestError)) } finally { setBusy(false) }
  }, [busy, refreshDispatchRules])

  const handleReplan = useCallback(async () => {
    if (!plan || busy) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const replanned = await createPlan(plan.dataset_id, plan.objective || 'BALANCED')
      setPlan(replanned)
      setMap(await getMapData(replanned.plan_id, replanned.version))
      setConversationOrderId(replanned.vehicles.find((vehicle) => vehicle.stops.length > 0)?.stops[0]?.order_id || null)
      setNotice(replanned.parameter_replan?.applied ? `已重新排班；已用新參數重新排班，目前 ${formatNumber(replanned.completeness.assigned_order_count)}／${formatNumber(replanned.completeness.total_order_count)} 張已安排，結果如實顯示。` : activeRuleCount > 0 ? `已重新排班，確定性求解器已套用 ${formatNumber(activeRuleCount)} 條規則。` : '已重新排班，方案待人工確認。')
    } catch (requestError) { setError(friendlyError(requestError)) } finally { setBusy(false) }
  }, [activeRuleCount, busy, plan])

  const handleStartLoading = useCallback(async () => {
    if (!plan || busy) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const loaded = await startLoading(plan.plan_id, plan.version)
      setPlan(loaded)
      setMap(await getMapData(loaded.plan_id, loaded.version))
      setNotice('已開始裝車。既有訂單的車輛指派已鎖定，現在可調整配送順序與合法插單。')
    } catch (requestError) { setError(friendlyError(requestError)) } finally { setBusy(false) }
  }, [busy, plan])

  const handleSimulateDeparture = useCallback(async () => {
    if (!plan || busy) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const dispatched = await simulateDeparture(plan.plan_id, plan.version)
      const startingMinutes = 120
      setTimelineMinutes(startingMinutes)
      setPlan(dispatched)
      setMap(await getMapData(dispatched.plan_id, dispatched.version, undefined, startingMinutes))
      setNotice('已進入本地示範的已發車階段；正式 Dispatch 仍維持停用。')
    } catch (requestError) { setError(friendlyError(requestError)) } finally { setBusy(false) }
  }, [busy, plan])

  const handleUnloadRequest = useCallback(() => {
    setError('已開始裝車；回到上車前會牽涉卸貨重裝，請由現場主管人工處理，系統沒有靜默退回。')
  }, [])

  const handleTimelineChange = useCallback(async (value: number) => {
    if (!plan || plan.stage !== 'DISPATCHED') return
    setBusy(true)
    setError(null)
    setTimelineMinutes(value)
    try {
      const nextMap = await getMapData(plan.plan_id, plan.version, undefined, value)
      setMap(nextMap)
      const nextStop = nextMap.routes
        .flatMap((route) => route.stops)
        .find((stop) => stop.status === 'CURRENT' || stop.status === 'UPCOMING')
      if (nextStop) setConversationOrderId(nextStop.order_id)
    } catch (requestError) { setError(friendlyError(requestError)) } finally { setBusy(false) }
  }, [plan])

  const handlePreviewRouteOrder = useCallback(async (vehicleId: string, orderIds: string[]): Promise<RouteOrderPreview> => {
    if (!plan) throw new Error('目前沒有可預覽的方案。')
    return previewRouteOrder(plan.plan_id, plan.version, vehicleId, orderIds, plan.stage === 'DISPATCHED' ? timelineMinutes : undefined)
  }, [plan, timelineMinutes])

  const handleConfirmRouteOrder = useCallback(async (preview: RouteOrderPreview) => {
    if (!plan || busy) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const confirmed = await confirmRouteOrder(plan.plan_id, plan.version, preview.vehicle_id, preview.order_ids, plan.stage === 'DISPATCHED' ? timelineMinutes : undefined)
      setPlan(confirmed)
      setMap(await getMapData(confirmed.plan_id, confirmed.version, undefined, confirmed.stage === 'DISPATCHED' ? timelineMinutes : undefined))
      setNotice(`已套用 ${preview.vehicle_id} 新站序，方案版本更新為 v${confirmed.version}。`)
    } catch (requestError) { setError(friendlyError(requestError)); throw requestError } finally { setBusy(false) }
  }, [busy, plan, timelineMinutes])

  const handlePreviewCrossVehicleRouteOrder = useCallback(async (sourceVehicleId: string, targetVehicleId: string, orderId: string, targetSequence: number): Promise<CrossVehicleRouteOrderPreview> => {
    if (!plan) throw new Error('目前沒有可預覽的方案。')
    return previewCrossVehicleRouteOrder(plan.plan_id, plan.version, sourceVehicleId, targetVehicleId, orderId, targetSequence, plan.stage === 'DISPATCHED' ? timelineMinutes : undefined)
  }, [plan, timelineMinutes])

  const handleConfirmCrossVehicleRouteOrder = useCallback(async (preview: CrossVehicleRouteOrderPreview) => {
    if (!plan || busy) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const confirmed = await confirmCrossVehicleRouteOrder(plan.plan_id, plan.version, preview.source_vehicle_id, preview.target_vehicle_id, preview.order_id, preview.target_sequence, plan.stage === 'DISPATCHED' ? timelineMinutes : undefined)
      setPlan(confirmed)
      setMap(await getMapData(confirmed.plan_id, confirmed.version, undefined, confirmed.stage === 'DISPATCHED' ? timelineMinutes : undefined))
      setNotice(`已套用 ${preview.order_id} 的跨車站序，方案版本更新為 v${confirmed.version}。`)
    } catch (requestError) { setError(friendlyError(requestError)); throw requestError } finally { setBusy(false) }
  }, [busy, plan, timelineMinutes])

  const handleHistoryMove = useCallback(async (direction: 'undo' | 'redo') => {
    if (!plan || busy) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const history = await getPlanVersions(plan.plan_id)
      const versions = [...history.versions].sort((left, right) => left.version - right.version)
      const index = versions.findIndex((item) => item.version === plan.version)
      const target = direction === 'undo' ? versions[index - 1] : versions[index + 1]
      if (!target) { setNotice(direction === 'undo' ? '目前沒有更早的可復原版本。' : '目前沒有更新的可前進版本。'); return }
      const restored = await restorePlan(plan.plan_id, target.version)
      setPlan(restored)
      setMap(await getMapData(restored.plan_id, restored.version, undefined, restored.stage === 'DISPATCHED' ? timelineMinutes : undefined))
      setNotice(`${direction === 'undo' ? '已回到' : '已前進到'}第 ${target.version} 版預覽。`)
    } catch (requestError) { setError(friendlyError(requestError)) } finally { setBusy(false) }
  }, [busy, plan, timelineMinutes])

  const reset = async () => { abortRef.current?.abort(); setSessionId(createSessionId()); setPlan(null); setMap(null); setActiveVehicle(null); setActiveOrder(null); setManualAdjustTarget({ vehicleId: null, orderId: null }); setConversationOrderId(null); setTimelineMinutes(120); setConfirmedParameterSuggestions([]); setShowDeviationSuggestions(false); setError(null); setNotice(null); setActivity(null); try { await resetRuntimeState() } catch (requestError) { setError(friendlyError(requestError)) } }
  const google = providers.find((item) => item.name === 'google_routes')

  if (!plan) return <div className="empty-shell"><div className="empty-chat"><ChatPanel key={sessionId} onChat={onChat} onInspectFile={inspectFile} onImportFile={loadFile} onConfirmOption={handleConfirmOption} onConfirmRule={handleConfirmRule} onConfirmDeviation={handleConfirmDeviation} onManualAdjust={handleManualAdjust} busy={busy} onStop={() => abortRef.current?.abort()} plan={false} activity={activity} /></div>{error && <div className="feedback feedback-error" role="alert">{error}</div>}</div>

  return (
    <div className={`app-shell stage-${(plan.stage || 'PRE_LOAD').toLowerCase()}`}>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-lockup">
            <span className="brand-mark">DT</span>
            <div>
              <h1>配送調度控制塔</h1>
            </div>
          </div>
          <div className="topbar-stats">
            <span><strong>{plan.completeness.total_order_count}</strong> 張訂單</span>
            <span><strong>{plan.vehicles.length}</strong> 台車</span>
            <span className="stat-headline"><strong>{plan.completeness.assigned_order_count}/{plan.completeness.total_order_count}</strong> 已安排</span>
            {activeRuleCount > 0 && <span className="stat-rule"><strong>{activeRuleCount}</strong> 條規則</span>}
          </div>
          <div className="topbar-actions">
            <label className="toolbar-upload">換一份資料<input className="file-input" type="file" accept=".xlsx" aria-label="上傳 Excel" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleInitialFile(file); event.currentTarget.value = '' }} /></label>
            {plan.stage === 'PRE_LOAD' && <Button type="button" variant="secondary" disabled={busy} onClick={() => void handleStartLoading()}>開始裝車</Button>}
            {plan.stage === 'PRE_LOAD' && <Button type="button" variant="outline" disabled={busy} onClick={() => void handleReplan()}>重新排班</Button>}
            {plan.stage === 'DISPATCHED' && confirmedParameterSuggestions.length > 0 && <Button type="button" variant="secondary" disabled={busy} onClick={() => void handleReplan()}>用新參數重排</Button>}
            {plan.stage === 'LOADED' && <><Button type="button" variant="secondary" disabled={busy} onClick={() => void handleSimulateDeparture()}>模擬出發</Button><Button type="button" variant="ghost" disabled={busy} onClick={handleUnloadRequest}>退回上車前（需人工處理）</Button></>}
            <Button type="button" variant="outline" onClick={() => void reset()}>重新開始</Button>
          </div>
        </div>
        {/* 階段列是整場 Demo 的劇情指示器：顏色隨階段改變，台下一眼看出推進到哪一幕 */}
        <div className="status-strip">
          <span className="stage-pill"><i />{stageLabel(plan.stage)}</span>
          <span className="stage-note">{plan.stage === 'PRE_LOAD' ? '貨還在站內，車輛指派與順序都可以改' : plan.stage === 'LOADED' ? '貨已在車上，不能跨車移動，只能改順序' : '車在路上，只能重排還沒送的站'}</span>
          <span className="status-provider">模擬資料 · OSM 底圖 · Google Routes {google?.enabled ? '未採用' : '停用'}</span>
        </div>
      </header>

      <div className="stage">
        <div className="stage-map">
          <MapView data={map} activeVehicle={activeVehicle} onSelectVehicle={setActiveVehicle} onSelectOrder={setActiveOrder} />
        </div>

        <div className="stage-chat">
          <ChatPanel key={sessionId} onChat={onChat} onInspectFile={inspectFile} onImportFile={loadFile} onConfirmOption={handleConfirmOption} onConfirmRule={handleConfirmRule} onConfirmDeviation={handleConfirmDeviation} onManualAdjust={handleManualAdjust} busy={busy} onStop={() => abortRef.current?.abort()} plan activity={activity} />
        </div>

        <div className="stage-dock">
          <FleetRail data={map} plan={plan} activeVehicle={activeVehicle} onSelectVehicle={setActiveVehicle} />
        </div>

        <div className="stage-toasts">
          {error && <div className="feedback feedback-error" role="alert">{error}</div>}
          {notice && <div className="feedback feedback-success" role="status">{notice}</div>}
        </div>
      </div>

      <section className="detail-drawer" aria-label="方案明細">
        <div className="detail-inner">
          {plan.stage === 'DISPATCHED' && map && <TimelineBoard data={map} timelineMinutes={timelineMinutes} onChange={(value) => void handleTimelineChange(value)} />}
           <DeviationBoard data={map?.deviations} busy={busy} showSuggestions={showDeviationSuggestions} confirmedSuggestionIds={confirmedParameterSuggestions} onConfirm={(suggestion) => void handleConfirmDeviation(suggestion)} />
          <VehicleBoard plan={plan} activeVehicle={activeVehicle} onSelectVehicle={setActiveVehicle} />
          <DispatchRuleBoard rules={dispatchRules} activeCount={activeRuleCount} expanded={rulesExpanded} busy={busy} onToggle={() => setRulesExpanded((value) => !value)} onDeactivate={(ruleId) => void handleDeactivateRule(ruleId)} rulesExpanded={rulesExpanded} />
          <OrderTable plan={plan} activeOrderId={activeOrder} manualVehicleId={manualAdjustTarget.vehicleId} manualOrderId={manualAdjustTarget.orderId} onSelectOrder={setActiveOrder} onHistoryMove={handleHistoryMove} onPreviewRouteOrder={handlePreviewRouteOrder} onConfirmRouteOrder={handleConfirmRouteOrder} onPreviewCrossVehicleRouteOrder={handlePreviewCrossVehicleRouteOrder} onConfirmCrossVehicleRouteOrder={handleConfirmCrossVehicleRouteOrder} />
          <p className="safety-note">所有數字來自後端確定性計算；方案先預覽，經人工確認後才會建立新版本。</p>
        </div>
      </section>
    </div>
  )
}
