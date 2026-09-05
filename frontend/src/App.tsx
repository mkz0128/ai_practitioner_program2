import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, chat, compareStrategies, confirmPlan, getMapData, getPlan, getPlanVersions, getProviderStatus, getValidation, importWorkbook, previewDelay, previewReassignment, previewUrgent, restorePlan } from './api'
import { AgentPanel } from './components/AgentPanel'
import { DetailsPanel } from './components/DetailsPanel'
import { MapPanel } from './components/MapPanel'
import { OrderDetailPanel } from './components/OrderDetailPanel'
import { PlanInsights } from './components/PlanInsights'
import { RouteTaskList } from './components/RouteTaskList'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { TaskTable } from './components/TaskTable'
import { VehiclePanel } from './components/VehiclePanel'
import type { ChatResponse, DelayPreview, MapData, Plan, PlanVersionSummary, ProviderStatus, StrategyComparison, UrgentOrderPayload, UrgentPackagePayload, UrgentPreview, ValidationPayload } from './types'
import './styles.css'

type ChatProgress = (step: string) => void
type ChatSubmitResult = { response: ChatResponse | null; error?: string }
const ACTIVE_PLAN_STORAGE_KEY = 'dispatch.active-plan'

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    const fields = error.fieldErrors.map((field) => `${field.path}: ${field.message}`).join('；')
    return fields ? `${error.message} ${fields}` : `${error.message}（${error.code}）`
  }
  return error instanceof Error ? error.message : '發生未預期錯誤。'
}

function previewPayload(data: Record<string, unknown>): { order: UrgentOrderPayload; packages: UrgentPackagePayload[] } | null {
  const order = data.structured_order
  const packages = data.structured_packages
  if (!order || !Array.isArray(packages)) return null
  if (typeof order !== 'object' || order === null) return null
  return { order: order as UrgentOrderPayload, packages: packages as UrgentPackagePayload[] }
}

export default function App() {
  const [activeView, setActiveView] = useState<'assistant' | 'tasks' | 'tracking'>('assistant')
  const [sessionId] = useState(() => `CONVERSATION-${Math.random().toString(36).slice(2, 10).toUpperCase()}`)
  const [validation, setValidation] = useState<ValidationPayload | null>(null)
  const [activeDatasetId, setActiveDatasetId] = useState<string | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [mapData, setMapData] = useState<MapData | null>(null)
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [mapsConfigured, setMapsConfigured] = useState(Boolean(
    import.meta.env.VITE_GOOGLE_MAPS_BROWSER_API_KEY || window.__DISPATCH_RUNTIME_CONFIG__?.googleMapsBrowserApiKey,
  ))
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
      .then((config) => { if (config) setMapsConfigured(Boolean(config.google_maps_browser_api_key)) })
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
        setPlan(activePlan)
        setActiveDatasetId(activePlan.dataset_id)
        window.localStorage.setItem(ACTIVE_PLAN_STORAGE_KEY, JSON.stringify({ plan_id: activePlan.plan_id, version: activePlan.version }))
        setActiveOrderId(activePlan.vehicles.find((vehicle) => vehicle.stops.length)?.stops[0]?.order_id ?? null)
        setMapData(await getMapData(activePlan.plan_id, activePlan.version, controller.signal))
        reportProgress?.('方案已建立')
      }
      const previewEvidence = response.evidence.find((item) =>
        (item.tool === 'preview_urgent_insert' || item.tool === 'preview_structured_urgent_insert') && item.data.status === 'PREVIEWED')
      const structuredPreview = previewEvidence ? previewPayload(previewEvidence.data) : null
      if (structuredPreview && activePlan && (!preview || preview.base_version !== activePlan.version)) {
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

  const handleConfirm = async () => {
    if (!plan || !preview) return
    setBusy(true); setError(null)
    try {
      const confirmed = await confirmPlan(plan.plan_id, preview.preview_version)
      setPlan(confirmed)
      window.localStorage.setItem(ACTIVE_PLAN_STORAGE_KEY, JSON.stringify({ plan_id: confirmed.plan_id, version: confirmed.version }))
      setMapData(await getMapData(confirmed.plan_id, confirmed.version))
      setPlanVersions(null)
      setNotice(`已確認方案版本 ${confirmed.version}；本控制塔未執行 Dispatch。`)
    } catch (requestError) { setError(errorText(requestError)) }
    finally { setBusy(false) }
  }

  const handleCompareStrategies = async () => {
    if (!plan || busy) return
    setBusy(true); setError(null)
    try { setStrategyComparison(await compareStrategies(plan.dataset_id)) }
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
    } catch (requestError) { setError(errorText(requestError)) }
    finally { setBusy(false) }
  }

  if (demoGate.required && !demoGate.authenticated) {
    return <div className="demo-gate"><form className="demo-login-card" onSubmit={loginToDemo}><div className="brand-mark">AI</div><h1>展示環境登入</h1><p>請輸入展示密碼以開始使用配送調度 Copilot。</p><input aria-label="展示密碼" type="password" autoComplete="current-password" value={demoPassword} onChange={(event) => setDemoPassword(event.target.value)} placeholder="展示密碼" /><button className="control-button" type="submit" disabled={demoLoginBusy}>{demoLoginBusy ? '登入中…' : '登入展示環境'}</button>{demoLoginError && <div className="error-box" role="alert">{demoLoginError}</div>}</form></div>
  }

  return <div className="app-shell">
    <Sidebar activeView={activeView} onViewChange={setActiveView} />
    <div className="app-content">
      <StatusBar plan={plan} providers={providers} mapsConfigured={mapsConfigured} activeView={activeView} onViewChange={setActiveView} />
      <main className="page-content">
        {activeView === 'assistant' && <>
          <div className="assistant-layout">
            <AgentPanel onChat={handleChat} onUseExample={handleUseExample} onStop={handleStop} busy={busy} />
            <MapPanel data={mapData} activeVehicle={activeVehicle} onSelectVehicle={setActiveVehicle} onSelectOrder={setActiveOrderId} />
          </div>
          <VehiclePanel plan={plan} activeVehicle={activeVehicle} onSelectVehicle={setActiveVehicle} onReassignPreview={handleReassignPreview} />
          <DetailsPanel plan={plan} preview={preview} onConfirm={handleConfirm} onCancelPreview={handleCancelPreview} busy={busy} activeOrderId={activeOrderId} onSelectOrder={setActiveOrderId} />
          <PlanInsights plan={plan} comparison={strategyComparison} delayPreview={delayPreview} versions={planVersions} busy={busy} onCompare={handleCompareStrategies} onDelay={handleDelayPreview} onLoadVersions={handleLoadVersions} onRestore={handleRestoreVersion} />
        </>}
        {activeView === 'tasks' && <>
          <div className="page-title-row"><div><div className="eyebrow">工作區</div><h1>配送任務</h1><p>搜尋訂單、查看配送狀態與 AI 提供的證據摘要。</p></div><button type="button" className="control-button" onClick={() => setActiveView('assistant')}>＋ 匯入新資料</button></div>
          <div className="task-page-grid"><TaskTable plan={plan} activeOrderId={activeOrderId} onSelectOrder={setActiveOrderId} /><OrderDetailPanel plan={plan} orderId={activeOrderId} /></div>
          <VehiclePanel plan={plan} activeVehicle={activeVehicle} onSelectVehicle={setActiveVehicle} onReassignPreview={handleReassignPreview} />
        </>}
        {activeView === 'tracking' && <>
          <div className="page-title-row"><div><div className="eyebrow">工作區</div><h1>路線追蹤</h1><p>依車輛查看配送順序與目前的路線風險。</p></div><div className="route-date">今日 · {plan ? `${plan.summary.assigned_order_count} 張訂單` : '尚未建立方案'}</div></div>
          <div className="tracking-page-grid"><MapPanel data={mapData} activeVehicle={activeVehicle} onSelectVehicle={setActiveVehicle} onSelectOrder={setActiveOrderId} /><RouteTaskList data={mapData} plan={plan} activeVehicle={activeVehicle} onSelectVehicle={setActiveVehicle} onSelectOrder={setActiveOrderId} /></div>
          <VehiclePanel plan={plan} activeVehicle={activeVehicle} onSelectVehicle={setActiveVehicle} onReassignPreview={handleReassignPreview} />
        </>}
      </main>
      <div className="app-feedback">
      {busy && <div className="hint">正在整理訂單與配送方案…</div>}
      {notice && <div className="success-box">{notice}</div>}
      {validation && !validation.is_valid && <div className="warning-box">資料驗證需要人工複核：{validation.errors.map((item) => item.path).join('、')}</div>}
      {error && <div className="error-box" role="alert">{error}</div>}
      <div className="hint" style={{ marginTop: 10 }}>安全邊界：本畫面只會執行匯入、驗證、排程、Agent 查詢、插單 preview 與人工確認；不提供自動 Dispatch、部署或正式環境操作。</div>
      </div>
    </div>
  </div>
}
