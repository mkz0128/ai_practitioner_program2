import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, chat, compareStrategies, confirmPlan, getMapData, getPlan, getPlanVersions, getProviderStatus, getValidation, importWorkbook, previewDelay, previewReassignment, previewUrgent, restorePlan } from './api'
import { AgentPanel } from './components/AgentPanel'
import { DetailsPanel } from './components/DetailsPanel'
import { MapPanel } from './components/MapPanel'
import { PlanInsights } from './components/PlanInsights'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { VehiclePanel } from './components/VehiclePanel'
import type { ChatResponse, DelayPreview, MapData, Plan, PlanVersionSummary, ProviderStatus, StrategyComparison, UrgentOrderPayload, UrgentPackagePayload, UrgentPreview, ValidationPayload } from './types'
import './styles.css'

type ChatProgress = (step: string) => void
type ChatSubmitResult = { response: ChatResponse | null; error?: string }
const ACTIVE_PLAN_STORAGE_KEY = 'dispatch.active-plan'

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    const fields = error.fieldErrors.map((field) => `${field.path}: ${field.message}`).join('；')
    if (fields) return `${error.message} ${fields}`
    const friendlyErrors: Record<string, string> = {
      AGENT_RUN_FAILED: 'AI 助理暫時無法完成這次要求，請重試；目前方案沒有變更。',
      AGENT_UNAVAILABLE: 'AI 助理目前未連線，資料匯入與既有方案仍可查看。',
      PROVIDER_UNAVAILABLE: '路線服務暫時無法使用，請稍後重試；系統不會把示範資料當成即時結果。',
      PLAN_NOT_CONFIRMABLE: '這份方案仍有未安排訂單或規則問題，目前不能確認。',
      REASSIGNMENT_NOT_FEASIBLE: '這次換車不符合載重、服務區域或時段限制，原方案沒有變更。',
    }
    return friendlyErrors[error.code] || error.message
  }
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return '暫時無法完成這次操作，請重試。'
  return error instanceof Error ? error.message : '發生未預期錯誤。'
}

function previewPayload(data: Record<string, unknown>): { order: UrgentOrderPayload; packages: UrgentPackagePayload[] } | null {
  const order = data.structured_order
  const packages = data.structured_packages
  if (!order || !Array.isArray(packages)) return null
  if (typeof order !== 'object' || order === null) return null
  return { order: order as UrgentOrderPayload, packages: packages as UrgentPackagePayload[] }
}

function rejectedPreviewFromEvidence(data: Record<string, unknown>, activePlan: Plan): UrgentPreview | null {
  if (data.feasible !== false) return null
  if (!data.before || !data.after || !data.comparison || !data.diff) return null
  if (typeof data.before !== 'object' || typeof data.after !== 'object'
    || typeof data.comparison !== 'object' || typeof data.diff !== 'object') return null
  return {
    plan_id: activePlan.plan_id,
    base_version: activePlan.version,
    preview_version: activePlan.version,
    feasible: false,
    requires_human_confirmation: true,
    mode: data.mode === 'MINIMAL_CHANGE' ? 'MINIMAL_CHANGE' : 'FULL_REPLAN',
    full_replan_reason: typeof data.full_replan_reason === 'string' ? data.full_replan_reason : null,
    affected_vehicle_count: typeof data.affected_vehicle_count === 'number' ? data.affected_vehicle_count : 0,
    moved_order_count: typeof data.moved_order_count === 'number' ? data.moved_order_count : 0,
    before: data.before as Plan['summary'],
    after: data.after as Plan['summary'],
    comparison: data.comparison as UrgentPreview['comparison'],
    diff: data.diff as UrgentPreview['diff'],
  }
}

function rejectedReassignmentPreview(error: ApiError, activePlan: Plan, orderId: string, targetVehicleId: string): UrgentPreview | null {
  if (error.code !== 'REASSIGNMENT_NOT_FEASIBLE') return null
  const sourceVehicleId = activePlan.vehicles.find((vehicle) => vehicle.stops.some((stop) => stop.order_id === orderId))?.vehicle_id
  return {
    plan_id: activePlan.plan_id,
    base_version: activePlan.version,
    preview_version: activePlan.version,
    feasible: false,
    requires_human_confirmation: true,
    mode: 'MINIMAL_CHANGE',
    full_replan_reason: null,
    rejection_reason: '目標車輛的載重、服務區域或配送時段不符合要求；原方案完全沒有變更。',
    affected_vehicle_count: new Set([sourceVehicleId, targetVehicleId].filter(Boolean)).size,
    moved_order_count: 0,
    before: activePlan.summary,
    after: activePlan.summary,
    comparison: {
      base_algorithm: activePlan.algorithm,
      preview_algorithm: activePlan.algorithm,
      base_dataset_hash: activePlan.dataset_hash || '',
      preview_dataset_hash: activePlan.dataset_hash || '',
    },
    diff: {
      inserted_order_id: orderId,
      reassigned_orders: [],
      sequence_changes: [],
      vehicle_load_changes: [],
      total_distance_delta_m: 0,
      total_duration_delta_s: 0,
    },
  }
}

export default function App() {
  const [activeView, setActiveView] = useState<'assistant' | 'tasks' | 'tracking'>('assistant')
  const [sessionId] = useState(() => `CONVERSATION-${Math.random().toString(36).slice(2, 10).toUpperCase()}`)
  const [validation, setValidation] = useState<ValidationPayload | null>(null)
  const [activeDatasetId, setActiveDatasetId] = useState<string | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [mapData, setMapData] = useState<MapData | null>(null)
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [mapsStatus, setMapsStatus] = useState<'missing' | 'configured' | 'connected' | 'failed'>(() =>
    import.meta.env.VITE_GOOGLE_MAPS_BROWSER_API_KEY || window.__DISPATCH_RUNTIME_CONFIG__?.googleMapsBrowserApiKey ? 'configured' : 'missing',
  )
  const [preview, setPreview] = useState<UrgentPreview | null>(null)
  const [strategyComparison, setStrategyComparison] = useState<StrategyComparison | null>(null)
  const [delayPreview, setDelayPreview] = useState<DelayPreview | null>(null)
  const [planVersions, setPlanVersions] = useState<{ current_version: number; versions: PlanVersionSummary[] } | null>(null)
  const [activeVehicle, setActiveVehicle] = useState<string | null>(null)
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [demoGate, setDemoGate] = useState({ required: false, authenticated: true })
  const [demoPassword, setDemoPassword] = useState('')
  const [demoLoginError, setDemoLoginError] = useState<string | null>(null)
  const [demoLoginBusy, setDemoLoginBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    // The local app has no gate by default. A Render deployment can enable it
    // with DEMO_ACCESS_PASSWORD without baking the password into the bundle.
    void fetch('/auth/status')
      .then((response) => (response.ok ? response.json() as Promise<{ required?: boolean; authenticated?: boolean }> : null))
      .then((status) => {
        if (status?.required) setDemoGate({ required: true, authenticated: Boolean(status.authenticated) })
      })
      .catch(() => undefined)
  }, [])

  const loginToDemo = async (event: FormEvent) => {
    event.preventDefault()
    if (!demoPassword || demoLoginBusy) return
    setDemoLoginBusy(true); setDemoLoginError(null)
    try {
      const response = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ password: demoPassword }),
      })
      if (!response.ok) throw new Error('展示環境密碼不正確。')
      setDemoGate({ required: true, authenticated: true })
      setDemoPassword('')
      await refreshProviders()
    } catch (loginError) {
      setDemoLoginError(loginError instanceof Error ? loginError.message : '登入失敗，請重試。')
    } finally { setDemoLoginBusy(false) }
  }

  const refreshProviders = useCallback(async () => {
    try { setProviders((await getProviderStatus()).providers) } catch { setProviders([]) }
  }, [])

  useEffect(() => { void refreshProviders() }, [refreshProviders])

  useEffect(() => {
    // The Browser key is public client configuration. Read only its presence
    // for status display; the value is never rendered or logged here.
    void fetch('/api/v1/runtime-config')
      .then((response) => (response.ok ? response.json() as Promise<{ google_maps_browser_api_key?: string }> : null))
      .then((config) => {
        if (config) {
          setMapsStatus((current) => current === 'connected'
            ? current
            : config.google_maps_browser_api_key ? 'configured' : 'missing')
        }
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    let cancelled = false
    const stored = window.localStorage.getItem(ACTIVE_PLAN_STORAGE_KEY)
    if (!stored) return () => { cancelled = true }
    try {
      const reference = JSON.parse(stored) as { plan_id?: unknown; version?: unknown }
      if (typeof reference.plan_id !== 'string') throw new Error('INVALID_PLAN_REFERENCE')
      void getPlan(reference.plan_id, typeof reference.version === 'number' ? reference.version : undefined)
        .then(async (restored) => {
          if (cancelled) return
          if (restored.algorithm !== 'ORTOOLS') {
            window.localStorage.removeItem(ACTIVE_PLAN_STORAGE_KEY)
            setNotice('先前儲存的是快速初步方案，已停止載入；請建立新的最佳化配送方案。')
            return
          }
          setPlan(restored)
          setMapData(await getMapData(restored.plan_id, restored.version))
          setActiveOrderId(restored.vehicles.find((vehicle) => vehicle.stops.length)?.stops[0]?.order_id ?? null)
        })
        .catch(() => window.localStorage.removeItem(ACTIVE_PLAN_STORAGE_KEY))
    } catch {
      window.localStorage.removeItem(ACTIVE_PLAN_STORAGE_KEY)
    }
    return () => { cancelled = true }
  }, [])

  const prepareAttachment = async (file: File, reportProgress: ChatProgress, signal: AbortSignal): Promise<string> => {
    if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('只接受 .xlsx Excel 檔案，請選擇正確格式。')
    if (file.size === 0) throw new Error('這個 Excel 檔案是空的，請重新選擇檔案。')
    reportProgress('正在讀取訂單')
    const imported = await importWorkbook(file, signal)
    setActiveDatasetId(imported.dataset_id)
    const report = await getValidation(imported.dataset_id, signal)
    setValidation(report.validation)
    reportProgress('資料驗證完成')
    if (!report.validation.is_valid) {
      const fields = report.validation.errors.map((item) => item.path).join('、')
      throw new Error(`資料需要人工複核${fields ? `：${fields}` : '。'}`)
    }
    await refreshProviders()
    setNotice(`已匯入 ${imported.counts.orders} 張訂單、${imported.counts.vehicles} 台車；接著由 Agent 依你的要求建立方案。`)
    return imported.dataset_id
  }

  const handleUseExample = async (): Promise<File> => {
    const response = await fetch('/demo-delivery-40-orders.xlsx')
    if (!response.ok) throw new Error('範例資料載入失敗。')
    return new File([await response.blob()], 'demo-delivery-40-orders.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  }

  const handleChat = async (message: string, attachment?: File, reportProgress?: ChatProgress): Promise<ChatSubmitResult> => {
    setBusy(true); setError(null); setNotice(null)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      let datasetId = activeDatasetId
      if (attachment) datasetId = await prepareAttachment(attachment, reportProgress || (() => undefined), controller.signal)
      const context: Record<string, unknown> = plan
        ? { plan_id: plan.plan_id, plan_version: plan.version }
        : (datasetId ? { dataset_id: datasetId } : {})
      if (datasetId && !plan) reportProgress?.('正在規劃配送')
      const response = await chat(sessionId, message, context, controller.signal)
      let activePlan = plan
      if (response.plan_id) {
        activePlan = await getPlan(response.plan_id, response.plan_version ?? undefined)
        if (activePlan.algorithm !== 'ORTOOLS') {
          throw new Error('正式方案必須使用最佳化配送方案，快速初步方案只能用於比較。')
        }
        setPlan(activePlan)
        setActiveDatasetId(activePlan.dataset_id)
        window.localStorage.setItem(ACTIVE_PLAN_STORAGE_KEY, JSON.stringify({ plan_id: activePlan.plan_id, version: activePlan.version }))
        setActiveOrderId(activePlan.vehicles.find((vehicle) => vehicle.stops.length)?.stops[0]?.order_id ?? null)
        setMapData(await getMapData(activePlan.plan_id, activePlan.version, controller.signal))
        reportProgress?.('方案已建立')
      }
      const previewEvidence = response.evidence.find((item) =>
        item.tool === 'preview_urgent_insert' || item.tool === 'preview_structured_urgent_insert')
      const structuredPreview = previewEvidence ? previewPayload(previewEvidence.data) : null
      const rejectedPreview = previewEvidence && activePlan
        ? rejectedPreviewFromEvidence(previewEvidence.data, activePlan)
        : null
      if (rejectedPreview) {
        // An infeasible deterministic preview is evidence worth showing, but it
        // must never be persisted as a candidate version or become confirmable.
        setPreview(rejectedPreview)
      } else if (structuredPreview && activePlan && (!preview || preview.base_version !== activePlan.version)) {
        // The Agent tool remains evidence-only; this REST preview creates the
        // proposed immutable version used by the human confirmation button.
        setPreview(await previewUrgent(activePlan.plan_id, activePlan.version, structuredPreview.order, structuredPreview.packages, controller.signal))
      }
      return { response }
    } catch (requestError) {
      const messageText = requestError instanceof DOMException && requestError.name === 'AbortError' ? '已停止這次處理。' : errorText(requestError)
      return { response: null, error: messageText }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setBusy(false)
    }
  }

  const handleStop = () => { abortRef.current?.abort() }

  const handleReset = () => {
    abortRef.current?.abort()
    window.localStorage.removeItem(ACTIVE_PLAN_STORAGE_KEY)
    setValidation(null); setActiveDatasetId(null); setPlan(null); setMapData(null); setPreview(null)
    setStrategyComparison(null); setDelayPreview(null); setPlanVersions(null); setActiveVehicle(null); setActiveOrderId(null)
    setBusy(false); setError(null); setNotice('已清除目前畫面與未確認變更，可以重新匯入訂單。')
  }

  const handleConfirm = async () => {
    if (!plan || (!preview && !plan.confirmability.can_confirm)) return
    setBusy(true); setError(null)
    try {
      const confirmed = await confirmPlan(plan.plan_id, preview?.preview_version ?? plan.version)
      setPlan(confirmed)
      setPreview(null)
      window.localStorage.setItem(ACTIVE_PLAN_STORAGE_KEY, JSON.stringify({ plan_id: confirmed.plan_id, version: confirmed.version }))
      setMapData(await getMapData(confirmed.plan_id, confirmed.version))
      setPlanVersions(null)
      setNotice(`已確認方案版本 ${confirmed.version}；本控制塔未執行正式派車。`)
    } catch (requestError) { setError(errorText(requestError)) }
    finally { setBusy(false) }
  }

  const handleCompareStrategies = async () => {
    if (!plan || busy) return
    setBusy(true); setError(null)
    try { setStrategyComparison(await compareStrategies(plan.dataset_id, plan.plan_id, plan.version)) }
    catch (requestError) { setError(errorText(requestError)) }
    finally { setBusy(false) }
  }

  const handleDelayPreview = async (minutes: 10 | 20 | 30) => {
    if (!plan || busy) return
    setBusy(true); setError(null)
    try { setDelayPreview(await previewDelay(plan.plan_id, plan.version, minutes)) }
    catch (requestError) { setError(errorText(requestError)) }
    finally { setBusy(false) }
  }

  const handleLoadVersions = async () => {
    if (!plan || busy) return
    setBusy(true); setError(null)
    try { setPlanVersions(await getPlanVersions(plan.plan_id)) }
    catch (requestError) { setError(errorText(requestError)) }
    finally { setBusy(false) }
  }

  const handleRestoreVersion = async (version: number) => {
    if (!plan || busy) return
    setBusy(true); setError(null)
    try {
      const restored = await restorePlan(plan.plan_id, version)
      setPlan(restored)
      setMapData(await getMapData(restored.plan_id, restored.version))
      window.localStorage.setItem(ACTIVE_PLAN_STORAGE_KEY, JSON.stringify({ plan_id: restored.plan_id, version: restored.version }))
      setPlanVersions(null)
      setNotice(`已建立復原草稿 V${restored.version}；請人工確認後再套用。`)
    } catch (requestError) { setError(errorText(requestError)) }
    finally { setBusy(false) }
  }

  const handleCancelPreview = async () => {
    if (!plan || !preview || busy) return
    setBusy(true); setError(null)
    try {
      setPreview(null)
      setMapData(await getMapData(plan.plan_id, preview.base_version))
      setNotice('已取消這次預覽；目前方案維持未變更。')
    } catch (requestError) { setError(errorText(requestError)) }
    finally { setBusy(false) }
  }

  const handleReassignPreview = async (orderId: string, targetVehicleId: string) => {
    if (!plan || busy) return
    setBusy(true); setError(null)
    try {
      const result = await previewReassignment(plan.plan_id, plan.version, orderId, targetVehicleId)
      const affected = new Set<string>()
      result.diff.vehicle_load_changes.forEach((change) => { if (typeof change.vehicle_id === 'string') affected.add(change.vehicle_id) })
      result.diff.sequence_changes.forEach((change) => {
        if (typeof change.from_vehicle_id === 'string') affected.add(change.from_vehicle_id)
        if (typeof change.to_vehicle_id === 'string') affected.add(change.to_vehicle_id)
      })
      setPreview({ ...result, feasible: result.validator.valid, requires_human_confirmation: true, mode: 'MINIMAL_CHANGE', full_replan_reason: null, affected_vehicle_count: affected.size, moved_order_count: result.diff.reassigned_orders.length, comparison: { base_algorithm: plan.algorithm, preview_algorithm: plan.algorithm, base_dataset_hash: plan.dataset_hash || '', preview_dataset_hash: plan.dataset_hash || '' } })
      // A reassignment response is an immutable PROPOSED preview. Keep the
      // current plan pointer on the confirmed/base version until the operator
      // explicitly confirms it, while showing the preview geometry in the map.
      setMapData(await getMapData(plan.plan_id, result.preview_version))
      setActiveVehicle(targetVehicleId)
      setActiveOrderId(orderId)
    } catch (requestError) {
      if (requestError instanceof ApiError) {
        const rejected = rejectedReassignmentPreview(requestError, plan, orderId, targetVehicleId)
        if (rejected) {
          setPreview(rejected)
          setActiveVehicle(targetVehicleId)
          setActiveOrderId(orderId)
          return
        }
      }
      setError(errorText(requestError))
    }
    finally { setBusy(false) }
  }

  if (demoGate.required && !demoGate.authenticated) {
    return <div className="demo-gate"><form className="demo-login-card" onSubmit={loginToDemo}><div className="brand-mark">AI</div><h1>展示環境登入</h1><p>請輸入展示密碼以開始使用配送調度 Copilot。</p><input aria-label="展示密碼" type="password" autoComplete="current-password" value={demoPassword} onChange={(event) => setDemoPassword(event.target.value)} placeholder="展示密碼" /><button className="control-button" type="submit" disabled={demoLoginBusy}>{demoLoginBusy ? '登入中…' : '登入展示環境'}</button>{demoLoginError && <div className="error-box" role="alert">{demoLoginError}</div>}</form></div>
  }

  return <div className="app-shell">
    <Sidebar activeView={activeView} onViewChange={(view) => { setActiveView(view); document.getElementById(view === 'assistant' ? 'planning' : view)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }} />
    <div className="app-content">
      <StatusBar plan={plan} providers={providers} mapsStatus={mapsStatus} onReset={handleReset} />
      <main className="page-content">
          <div className="control-tower-grid" id="planning">
            <AgentPanel onChat={handleChat} onUseExample={handleUseExample} onStop={handleStop} busy={busy} />
            <MapPanel data={mapData} activeVehicle={activeVehicle} onSelectVehicle={setActiveVehicle} onSelectOrder={setActiveOrderId} onMapStatus={setMapsStatus} />
            <VehiclePanel plan={plan} activeVehicle={activeVehicle} onSelectVehicle={setActiveVehicle} onReassignPreview={handleReassignPreview} />
          </div>
          <div id="tasks"><DetailsPanel plan={plan} preview={preview} onConfirm={handleConfirm} onCancelPreview={handleCancelPreview} busy={busy} activeOrderId={activeOrderId} onSelectOrder={setActiveOrderId} /></div>
          <div id="tracking">
          <PlanInsights plan={plan} comparison={strategyComparison} delayPreview={delayPreview} versions={planVersions} busy={busy} onCompare={handleCompareStrategies} onDelay={handleDelayPreview} onLoadVersions={handleLoadVersions} onRestore={handleRestoreVersion} />
          </div>
      </main>
      <div className="app-feedback">
      {busy && <div className="hint">正在整理訂單與配送方案…</div>}
      {notice && <div className="success-box">{notice}</div>}
      {validation && !validation.is_valid && <div className="warning-box">資料驗證需要人工複核：{validation.errors.map((item) => item.path).join('、')}</div>}
      {error && <div className="error-box" role="alert">{error}</div>}
      <div className="hint safety-note" style={{ marginTop: 10 }}>所有方案變更都會先預覽，並在人工確認後才會套用。</div>
      </div>
    </div>
  </div>
}
