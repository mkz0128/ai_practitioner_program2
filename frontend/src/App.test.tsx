import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const api = vi.hoisted(() => ({
  importWorkbook: vi.fn(),
  getValidation: vi.fn(),
  createPlan: vi.fn(),
  getMapData: vi.fn(),
  getProviderStatus: vi.fn(),
  chat: vi.fn(),
  previewUrgent: vi.fn(),
  confirmPlan: vi.fn(),
}))

vi.mock('./api', () => api)

const plan = {
  plan_id: 'PLAN-001', version: 1, dataset_id: 'DS-001', state: 'PROPOSED', timezone: 'Asia/Taipei', provider_mode: 'SIMULATED', matrix_hash: 'matrix', matrix_version: 'sim-v1', algorithm: 'ORTOOLS', dataset_hash: 'dataset', is_fully_feasible: true, requires_human_confirmation: true,
  summary: { assigned_order_count: 40, unassigned_order_count: 0, total_package_count: 80, total_weight_kg: 365, assigned_weight_kg: 365, total_distance_m: 1, total_duration_s: 1, unassigned_orders: [], vehicles: [] },
  vehicles: [], unassigned_orders: [], unassigned_reasons: {}, validation: { valid: true, violations: {}, errors: [] }, warnings: [],
}

describe('控制塔主流程', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.getProviderStatus.mockResolvedValue({ providers: [] })
    api.importWorkbook.mockResolvedValue({ dataset_id: 'DS-001', status: 'VALIDATED', counts: { orders: 40, packages: 80, vehicles: 4, zones: 5 }, total_weight_kg: 365, validation: { is_valid: true, error_count: 0, warning_count: 0, requires_manual_review: false, errors: [], warnings: [] } })
    api.getValidation.mockResolvedValue({ dataset_id: 'DS-001', validation: { is_valid: true, error_count: 0, warning_count: 0, requires_manual_review: false, errors: [], warnings: [] } })
    api.createPlan.mockResolvedValue(plan)
    api.getMapData.mockResolvedValue({ plan_id: 'PLAN-001', version: 1, provider_mode: 'SIMULATED', depot: { depot_id: 'DEPOT-001', latitude: 25, longitude: 121 }, routes: [], traffic: { mode: 'UNAVAILABLE', data_status: 'CREDENTIALS_MISSING', events: [], route_risks: [] }, warnings: [] })
    api.chat.mockResolvedValue({ session_id: 'TEST', agent_run_id: 'RUN', message: '已完成配送規劃。', evidence: [], requires_human_confirmation: true })
  })

  it('附件與需求可在同一次送出後匯入並建立方案', async () => {
    render(<App />)
    const input = screen.getByLabelText('上傳 Excel')
    fireEvent.change(input, { target: { files: [new File(['xlsx'], 'demo.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })] } })
    expect(api.importWorkbook).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('demo.xlsx')
    fireEvent.change(screen.getByRole('textbox', { name: '輸入訊息' }), { target: { value: '請用這份訂單建立今天的配送方案' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: '輸入訊息' }), { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(screen.getByText(/已匯入 40 張訂單/)).toBeInTheDocument())
    expect(api.createPlan).toHaveBeenCalledWith('DS-001', expect.anything())
    expect(screen.getByText('Validator 通過')).toBeInTheDocument()
    expect(api.chat).toHaveBeenCalledTimes(1)
    expect(api.chat.mock.calls[0][1]).toBe('請用這份訂單建立今天的配送方案')
  })

  it('明確顯示不能自動 Dispatch 的人工確認邊界', () => {
    render(<App />)
    expect(screen.getByText(/不提供自動 Dispatch/)).toBeInTheDocument()
  })
})
