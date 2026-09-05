import { useEffect, useRef, useState } from 'react'
import type { ChatResponse } from '../types'

type ChatProgress = (step: string) => void
type ChatSubmitResult = { response: ChatResponse | null; error?: string }

interface AttachmentMeta {
  name: string
  type: string
  size: number
}

interface Message {
  role: 'user' | 'agent'
  text: string
  attachment?: AttachmentMeta
  evidence?: ChatResponse['evidence']
  progress?: string[]
}

interface AgentPanelProps {
  onChat: (message: string, attachment?: File, onProgress?: ChatProgress) => Promise<ChatSubmitResult>
  onUseExample?: () => Promise<File>
  onStop: () => void
  busy: boolean
}

const suggestions = ['你可以做什麼？', 'Excel 需要哪些欄位？', '你如何避免超載？']

export function friendlyText(text: string, evidence: ChatResponse['evidence'] = []): string {
  const normalized = text
    .replace(/ORTOOLS/g, '最佳化排程')
    .replace(/BASELINE/g, '快速初步方案')
    .replace(/UNASSIGNABLE/g, '目前無法安排')
    .replace(/Validator/gi, '方案檢查')
    .replace(/Dispatch/gi, '正式派車')
    .replace(/SIMULATED/g, '示範資料')
    .replace(/GOOGLE_LIVE/g, 'Google 即時資料')
    .replace(/FEASIBLE/g, '可行')
  const planEvidence = evidence.find((item) => item.tool === 'plan_dispatch')?.data
  const highestLoadEvidence = evidence.find((item) => item.tool === 'highest_load_vehicle')?.data
  const missingFieldsEvidence = evidence.find((item) => item.tool === 'request_missing_fields')?.data
  const vehicleAvailabilityEvidence = evidence.find((item) => item.tool === 'change_vehicle_availability')?.data
  const urgentInsertEvidence = evidence.find((item) => item.tool === 'preview_urgent_insert')?.data
  if (missingFieldsEvidence && Array.isArray(missingFieldsEvidence.missing_fields)) {
    const labels: Record<string, string> = {
      order_id: '訂單編號', zone_code: '配送區域', city: '城市', district: '行政區',
      location_label: '配送地點', latitude: '緯度', longitude: '經度', time_slot: '配送時段',
      declared_package_count: '包裹件數', packages: '包裹重量',
    }
    const missing = missingFieldsEvidence.missing_fields.map((field) => labels[String(field)] || String(field))
    return `要進行插單，還需要補充：${missing.join('、')}。`
  }
  if (highestLoadEvidence && typeof highestLoadEvidence.vehicle_id === 'string') {
    const load = typeof highestLoadEvidence.planned_load_kg === 'number' ? highestLoadEvidence.planned_load_kg.toFixed(1) : '—'
    const capacity = typeof highestLoadEvidence.max_load_kg === 'number' ? highestLoadEvidence.max_load_kg.toFixed(1) : '—'
    const utilization = typeof highestLoadEvidence.load_utilization === 'number' ? `${(highestLoadEvidence.load_utilization * 100).toFixed(1)}%` : '—'
    return `目前載重最高的是 ${highestLoadEvidence.vehicle_id}，載重 ${load}／${capacity} kg，使用率 ${utilization}。`
  }
  if (vehicleAvailabilityEvidence && typeof vehicleAvailabilityEvidence.vehicle_id === 'string') {
    const unavailable = vehicleAvailabilityEvidence.status === 'UNAVAILABLE'
    const action = unavailable ? '暫停使用' : '恢復使用'
    return `已依你提供的狀況，建立 ${vehicleAvailabilityEvidence.vehicle_id} ${action}的重新安排預覽；尚未套用，請先查看影響並由調度員確認。`
  }
  if (urgentInsertEvidence && typeof urgentInsertEvidence.order_id === 'string') {
    const diff = urgentInsertEvidence.diff && typeof urgentInsertEvidence.diff === 'object'
      ? urgentInsertEvidence.diff as Record<string, unknown>
      : {}
    const affected = typeof urgentInsertEvidence.affected_vehicle_count === 'number' ? urgentInsertEvidence.affected_vehicle_count : 0
    const moved = typeof urgentInsertEvidence.moved_order_count === 'number' ? urgentInsertEvidence.moved_order_count : 0
    const distance = typeof diff.total_distance_delta_m === 'number' ? diff.total_distance_delta_m : null
    const duration = typeof diff.total_duration_delta_s === 'number' ? diff.total_duration_delta_s : null
    const parts = [`已建立 ${urgentInsertEvidence.order_id} 的插單預覽，影響 ${affected} 台車，既有訂單換車 ${moved} 張。`]
    if (distance !== null) parts.push(`總距離${distance >= 0 ? '增加' : '減少'} ${Math.abs(distance).toLocaleString()} 公尺。`)
    if (duration !== null) parts.push(`行車時間${duration >= 0 ? '增加' : '減少'} ${Math.abs(duration).toLocaleString()} 秒。`)
    const validator = urgentInsertEvidence.validator && typeof urgentInsertEvidence.validator === 'object'
      ? urgentInsertEvidence.validator as Record<string, unknown>
      : undefined
    parts.push(validator?.valid === true ? '方案檢查通過，尚未套用，請由調度員確認。' : '方案尚未通過檢查，不能套用。')
    return parts.join(' ')
  }
  const containsEngineeringFields = /provider_mode|solver_status|validator\.valid|matrix.?hash|tool schema|conversation id|求解狀態|驗證器|已指派訂單|未指派訂單|計畫完成|總駕駛時間|UNAVAILABLE|change_vehicle_availability|preview_urgent_insert|inspect_plan_overview/i.test(normalized)
  const trimmed = normalized.trimStart()
  const looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[')
  if (!containsEngineeringFields && !looksLikeJson) return normalized
  if (planEvidence) {
    const assigned = typeof planEvidence.assigned_order_count === 'number' ? planEvidence.assigned_order_count : null
    const unassigned = Array.isArray(planEvidence.unassigned_orders) ? planEvidence.unassigned_orders : []
    const validator = planEvidence.validator && typeof planEvidence.validator === 'object' ? planEvidence.validator as Record<string, unknown> : undefined
    const vehicleCount = typeof planEvidence.vehicle_count === 'number' ? planEvidence.vehicle_count : null
    const summary = [`已完成配送規劃${assigned === null ? '' : `，安排 ${assigned} 張訂單`}${vehicleCount === null ? '' : `，使用 ${vehicleCount} 台車`}。`]
    if (unassigned.length === 0 && validator?.valid === true) summary.push('所有訂單均已安排，未發現超載、重複、跨區或時段違規。')
    else if (unassigned.length > 0) summary.push(`有 ${unassigned.length} 張訂單需要人工處理。`)
    if (typeof planEvidence.total_distance_m === 'number') summary.push(`總行駛距離約 ${planEvidence.total_distance_m.toLocaleString()} 公尺。`)
    return summary.join(' ')
  }
  return '已完成處理；詳細的計算依據已收合，請展開查看。'
}

function evidenceSummary(tool: string, data: Record<string, unknown>): string {
  if (tool === 'plan_dispatch') {
    const assigned = data.assigned_order_count ?? '—'
    const distance = typeof data.total_distance_m === 'number' ? `${Number(data.total_distance_m).toLocaleString()} 公尺` : '—'
    return `已完成 ${assigned} 張訂單的方案檢查；總路程約 ${distance}。`
  }
  if (tool === 'highest_load_vehicle') return `已從驗證方案找出載重最高的車輛：${String(data.vehicle_id ?? '—')}。`
  if (tool === 'explain_assignment') return '這份說明來自訂單、車輛容量、服務區域與時段驗證結果。'
  if (tool === 'preview_urgent_insert') return `已取得插單前後差異，影響 ${data.affected_vehicle_count ?? '—'} 台車，等待人工確認。`
  if (tool === 'request_missing_fields') return '已整理缺少的配送欄位，請補齊後再預覽。'
  if (tool === 'change_vehicle_availability') return `已建立 ${String(data.vehicle_id ?? '指定車輛')} 的可用狀態變更預覽，尚未套用。`
  if (tool === 'inspect_plan_overview') return '已依目前方案確認訂單完整性、車輛載重與需要人工處理的項目。'
  if (tool === 'prepare_confirmation') return '已準備確認資訊；請在畫面按下人工確認，系統不會自動執行派車。'
  if (tool === 'assistant_help') return String(data.message ?? '已取得使用說明。')
  return '已取得後端工具證據。'
}

function fileType(file: File): string {
  return file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

export function AgentPanel({ onChat, onUseExample, onStop, busy }: AgentPanelProps) {
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [attachment, setAttachment] = useState<File | null>(null)
  const [attachmentMenu, setAttachmentMenu] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const cancelledRef = useRef(false)
  const chatLogRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (chatLogRef.current) chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight
  }, [messages, busy])

  const showFileError = (text: string) => {
    setAttachment(null)
    setAttachmentMenu(false)
    setMessages((items) => [...items, { role: 'agent', text }])
  }

  const selectFile = (file?: File) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      showFileError('目前只接受 .xlsx Excel 檔案，請重新選擇。')
      return
    }
    if (file.size === 0) {
      showFileError('這個 Excel 檔案是空的，請重新選擇。')
      return
    }
    setAttachment(file)
    setAttachmentMenu(false)
  }

  const send = async (text = message) => {
    const value = text.trim() || (attachment ? '請匯入並檢查這份配送資料' : '')
    if ((!value && !attachment) || busy) return
    const submittedAttachment = attachment
    const attachmentInfo = submittedAttachment ? { name: submittedAttachment.name, type: fileType(submittedAttachment), size: submittedAttachment.size } : undefined
    setMessage('')
    setAttachment(null)
    setAttachmentMenu(false)
    cancelledRef.current = false
    setMessages((items) => [...items, { role: 'user', text: value, attachment: attachmentInfo }])
    const progressSteps: string[] = []
    const progressMessageIndex = messages.length + 1
    setMessages((items) => [...items, { role: 'agent', text: '', progress: progressSteps }])
    const reportProgress: ChatProgress = (step) => {
      if (!progressSteps.includes(step)) progressSteps.push(step)
      setMessages((items) => items.map((item, index) => index === progressMessageIndex ? { ...item, progress: [...progressSteps] } : item))
    }
    const result = await onChat(value, submittedAttachment || undefined, reportProgress)
    setMessages((items) => items.map((item, index) => index === progressMessageIndex
      ? { ...item, text: result.response && !cancelledRef.current ? friendlyText(result.response.message, result.response.evidence) : (result.error || '已停止這次處理。'), evidence: result.response && !cancelledRef.current ? result.response.evidence : undefined, progress: progressSteps }
      : item))
  }

  const chooseExample = async () => {
    if (!onUseExample || busy) return
    try {
      selectFile(await onUseExample())
    } catch (error) {
      showFileError(error instanceof Error ? error.message : '範例資料載入失敗。')
    }
  }

  return (
    <section
      className={`panel agent-panel ${dragActive ? 'drag-active' : ''}`}
      aria-label="AI 調度助理"
      onDragEnter={(event) => { event.preventDefault(); if (!busy) setDragActive(true) }}
      onDragOver={(event) => { event.preventDefault(); if (!busy) setDragActive(true) }}
      onDragLeave={(event) => { event.preventDefault(); if (event.currentTarget === event.target) setDragActive(false) }}
      onDrop={(event) => { event.preventDefault(); setDragActive(false); if (!busy) selectFile(event.dataTransfer.files?.[0]) }}
    >
      <div className="panel-heading">
        <div><h2>AI 調度助理</h2></div>
        <span className="status-chip neutral"><span className="online-dot" />在線</span>
      </div>
      <div className="panel-body agent-body">
        <div ref={chatLogRef} className="chat-log" aria-live="polite">
          {!messages.length && <div className="empty-chat"><strong>今天想先處理什麼？</strong><div className="empty-suggestions">{suggestions.map((item) => <button type="button" key={item} className="example-button" onClick={() => void send(item)} disabled={busy}>{item}</button>)}</div></div>}
          {messages.map((item, index) => <div className={`chat-bubble ${item.role}`} key={`${item.role}-${index}`}>
            <div className="bubble-head"><span className={`bubble-avatar ${item.role}`}>{item.role === 'agent' ? 'AI' : '你'}</span><span className="bubble-role">{item.role === 'agent' ? 'AI 助理' : '你'}</span></div>
            {item.attachment && <div className="message-attachment"><span>📎</span><span><strong>{item.attachment.name}</strong><small>Excel · XLSX</small></span></div>}
            {item.text && <div>{item.text}</div>}
            {item.progress && item.progress.length > 0 && <div className="agent-progress">{item.progress.map((step, stepIndex) => <div className="progress-step" key={step}><span className={stepIndex < item.progress!.length - 1 || Boolean(item.text) ? 'done' : 'active'}>{stepIndex < item.progress!.length - 1 || Boolean(item.text) ? '✓' : '•'}</span>{step}</div>)}</div>}
            {item.evidence?.length ? <details className="evidence-disclosure"><summary>查看計算依據</summary>{item.evidence.map((evidence, evidenceIndex) => <div className="evidence-card" key={`${evidence.tool}-${evidenceIndex}`}><span className="evidence-check">✓</span><span>{evidenceSummary(evidence.tool, evidence.data)}</span></div>)}</details> : null}
          </div>)}
          {busy && <div className="chat-bubble agent processing-bubble"><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /><span>正在整理已驗證資料…</span></div>}
        </div>
        {attachment && <div className="attachment-chip" role="status"><span>📎</span><span><strong>{attachment.name}</strong><small>Excel · XLSX</small></span><button type="button" aria-label={`移除附件 ${attachment.name}`} onClick={() => setAttachment(null)}>×</button></div>}
        <form className="chat-form" onSubmit={(event) => { event.preventDefault(); void send() }}>
          <div className="attachment-menu-wrap">
            <button type="button" className="attachment-button" aria-label="附加訂單檔案" aria-expanded={attachmentMenu} onClick={() => setAttachmentMenu((open) => !open)} disabled={busy}>＋</button>
            {attachmentMenu && <div className="attachment-menu"><button type="button" onClick={() => { fileInputRef.current?.click(); setAttachmentMenu(false) }}>上傳 Excel</button><button type="button" onClick={() => void chooseExample()}>使用 40 張範例訂單</button><a href="/demo-delivery-40-orders.xlsx" download>下載範例格式</a></div>}
          </div>
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} placeholder="輸入你的配送需求…" disabled={busy} aria-label="輸入訊息" rows={1} />
          <button className="control-button" type="submit" disabled={busy || (!message.trim() && !attachment)}>送出</button>
          {busy && <button type="button" className="control-button ghost stop-button" onClick={() => { cancelledRef.current = true; onStop() }}>停止</button>}
          <input ref={fileInputRef} aria-label="上傳 Excel" type="file" accept=".xlsx" hidden onChange={(event) => { selectFile(event.target.files?.[0]); event.currentTarget.value = '' }} />
        </form>
        <div className="agent-footer"><span>結果會以已驗證資料說明。</span>{messages.length > 0 && <button type="button" className="retry-button" onClick={() => void send(messages.filter((item) => item.role === 'user').at(-1)?.text || '')}>重試</button>}</div>
      </div>
      {dragActive && <div className="drop-overlay" role="status"><strong>放開以上傳 Excel</strong><span>只接受 .xlsx 檔案</span></div>}
    </section>
  )
}
