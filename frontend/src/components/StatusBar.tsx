import type { Plan, ProviderStatus } from '../types'

interface StatusBarProps {
  plan: Plan | null
  providers: ProviderStatus[]
}

function providerLabel(providers: ProviderStatus[], name: string, activeMode?: string): { label: string; tone: 'live' | 'simulated' | 'blocked' | 'neutral' } {
  const provider = providers.find((item) => item.name === name)
  if (!provider || !provider.enabled) return { label: '未設定', tone: 'blocked' }
  if (provider.mode === 'SIMULATED') return { label: '模擬', tone: 'simulated' }
  if (name === 'google_routes' && activeMode && activeMode !== 'GOOGLE') return { label: '未採用', tone: 'neutral' }
  return { label: provider.status === 'healthy' ? '已連線' : provider.status, tone: 'live' }
}

export function StatusBar({ plan, providers }: StatusBarProps) {
  const google = providerLabel(providers, 'google_routes', plan?.provider_mode)
  const maps = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_API_KEY
    ? { label: '已設定', tone: 'live' as const }
    : { label: '未設定', tone: 'blocked' as const }
  const tdx = providerLabel(providers, 'tdx')
  const openai = providerLabel(providers, 'openai')
  const source = plan?.provider_mode === 'GOOGLE'
    ? { label: 'GOOGLE_LIVE', tone: 'live' as const }
    : plan?.provider_mode === 'TDX'
      ? { label: 'TDX_LIVE', tone: 'live' as const }
      : plan
        ? { label: 'SIMULATED', tone: 'simulated' as const }
        : { label: '—', tone: 'neutral' as const }
  const metrics = [
    ['今日訂單', plan ? plan.summary.assigned_order_count + plan.summary.unassigned_order_count : '—', '筆'],
    ['已分配', plan?.summary.assigned_order_count ?? '—', '筆'],
    ['未分配', plan?.summary.unassigned_order_count ?? '—', '筆'],
    ['使用車輛', plan?.vehicles.filter((vehicle) => vehicle.order_count > 0).length ?? '—', '台'],
    ['Google Routes', google.label, google.tone],
    ['Google Maps', maps.label, maps.tone],
    ['TDX 路況', tdx.label, tdx.tone],
    ['OpenAI Agent', openai.label, openai.tone],
    ['目前資料來源', source.label, source.tone],
  ] as const
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">AI</div>
        <div>
          <div className="brand-title">AI 配送調度中心</div>
          <div className="brand-subtitle">可解釋的路線與載重 Copilot · 所有方案由調度人員確認</div>
        </div>
      </div>
      <div className="metrics" aria-label="系統狀態">
        {metrics.map(([label, value, caption]) => (
          <div className="metric" key={label}>
            <div className="metric-label">{label}</div>
            <div className="metric-value">{value}</div>
            <div className={`metric-caption ${caption === 'live' ? 'status-live' : caption === 'blocked' ? 'status-blocked' : caption === 'simulated' ? 'status-simulated' : ''}`}>
              {caption === 'live' ? 'LIVE' : caption === 'blocked' ? 'BLOCKED' : caption === 'simulated' ? 'SIMULATED' : caption}
            </div>
          </div>
        ))}
      </div>
    </header>
  )
}
