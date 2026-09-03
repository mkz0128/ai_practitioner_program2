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
  busy: boolean
}

const examples = ['今天的配送方案怎麼分配？', '哪台車的載重最高？', '為什麼有訂單未安排？', '預覽 ORD-041 插單']

export function AgentPanel({ plan, onChat, onImport, busy }: AgentPanelProps) {
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState<Message[]>([])

  const send = async (text = message) => {
    const value = text.trim()
    if (!value || busy) return
    setMessage('')
    setMessages((items) => [...items, { role: 'user', text: value }])
    const result = await onChat(value)
    if (result) setMessages((items) => [...items, { role: 'agent', text: result.message, evidence: result.evidence }])
  }

  return (
    <section className="panel" aria-label="AI 調度助理">
      <div className="panel-heading">
        <div><h2>AI 調度助理</h2><p>只引用 deterministic tool evidence</p></div>
        <span className="status-chip neutral">單一 Agent</span>
      </div>
      <div className="panel-body">
        <div className="upload-row">
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
        <p className="hint">可上傳 `data/samples/demo-delivery-40-orders.xlsx`。匯入、驗證與排程均由後端執行。</p>
        <div className="example-buttons">
          {examples.map((example) => <button className="example-button" key={example} onClick={() => void send(example)} disabled={!plan || busy}>{example}</button>)}
        </div>
        <div className="chat-log" aria-live="polite">
          {!messages.length && <div className="hint">建立方案後，可用自然語言查詢載重、未安排原因或插單預覽。</div>}
          {messages.map((item, index) => (
            <div className={`chat-bubble ${item.role}`} key={`${item.role}-${index}`}>
              {item.text}
              {item.evidence?.map((evidence, evidenceIndex) => <div className="evidence" key={`${evidence.tool}-${evidenceIndex}`}><strong>工具證據：</strong> {evidence.tool}<br />{Object.entries(evidence.data).slice(0, 4).map(([key, value]) => <span key={key}>{key}: {String(value)}<br /></span>)}</div>)}
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
