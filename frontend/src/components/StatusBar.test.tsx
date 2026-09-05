import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { StatusBar } from './StatusBar'

describe('StatusBar 外部服務狀態', () => {
  it('尚未建立方案時將 Google 標為尚未使用，TDX 標為本版本未啟用', () => {
    render(
      <StatusBar
        plan={null}
        mapsStatus="configured"
        providers={[
          { name: 'google_routes', enabled: true, mode: 'GOOGLE', status: 'configured' },
          { name: 'openai', enabled: true, mode: 'OPENAI', status: 'configured' },
          { name: 'tdx', enabled: false, mode: 'TDX', status: 'disabled' },
        ]}
      />,
    )

    expect(screen.getAllByText('尚未使用')).toHaveLength(2)
    expect(screen.getByText('本版本未啟用')).toBeInTheDocument()
    expect(screen.getByText('TDX 路況')).toBeInTheDocument()
  })
})
