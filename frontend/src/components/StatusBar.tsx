import type { Plan, ProviderStatus } from '../types'

interface StatusBarProps {
  plan: Plan | null
  providers: ProviderStatus[]
  mapsStatus: 'missing' | 'configured' | 'connected' | 'failed'
  onReset?: () => void
}

function providerLabel(providers: ProviderStatus[], name: string, activeMode?: string): { label: string; tone: 'live' | 'simulated' | 'blocked' | 'neutral' } {
  const provider = providers.find((item) => item.name === name)
  if (!provider || !provider.enabled) return { label: '未設定', tone: 'blocked' }
  if (provider.mode === 'SIMULATED') return { label: '模擬', tone: 'simulated' }
  if (name === 'google_routes' && activeMode && activeMode !== 'GOOGLE') return { label: '未採用', tone: 'neutral' }
  if (provider.status === 'connected' || provider.status === 'healthy') return { label: '已連線', tone: 'live' }
  if (provider.status === 'configured') return { label: '已設定', tone: 'neutral' }
  if (provider.status === 'failed' || provider.status === 'degraded') return { label: '連線失敗', tone: 'blocked' }
  return { label: provider.status, tone: 'neutral' }
}

export function StatusBar({ plan, providers, mapsStatus, onReset }: StatusBarProps) {
  const google = !plan
    ? { label: '尚未使用', tone: 'neutral' as const }
    : providerLabel(providers, 'google_routes', plan.provider_mode)
  const maps = !plan && mapsStatus !== 'missing'
    ? { label: '尚未使用', tone: 'neutral' as const }
    : mapsStatus === 'connected'
      ? { label: '已連線', tone: 'live' as const }
      : mapsStatus === 'configured'
        ? { label: '已設定', tone: 'neutral' as const }
        : mapsStatus === 'failed'
          ? { label: '連線失敗', tone: 'blocked' as const }
          : { label: '未設定', tone: 'blocked' as const }
  const tdx = { label: '本版本未啟用', tone: 'neutral' as const }
  const openai = providerLabel(providers, 'openai')
  const source = plan?.provider_mode === 'GOOGLE'
    ? { label: 'Google 即時資料', tone: 'live' as const }
    : plan?.provider_mode === 'TDX'
      ? { label: 'TDX 即時資料', tone: 'live' as const }
      : plan
        ? { label: '示範資料', tone: 'simulated' as const }
        : { label: '—', tone: 'neutral' as const }
  const metrics = [
    ['今日訂單', plan?.completeness.total_order_count ?? '—', '張'],
    ['已安排', plan ? `${plan.completeness.assigned_order_count}／${plan.completeness.total_order_count}` : '—', plan ? `${plan.completeness.assigned_order_count}／${plan.completeness.total_order_count} 張已安排${plan.completeness.is_complete ? '' : ` · 仍有 ${plan.completeness.unassigned_order_count} 張需要處理`}` : '尚未建立'],
    ['使用車輛', plan ? `${plan.vehicles.filter((vehicle) => vehicle.order_count > 0).length}／${plan.vehicles.length}` : '—', '台'],
    ['方案狀態', plan?.state === 'CONFIRMED' ? '已確認' : plan?.confirmability.can_confirm ? '等待確認' : plan ? '需要處理' : '尚未建立', plan?.rule_check.passed ? '方案檢查通過' : plan ? '方案檢查未通過' : ''],
  ] as const
  const providersSummary = [
    ['Google Routes', google], ['Google Maps', maps], ['TDX 路況', tdx], ['OpenAI Agent', openai],
  ] as const
  return (
    <header className="topbar">
      <div className="topbar-main"><div><h1>今日配送規劃</h1><p>匯入訂單、查看路線，確認後才會套用方案。</p></div><div className="topbar-actions"><span className="provider-source"><span className={`source-dot ${source.tone}`} />資料來源：{source.label}</span>{onReset && <button type="button" className="control-button ghost" onClick={onReset}>重新開始</button>}<details className="connection-details"><summary>系統連線</summary><div>{providersSummary.map(([label, state]) => <span key={label} className="provider-badge"><span className={`source-dot ${state.tone}`} />{label}<b className={`provider-text ${state.tone}`}>{state.label}</b></span>)}</div></details></div></div>
      <div className="metrics" aria-label="系統狀態">
        {metrics.map(([label, value, caption]) => (
          <div className="metric kpi-card" key={label}>
            <div className="metric-label">{label}</div>
            <div className="metric-value">{value}</div>
            <div className="metric-caption">{caption}</div>
          </div>
        ))}
      </div>
    </header>
  )
}
