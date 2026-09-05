import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ApiError } from './api'

const api = vi.hoisted(() => ({
  importWorkbook: vi.fn(),
  getValidation: vi.fn(),
  createPlan: vi.fn(),
  getPlan: vi.fn(),
  getMapData: vi.fn(),
  getProviderStatus: vi.fn(),
  chat: vi.fn(),
  previewUrgent: vi.fn(),
  confirmPlan: vi.fn(),
}))

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  ...api,
}))

const plan = {
  plan_id: 'PLAN-001', version: 1, dataset_id: 'DS-001', state: 'PROPOSED', timezone: 'Asia/Taipei', provider_mode: 'SIMULATED', matrix_hash: 'matrix', matrix_version: 'sim-v1', algorithm: 'ORTOOLS', dataset_hash: 'dataset', is_fully_feasible: true, requires_human_confirmation: true,
  completeness: { is_complete: true, assigned_order_count: 40, total_order_count: 40, unassigned_order_count: 0 },
  rule_check: { passed: true, violations: {} },
  confirmability: { can_confirm: true, blockers: [] },
  summary: { assigned_order_count: 40, unassigned_order_count: 0, total_package_count: 80, total_weight_kg: 365, assigned_weight_kg: 365, total_distance_m: 1, total_duration_s: 1, unassigned_orders: [], vehicles: [] },
  vehicles: [], unassigned_orders: [], unassigned_reasons: {}, validation: { valid: true, violations: {}, errors: [] }, warnings: [],
}

describe('控制塔主流程', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    api.getProviderStatus.mockResolvedValue({ providers: [] })
    api.importWorkbook.mockResolvedValue({ dataset_id: 'DS-001', status: 'VALIDATED', counts: { orders: 40, packages: 80, vehicles: 4, zones: 5 }, total_weight_kg: 365, validation: { is_valid: true, error_count: 0, warning_count: 0, requires_manual_review: false, errors: [], warnings: [] } })
    api.getValidation.mockResolvedValue({ dataset_id: 'DS-001', validation: { is_valid: true, error_count: 0, warning_count: 0, requires_manual_review: false, errors: [], warnings: [] } })
    api.getPlan.mockResolvedValue(plan)
    api.getMapData.mockResolvedValue({ plan_id: 'PLAN-001', version: 1, provider_mode: 'SIMULATED', depot: { depot_id: 'DEPOT-001', latitude: 25, longitude: 121 }, routes: [], traffic: { mode: 'UNAVAILABLE', data_status: 'CREDENTIALS_MISSING', events: [], route_risks: [] }, warnings: [] })
    api.chat.mockResolvedValue({ session_id: 'TEST', agent_run_id: 'RUN', message: '已完成配送規劃。', evidence: [], requires_human_confirmation: true, plan_id: 'PLAN-001', plan_version: 1 })
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
    expect(api.createPlan).not.toHaveBeenCalled()
    expect(screen.getAllByText('方案檢查通過').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Validator/)).not.toBeInTheDocument()
    expect(api.chat).toHaveBeenCalledTimes(1)
    expect(api.chat.mock.calls[0][1]).toBe('請用這份訂單建立今天的配送方案')
  })

  it('以白話說明方案只會在人工確認後套用', () => {
    render(<App />)
    expect(screen.getByText(/人工確認後才會套用/)).toBeInTheDocument()
    expect(screen.queryByText(/Dispatch/)).not.toBeInTheDocument()
  })

  it('不完整方案會分開顯示完整性與規則檢查且禁止確認', async () => {
    api.getPlan.mockResolvedValue({
      ...plan,
      algorithm: 'ORTOOLS',
      is_fully_feasible: false,
      completeness: { is_complete: false, assigned_order_count: 38, total_order_count: 40, unassigned_order_count: 2 },
      rule_check: { passed: true, violations: {} },
      confirmability: { can_confirm: false, blockers: ['NOT_FORMAL_OPTIMIZED_PLAN', 'UNASSIGNED_ORDERS'] },
      summary: { ...plan.summary, assigned_order_count: 38, unassigned_order_count: 2 },
      unassigned_orders: ['ORD-022', 'ORD-023'],
      unassigned_reasons: { 'ORD-022': 'UNASSIGNABLE', 'ORD-023': 'UNASSIGNABLE' },
    })
    render(<App />)
    const input = screen.getByLabelText('上傳 Excel')
    fireEvent.change(input, { target: { files: [new File(['xlsx'], 'demo.xlsx')] } })
    fireEvent.change(screen.getByRole('textbox', { name: '輸入訊息' }), { target: { value: '建立方案' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: '輸入訊息' }), { key: 'Enter', code: 'Enter' })

    await waitFor(() => expect(screen.getAllByText(/38／40 張已安排/).length).toBeGreaterThan(0))
    expect(screen.getAllByText(/仍有 2 張需要處理/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/UNASSIGNABLE|BASELINE|Validator/)).not.toBeInTheDocument()
  })

  it('Agent 失敗時顯示白話錯誤且不暴露工程代碼', async () => {
    api.chat.mockRejectedValueOnce(new ApiError(502, { error: { code: 'AGENT_RUN_FAILED', message: 'Agent failed', field_errors: [] } }))
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: '輸入訊息' }), { target: { value: '為什麼這樣分車？' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: '輸入訊息' }), { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(screen.getByText(/AI 助理暫時無法完成/)).toBeInTheDocument())
    expect(screen.queryByText(/AGENT_RUN_FAILED/)).not.toBeInTheDocument()
  })

  it('不會從瀏覽器狀態還原快速初步方案作為正式方案', async () => {
    window.localStorage.setItem('dispatch.active-plan', JSON.stringify({ plan_id: 'PLAN-OLD', version: 1 }))
    api.getPlan.mockResolvedValueOnce({ ...plan, algorithm: 'BASELINE' })
    render(<App />)
    await waitFor(() => expect(screen.getByText(/先前儲存的是快速初步方案/)).toBeInTheDocument())
    expect(window.localStorage.getItem('dispatch.active-plan')).toBeNull()
    expect(api.getMapData).not.toHaveBeenCalled()
  })

  it('重新開始只清除目前畫面與未確認狀態', async () => {
    window.localStorage.setItem('dispatch.active-plan', JSON.stringify({ plan_id: 'PLAN-001', version: 1 }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('40／40')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '重新開始' }))
    expect(window.localStorage.getItem('dispatch.active-plan')).toBeNull()
    expect(screen.getByText('尚未匯入訂單')).toBeInTheDocument()
    expect(screen.getByText(/已清除目前畫面與未確認變更/)).toBeInTheDocument()
  })
})
