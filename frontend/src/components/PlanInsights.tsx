import type { DelayPreview, Plan, PlanVersionSummary, StrategyComparison } from '../types'

interface PlanInsightsProps {
  plan: Plan | null
  comparison: StrategyComparison | null
  delayPreview: DelayPreview | null
  versions: { current_version: number; versions: PlanVersionSummary[] } | null
  busy: boolean
  onCompare: () => Promise<void>
  onDelay: (minutes: 10 | 20 | 30) => Promise<void>
  onLoadVersions: () => Promise<void>
  onRestore: (version: number) => Promise<void>
}

function minutes(value: unknown): string {
  return typeof value === 'number' ? `${value.toFixed(1)} 分鐘` : '—'
}

export function PlanInsights({
  plan,
  comparison,
  delayPreview,
  versions,
  busy,
  onCompare,
  onDelay,
  onLoadVersions,
  onRestore,
}: PlanInsightsProps) {
  if (!plan) return null
  return (
    <section className="panel plan-insights" aria-label="方案分析與版本">
      <div className="panel-heading">
        <div><div className="eyebrow">方案分析</div><h2>比較、風險與版本</h2><p>所有結果都會先預覽並重新驗證，套用前仍需人工確認。</p></div>
        <div className="insight-actions">
          <button type="button" className="control-button ghost" onClick={() => void onCompare()} disabled={busy}>比較三種方案</button>
          <button type="button" className="control-button ghost" onClick={() => void onLoadVersions()} disabled={busy}>檢視版本</button>
        </div>
      </div>
      <div className="panel-body insight-body">
        <div className="insight-block">
          <strong>延遲風險</strong>
          <div className="insight-actions">
            {[10, 20, 30].map((minutesValue) => <button type="button" className="filter-pill" key={minutesValue} onClick={() => void onDelay(minutesValue as 10 | 20 | 30)} disabled={busy}>+{minutesValue} 分鐘</button>)}
          </div>
          {delayPreview && <div className="insight-summary"><span>驗證：{delayPreview.validator.valid ? '通過' : '需人工複核'}</span><span>受影響：{String((delayPreview.simulation as Record<string, unknown>).affected_order_count ?? 0)} 張訂單</span><span>模擬延遲：{String((delayPreview.simulation as Record<string, unknown>).delay_minutes ?? '—')} 分鐘</span></div>}
          {delayPreview && <div className="risk-list">{delayPreview.risks.slice(0, 8).map((risk) => <div className="risk-row" key={String(risk.order_id)}><span className={`risk-dot ${String(risk.risk_level).toLowerCase()}`} />{String(risk.order_id)}<span className="hint">餘裕 {minutes(risk.slack_minutes)}</span></div>)}</div>}
        </div>
        <div className="insight-block">
          <strong>方案比較</strong>
          {!comparison && <span className="hint">按下「比較三種方案」後顯示不同目標函數的實際結果。</span>}
          {comparison && <div className="strategy-list">{comparison.strategies.map((strategy) => <div className="strategy-row" key={strategy.objective}><span><b>{strategy.objective === 'FASTEST' ? '最快' : strategy.objective === 'BALANCED' ? '最平均' : '最穩定'}</b><small>{strategy.objective}</small></span><span>{strategy.total_distance_m.toLocaleString()} m</span><span>{Math.round(strategy.total_duration_s / 60)} 分鐘</span><span>載重差 {strategy.load_spread_kg.toFixed(1)} kg</span></div>)}</div>}
        </div>
        <div className="insight-block">
          <strong>方案版本</strong>
          {!versions && <span className="hint">檢視目前方案版本、狀態與驗證結果。</span>}
          {versions && <div className="version-list">{versions.versions.map((version) => <div className="version-row" key={version.version}><span><b>V{version.version}</b><small>{version.state === 'CONFIRMED' ? '已確認' : '草稿／待確認'} · {version.validator_valid ? '驗證通過' : '需複核'}</small></span>{version.version < versions.current_version && <button type="button" className="filter-pill" onClick={() => void onRestore(version.version)} disabled={busy}>復原為此版本</button>}</div>)}</div>}
        </div>
      </div>
    </section>
  )
}
