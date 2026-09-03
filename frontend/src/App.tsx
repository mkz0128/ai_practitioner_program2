import { useCallback, useEffect, useState } from 'react'
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

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    const fields = error.fieldErrors.map((field) => `${field.path}: ${field.message}`).join('；')
    return fields ? `${error.message} ${fields}` : `${error.message}（${error.code}）`
  }
  return error instanceof Error ? error.message : '發生未預期錯誤。'
}

export default function App() {
  const [activeView, setActiveView] = useState<'assistant' | 'tasks' | 'tracking'>('assistant')
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

  const refreshProviders = useCallback(async () => {
    try { setProviders((await getProviderStatus()).providers) } catch { setProviders([]) }
  }, [])

  useEffect(() => { void refreshProviders() }, [refreshProviders])

  const handleImport = async (file: File) => {
    setBusy(true); setError(null); setNotice(null); setPreview(null)
    try {
      const imported = await importWorkbook(file)
      const report = await getValidation(imported.dataset_id)
      setValidation(report.validation)
      const nextPlan = await createPlan(imported.dataset_id)
      setPlan(nextPlan)
      setActiveOrderId(nextPlan.vehicles.find((vehicle) => vehicle.stops.length)?.stops[0]?.order_id ?? null)
      setMapData(await getMapData(nextPlan.plan_id, nextPlan.version))
      await refreshProviders()
      setNotice(`已匯入 ${imported.counts.orders} 張訂單、${imported.counts.vehicles} 台車；方案仍需人工確認。`)
    } catch (requestError) { setError(errorText(requestError)) }
    finally { setBusy(false) }
  }

  const handleChat = async (message: string): Promise<ChatResponse | null> => {
    if (!plan) return null
    setError(null)
    try {
      return await chat('CONTROL-TOWER-SESSION', message, { plan_id: plan.plan_id, plan_version: plan.version })
    } catch (requestError) { setError(errorText(requestError)); return null }
  }

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
          <div className="page-title-row"><div><div className="eyebrow">工作區</div><h1>今天的配送協作</h1><p>先匯入訂單，再用自然語言和 AI 一起檢視方案。</p></div><div className="page-actions"><span className={`status-chip ${plan?.validation.valid ? 'live' : 'neutral'}`}>{plan ? (plan.validation.valid ? '方案已驗證' : '需要複核') : '等待匯入'}</span></div></div>
          <div className="assistant-layout">
            <AgentPanel plan={plan} onChat={handleChat} onImport={handleImport} onPreview={handlePreview} busy={busy} />
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
      {busy && <div className="hint">正在向後端取得驗證、排程或 preview evidence…</div>}
      {notice && <div className="success-box">{notice}</div>}
      {validation && !validation.is_valid && <div className="warning-box">資料驗證需要人工複核：{validation.errors.map((item) => item.path).join('、')}</div>}
      {error && <div className="error-box" role="alert">{error}</div>}
      <div className="hint" style={{ marginTop: 10 }}>安全邊界：本畫面只會執行匯入、驗證、排程、Agent 查詢、插單 preview 與人工確認；不提供自動 Dispatch、部署或正式環境操作。</div>
      </div>
    </div>
  </div>
}
