import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, chat, confirmPlan, createPlan, getMapData, getProviderStatus, getValidation, importWorkbook, previewUrgent } from './api'
import { AgentPanel } from './components/AgentPanel'
import { DetailsPanel } from './components/DetailsPanel'
import { MapPanel } from './components/MapPanel'
import { OrderDetailPanel } from './components/OrderDetailPanel'
import { RouteTaskList } from './components/RouteTaskList'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { TaskTable } from './components/TaskTable'
import { VehiclePanel } from './components/VehiclePanel'
import type { ChatResponse, MapData, Plan, ProviderStatus, UrgentPreview, ValidationPayload } from './types'
import './styles.css'

type ChatProgress = (step: string) => void
type ChatSubmitResult = { response: ChatResponse | null; error?: string }

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    const fields = error.fieldErrors.map((field) => `${field.path}: ${field.message}`).join('；')
    return fields ? `${error.message} ${fields}` : `${error.message}（${error.code}）`
  }
  return error instanceof Error ? error.message : '發生未預期錯誤。'
}

export default function App() {
  const [activeView, setActiveView] = useState<'assistant' | 'tasks' | 'tracking'>('assistant')
  const [sessionId] = useState(() => `CONVERSATION-${Math.random().toString(36).slice(2, 10).toUpperCase()}`)
  const [validation, setValidation] = useState<ValidationPayload | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [mapData, setMapData] = useState<MapData | null>(null)
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [preview, setPreview] = useState<UrgentPreview | null>(null)
  const [activeVehicle, setActiveVehicle] = useState<string | null>(null)
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const refreshProviders = useCallback(async () => {
    try { setProviders((await getProviderStatus()).providers) } catch { setProviders([]) }
  }, [])

  useEffect(() => { void refreshProviders() }, [refreshProviders])

  const prepareAttachment = async (file: File, reportProgress: ChatProgress, signal: AbortSignal): Promise<Plan | null> => {
    if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('只接受 .xlsx Excel 檔案，請選擇正確格式。')
    if (file.size === 0) throw new Error('這個 Excel 檔案是空的，請重新選擇檔案。')
    reportProgress('正在讀取訂單')
    const imported = await importWorkbook(file, signal)
    const report = await getValidation(imported.dataset_id, signal)
    setValidation(report.validation)
    reportProgress('資料驗證完成')
    if (!report.validation.is_valid) {
      const fields = report.validation.errors.map((item) => item.path).join('、')
      throw new Error(`資料需要人工複核${fields ? `：${fields}` : '。'}`)
    }
    reportProgress('正在規劃配送')
    const nextPlan = await createPlan(imported.dataset_id, signal)
    setPlan(nextPlan)
    setActiveOrderId(nextPlan.vehicles.find((vehicle) => vehicle.stops.length)?.stops[0]?.order_id ?? null)
    setMapData(await getMapData(nextPlan.plan_id, nextPlan.version, signal))
    await refreshProviders()
    reportProgress('方案已建立')
    setNotice(`已匯入 ${imported.counts.orders} 張訂單、${imported.counts.vehicles} 台車；方案仍需人工確認。`)
    return nextPlan
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
      let activePlan = plan
      if (attachment) activePlan = await prepareAttachment(attachment, reportProgress || (() => undefined), controller.signal)
      const response = await chat(sessionId, message, activePlan ? { plan_id: activePlan.plan_id, plan_version: activePlan.version } : {}, controller.signal)
      const previewEvidence = response.evidence.some((item) => item.tool === 'preview_urgent_insert' && item.data.status === 'PREVIEWED')
      if (previewEvidence && activePlan && (!preview || preview.base_version !== activePlan.version)) {
        // The Agent tool remains evidence-only; this REST preview creates the
        // proposed immutable version used by the human confirmation button.
        setPreview(await previewUrgent(activePlan.plan_id, activePlan.version, controller.signal))
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

  const handlePreview = async () => {
    if (!plan) return
    setBusy(true); setError(null)
    try { setPreview(await previewUrgent(plan.plan_id, plan.version)); setActiveView('assistant') }
    catch (requestError) { setError(errorText(requestError)) }
    finally { setBusy(false) }
  }

  const handleConfirm = async () => {
    if (!plan || !preview) return
    setBusy(true); setError(null)
    try {
      const confirmed = await confirmPlan(plan.plan_id, preview.preview_version)
      setPlan(confirmed)
      setMapData(await getMapData(confirmed.plan_id, confirmed.version))
      setNotice(`已確認方案版本 ${confirmed.version}；本控制塔未執行 Dispatch。`)
    } catch (requestError) { setError(errorText(requestError)) }
    finally { setBusy(false) }
  }

  return <div className="app-shell">
    <Sidebar activeView={activeView} onViewChange={setActiveView} />
    <div className="app-content">
      <StatusBar plan={plan} providers={providers} activeView={activeView} onViewChange={setActiveView} />
      <main className="page-content">
        {activeView === 'assistant' && <>
          <div className="assistant-layout">
            <AgentPanel onChat={handleChat} onUseExample={handleUseExample} onStop={handleStop} busy={busy} />
            <MapPanel data={mapData} activeVehicle={activeVehicle} onSelectVehicle={setActiveVehicle} onSelectOrder={setActiveOrderId} />
          </div>
          <VehiclePanel plan={plan} activeVehicle={activeVehicle} onSelectVehicle={setActiveVehicle} />
          <DetailsPanel plan={plan} preview={preview} onPreview={handlePreview} onConfirm={handleConfirm} busy={busy} activeOrderId={activeOrderId} onSelectOrder={setActiveOrderId} />
        </>}
        {activeView === 'tasks' && <>
          <div className="page-title-row"><div><div className="eyebrow">工作區</div><h1>配送任務</h1><p>搜尋訂單、查看配送狀態與 AI 提供的證據摘要。</p></div><button type="button" className="control-button" onClick={() => setActiveView('assistant')}>＋ 匯入新資料</button></div>
          <div className="task-page-grid"><TaskTable plan={plan} activeOrderId={activeOrderId} onSelectOrder={setActiveOrderId} /><OrderDetailPanel plan={plan} orderId={activeOrderId} /></div>
          <VehiclePanel plan={plan} activeVehicle={activeVehicle} onSelectVehicle={setActiveVehicle} />
        </>}
        {activeView === 'tracking' && <>
          <div className="page-title-row"><div><div className="eyebrow">工作區</div><h1>路線追蹤</h1><p>依車輛查看配送順序與目前的路線風險。</p></div><div className="route-date">今日 · {plan ? `${plan.summary.assigned_order_count} 張訂單` : '尚未建立方案'}</div></div>
          <div className="tracking-page-grid"><MapPanel data={mapData} activeVehicle={activeVehicle} onSelectVehicle={setActiveVehicle} onSelectOrder={setActiveOrderId} /><RouteTaskList data={mapData} plan={plan} activeVehicle={activeVehicle} onSelectVehicle={setActiveVehicle} onSelectOrder={setActiveOrderId} /></div>
          <VehiclePanel plan={plan} activeVehicle={activeVehicle} onSelectVehicle={setActiveVehicle} />
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
