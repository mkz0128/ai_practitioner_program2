import { useState } from 'react'
import type { ChatResponse, Plan } from '../types'

interface Message {
  role: 'user' | 'agent'
  text: string
  evidence?: ChatResponse['evidence']
}

interface AgentPanelProps {
  plan: Plan | null
  onChat: (message: string) => Promise<ChatResponse | null>
  onImport: (file: File) => Promise<void>
  onPreview?: () => Promise<void>
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
  if (tool === 'explain_assignment') return '這份說明來自訂單、車輛容量、服務區域與時段驗證結果。'
  if (tool === 'preview_urgent_insert') return `已取得插單前後差異，影響 ${data.affected_vehicle_count ?? '—'} 台車，等待人工確認。`
  return '已取得後端工具證據。'
}

export function AgentPanel({ plan, onChat, onImport, onPreview, busy }: AgentPanelProps) {
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState<Message[]>([])

  const send = async (text = message) => {
    const value = text.trim()
    if (!value || busy) return
    setMessage('')
    setMessages((items) => [...items, { role: 'user', text: value }])
    const result = await onChat(value)
    if (result) setMessages((items) => [...items, { role: 'agent', text: friendlyText(result.message), evidence: result.evidence }])
  }

  return (
    <section className="panel agent-panel" aria-label="AI 調度助理">
      <div className="panel-heading">
        <div><div className="eyebrow">調度 Copilot</div><h2>AI 調度助理</h2><p>用自然語言查詢今天的配送方案</p></div>
        <span className="status-chip neutral"><span className="online-dot" />在線</span>
      </div>
      <div className="panel-body">
        <div className="upload-row upload-dropzone">
          <div className="upload-icon">↑</div><div className="upload-copy"><strong>匯入今日配送資料</strong><span>支援 Excel .xlsx · 建議使用 40 單 Demo</span></div>
          <input
            aria-label="上傳 Excel"
            type="file"
            accept=".xlsx"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void onImport(file)
            }}
          />
        </div>
        <p className="hint upload-hint">可上傳 <code>data/samples/demo-delivery-40-orders.xlsx</code>。匯入、驗證與排程由後端確定性執行。</p>
        <div className="conversation-intro"><div className="agent-avatar">AI</div><div><strong>今天想先從哪裡開始？</strong><p>我可以整理分車結果、找出載重最高的車輛，或預覽臨時插單。</p></div></div>
        <div className="example-buttons">
          {examples.map((example) => <button className="example-button" key={example} onClick={() => example === '預覽 ORD-041 插單' && onPreview ? void onPreview() : void send(example)} disabled={!plan || busy}>{example}</button>)}
        </div>
        <div className="chat-log" aria-live="polite">
          {!messages.length && <div className="empty-chat">建立方案後，從上方快捷問題開始，或直接輸入你的問題。</div>}
          {messages.map((item, index) => (
            <div className={`chat-bubble ${item.role}`} key={`${item.role}-${index}`}>
              {item.text}
              {item.evidence?.map((evidence, evidenceIndex) => <div className="evidence-card" key={`${evidence.tool}-${evidenceIndex}`}><span className="evidence-check">✓</span><span>{evidenceSummary(evidence.tool, evidence.data)}</span></div>)}
            </div>
          ))}
        </div>
        <form className="chat-form" onSubmit={(event) => { event.preventDefault(); void send() }}>
          <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder={plan ? '詢問目前方案…' : '請先匯入 Excel'} disabled={!plan || busy} aria-label="輸入訊息" />
          <button className="control-button" type="submit" disabled={!plan || busy || !message.trim()}>送出</button>
        </form>
      </div>
    </section>
  )
}
