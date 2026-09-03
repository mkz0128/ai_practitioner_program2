export type WorkspaceView = 'assistant' | 'tasks' | 'tracking'

interface SidebarProps {
  activeView: WorkspaceView
  onViewChange: (view: WorkspaceView) => void
}

const items: Array<{ view: WorkspaceView; label: string; icon: string }> = [
  { view: 'assistant', label: 'AI 調度', icon: '✦' },
  { view: 'tasks', label: '配送任務', icon: '▣' },
  { view: 'tracking', label: '路線追蹤', icon: '⌖' },
]

export function Sidebar({ activeView, onViewChange }: SidebarProps) {
  return (
    <aside className="sidebar" aria-label="主要導覽">
      <div className="sidebar-logo" aria-label="AI 配送調度中心">AI</div>
      <nav className="sidebar-nav">
        {items.map((item) => (
          <button
            type="button"
            key={item.view}
            aria-label={item.label}
            className={`nav-icon ${activeView === item.view ? 'active' : ''}`}
            onClick={() => onViewChange(item.view)}
          >
            <span aria-hidden="true">{item.icon}</span>
            <small>{item.label}</small>
          </button>
        ))}
      </nav>
      <div className="sidebar-foot" aria-hidden="true">⌁</div>
    </aside>
  )
}
