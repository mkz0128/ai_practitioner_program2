import type { Plan, ProviderStatus } from '../types'

interface StatusBarProps {
  plan: Plan | null
  providers: ProviderStatus[]
  activeView: 'assistant' | 'tasks' | 'tracking'
  onViewChange: (view: 'assistant' | 'tasks' | 'tracking') => void
}

function providerLabel(providers: ProviderStatus[], name: string, activeMode?: string): { label: string; tone: 'live' | 'simulated' | 'blocked' | 'neutral' } {
  const provider = providers.find((item) => item.name === name)
  if (!provider || !provider.enabled) return { label: '未設定', tone: 'blocked' }
  if (provider.mode === 'SIMULATED') return { label: '模擬', tone: 'simulated' }
  if (name === 'google_routes' && activeMode && activeMode !== 'GOOGLE') return { label: '未採用', tone: 'neutral' }
  return { label: provider.status === 'healthy' ? '已連線' : provider.status, tone: 'live' }
}

const viewLabels = { assistant: 'AI 調度', tasks: '配送任務', tracking: '路線追蹤' }

export function StatusBar({ plan, providers, activeView, onViewChange }: StatusBarProps) {
  const google = providerLabel(providers, 'google_routes', plan?.provider_mode)
  const maps = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_API_KEY
    ? { label: '已設定', tone: 'live' as const }
    : { label: '未設定', tone: 'blocked' as const }
  const tdx = providerLabel(providers, 'tdx')
  const openai = providerLabel(providers, 'openai')
  const source = plan?.provider_mode === 'GOOGLE'
    ? { label: 'Google 即時資料', tone: 'live' as const }
    : plan?.provider_mode === 'TDX'
      ? { label: 'TDX 即時資料', tone: 'live' as const }
      : plan
        ? { label: '示範資料', tone: 'simulated' as const }
        : { label: '—', tone: 'neutral' as const }
  const metrics = [
    ['今日訂單', plan ? plan.summary.assigned_order_count + plan.summary.unassigned_order_count : '—', '筆'],
    ['已分配', plan?.summary.assigned_order_count ?? '—', '筆'],
    ['未分配', plan?.summary.unassigned_order_count ?? '—', '筆'],
    ['使用車輛', plan?.vehicles.filter((vehicle) => vehicle.order_count > 0).length ?? '—', '台'],
  ] as const
  const providersSummary = [
    ['Google Routes', google], ['Google Maps', maps], ['TDX 路況', tdx], ['OpenAI Agent', openai],
  ] as const
  return (
    <header className="topbar">
      <div className="topbar-main">
        <div className="breadcrumb"><span className="breadcrumb-home">⌂</span><span>配送調度</span><b>›</b><strong>{viewLabels[activeView]}</strong></div>
        <div className="topbar-actions"><span className="provider-source"><span className={`source-dot ${source.tone}`} />資料來源：{source.label}</span><button type="button" className="control-button ghost" onClick={() => onViewChange('tasks')}>匯出報表</button><button type="button" className="control-button">＋ 新配送任務</button><span className="user-badge">調度團隊</span></div>
      </div>
      <div className="brand-line"><div className="brand"><div className="brand-mark">AI</div><div><div className="brand-title">AI 配送調度中心</div><div className="brand-subtitle">可解釋的路線與載重 Copilot · 所有方案由調度人員確認</div></div></div><div className="view-switcher" role="tablist" aria-label="工作區切換">{Object.entries(viewLabels).map(([view, label]) => <button type="button" key={view} className={activeView === view ? 'active' : ''} onClick={() => onViewChange(view as 'assistant' | 'tasks' | 'tracking')}>{label}</button>)}</div></div>
      <div className="metrics" aria-label="系統狀態">
        {metrics.map(([label, value, caption]) => (
          <div className="metric kpi-card" key={label}>
            <div className="metric-label">{label}</div>
            <div className="metric-value">{value}</div>
            <div className="metric-caption">{caption}</div>
          </div>
        ))}
      </div>
      <div className="provider-strip" aria-label="外部服務狀態">{providersSummary.map(([label, state]) => <span key={label} className="provider-badge"><span className={`source-dot ${state.tone}`} />{label}<b className={`provider-text ${state.tone}`}>{state.label}</b></span>)}</div>
    </header>
  )
}
