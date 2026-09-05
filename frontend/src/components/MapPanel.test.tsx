import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MapPanel } from './MapPanel'

describe('MapPanel 初始狀態', () => {
  it('尚未匯入資料時顯示中性提示，不誤報 Google 連線失敗', () => {
    render(<MapPanel data={null} activeVehicle={null} onSelectVehicle={vi.fn()} />)

    expect(screen.getByText('尚未匯入訂單')).toBeInTheDocument()
    expect(screen.getByText('建立配送方案後，這裡會顯示各車的道路路線。')).toBeInTheDocument()
    expect(screen.getByText('尚未使用')).toBeInTheDocument()
    expect(screen.queryByText(/路線服務暫時無法使用|Google 連線失敗|Provider unavailable/i)).not.toBeInTheDocument()
  })
})
