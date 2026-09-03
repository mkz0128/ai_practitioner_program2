import { useEffect, useRef, useState } from 'react'
import type { ChatResponse, Plan } from '../types'

interface Message {
  role: 'user' | 'agent'
  text: string
  evidence?: ChatResponse['evidence']
}

interface AgentPanelProps {
  plan: Plan | null
  sessionId: string
  datasetId?: string | null
  onChat: (message: string) => Promise<ChatResponse | null>
  onImport: (file: File) => Promise<void>
  onUseExample?: () => Promise<void>
  busy: boolean
}

const examples = ['今天的配送方案怎麼分配？', '哪台車的載重最高？', '為什麼有訂單未安排？', '預覽 ORD-041 插單']

function friendlyText(text: string): string {
  return text.replace(/ORTOOLS/g, '最佳化排程').replace(/SIMULATED/g, '示意資料').replace(/GOOGLE_LIVE/g, 'Google 即時資料')
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
  if (tool === 'prepare_confirmation') return '已準備確認資訊；請在畫面按下人工確認，Agent 不會執行 Dispatch。'
  if (tool === 'assistant_help') return String(data.message ?? '已取得使用說明。')
  return '已取得後端工具證據。'
}

export function AgentPanel({ plan, sessionId, datasetId, onChat, onImport, onUseExample, busy }: AgentPanelProps) {
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const cancelledRef = useRef(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (chatEndRef.current && typeof chatEndRef.current.scrollIntoView === 'function') chatEndRef.current.scrollIntoView({ behavior: 'smooth' }) }, [messages, busy])

  const send = async (text = message) => {
    const value = text.trim()
    if (!value || busy || cancelledRef.current) return
    setMessage('')
    cancelledRef.current = false
    setMessages((items) => [...items, { role: 'user', text: value }])
    const result = await onChat(value)
    if (result && !cancelledRef.current) setMessages((items) => [...items, { role: 'agent', text: friendlyText(result.message), evidence: result.evidence }])
  }

  const chooseExample = async () => {
    if (!onUseExample || busy) return
    cancelledRef.current = false
    await onUseExample()
  }

  return (
    <section className="panel agent-panel" aria-label="AI 調度助理">
      <div className="panel-heading">
        <div><div className="eyebrow">調度 Copilot</div><h2>AI 調度助理</h2><p>直接說出需求，我會用已驗證資料協助你</p></div>
        <span className="status-chip neutral"><span className="online-dot" />在線</span>
      </div>
      <div className="panel-body agent-body">
        <div className="conversation-intro"><div className="agent-avatar">AI</div><div><strong>你好，我是 AI 配送調度助理。</strong><p>我可以協助整理訂單、檢查資料、安排車輛、規劃路線及模擬臨時插單。你可以直接問問題、上傳今天的訂單，或使用範例資料開始。</p></div></div>
        <div className="onboarding-actions"><label className="action-tile"><span className="tile-icon">↑</span><span><strong>上傳今日訂單</strong><small>Excel .xlsx</small></span><input aria-label="上傳 Excel" type="file" accept=".xlsx" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImport(file) }} /></label><button type="button" className="action-tile" onClick={() => void chooseExample()} disabled={busy}><span className="tile-icon">▦</span><span><strong>使用 40 張範例訂單</strong><small>快速開始示範</small></span></button><button type="button" className="action-tile" onClick={() => void send('你可以做什麼？')} disabled={busy}><span className="tile-icon">?</span><span><strong>看看你可以做什麼</strong><small>查看助理能力</small></span></button></div>
        <div className="context-strip"><span>Conversation ID <b>{sessionId}</b></span><span>Active Dataset <b>{datasetId ? '已載入' : '尚未選擇'}</b></span><span>Active Plan <b>{plan ? '已建立' : '尚未建立'}</b></span><span>版本 <b>{plan ? `v${plan.version}` : '—'}</b></span></div>
        <div className="example-buttons"><span className="quick-label">快捷提問</span>{examples.map((example) => <button className="example-button" key={example} onClick={() => void send(example)} disabled={busy}>{example}</button>)}</div>
        <div className="chat-log" aria-live="polite">
          {!messages.length && <div className="empty-chat">沒有資料也可以先問我：Excel 需要哪些欄位？我如何避免超載？臨時插單怎麼處理？</div>}
          {messages.map((item, index) => <div className={`chat-bubble ${item.role}`} key={`${item.role}-${index}`}><div className="bubble-role">{item.role === 'agent' ? 'AI 助理' : '你'}</div>{item.text}{item.evidence?.map((evidence, evidenceIndex) => <div className="evidence-card" key={`${evidence.tool}-${evidenceIndex}`}><span className="evidence-check">✓</span><span>{evidenceSummary(evidence.tool, evidence.data)}</span></div>)}</div>)}
          {busy && <div className="chat-bubble agent processing-bubble"><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /><span>正在整理已驗證資料…</span></div>}
          <div ref={chatEndRef} />
        </div>
        <form className="chat-form" onSubmit={(event) => { event.preventDefault(); void send() }}><button type="button" className="attachment-button" aria-label="附加訂單檔案" onClick={() => document.querySelector<HTMLInputElement>('input[aria-label="上傳 Excel"]')?.click()} disabled={busy}>＋</button><textarea value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} placeholder="輸入你的配送需求…（Enter 送出，Shift＋Enter 換行）" disabled={busy} aria-label="輸入訊息" rows={1} /><button className="control-button" type="submit" disabled={busy || !message.trim()}>送出</button>{busy && <button type="button" className="control-button ghost stop-button" onClick={() => { cancelledRef.current = true }}>停止</button>}</form>
        <div className="agent-footer"><span>此對話只引用確定性工具證據，不顯示模型私密推理。</span>{messages.length > 0 && <button type="button" className="retry-button" onClick={() => void send(messages[messages.length - 1]?.text || '')}>重試上一個問題</button>}</div>
      </div>
    </section>
  )
}
