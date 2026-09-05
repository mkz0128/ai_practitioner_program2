import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VehiclePanel } from './VehiclePanel'
import type { Plan } from '../types'


const plan: Plan = {
  plan_id: 'PLAN-1', version: 1, dataset_id: 'DS-1', state: 'PROPOSED', timezone: 'Asia/Taipei',
  provider_mode: 'SIMULATED', algorithm: 'ORTOOLS', objective: 'FASTEST', is_fully_feasible: true,
  requires_human_confirmation: true,
  completeness: { is_complete: true, assigned_order_count: 1, total_order_count: 1, unassigned_order_count: 0 },
  rule_check: { passed: true, violations: {} }, confirmability: { can_confirm: true, blockers: [] },
  summary: { assigned_order_count: 1, unassigned_order_count: 0, total_package_count: 1, total_weight_kg: 5, assigned_weight_kg: 5, total_distance_m: 1000, total_duration_s: 300, unassigned_orders: [], vehicles: [] },
  vehicles: [
    { vehicle_id: 'VEH-001', vehicle_name: '一號車', service_zone_codes: ['Z1'], order_count: 1, package_count: 1, planned_load_kg: 5, max_load_kg: 100, load_utilization: .05, total_distance_m: 1000, total_duration_s: 300, route_provider_mode: 'SIMULATED', unused_reason: null, stops: [{ sequence: 1, order_id: 'ORD-001', location_label: '示範點', latitude: 25, longitude: 121, time_slot: 'AM', eta: '09:00', service_duration_s: 180, leg_distance_m: 1000, leg_duration_s: 300, order_weight_kg: 5 }] },
    { vehicle_id: 'VEH-004', vehicle_name: '四號車', service_zone_codes: ['Z1'], order_count: 0, package_count: 0, planned_load_kg: 0, max_load_kg: 110, load_utilization: 0, total_distance_m: 0, total_duration_s: 0, route_provider_mode: 'SIMULATED', unused_reason: '其他車輛已完成全部訂單，此車保留備援容量。', stops: [] },
  ],
  unassigned_orders: [], unassigned_reasons: {}, validation: { valid: true, violations: {}, errors: [] }, warnings: [],
}


describe('車輛換車互動', () => {
  it('可用鍵盤下拉選單走同一個換車預覽流程', () => {
    const preview = vi.fn()
    render(<VehiclePanel plan={plan} activeVehicle={null} onSelectVehicle={vi.fn()} onReassignPreview={preview} />)
    fireEvent.change(screen.getByLabelText('將 ORD-001 移至其他車輛'), { target: { value: 'VEH-004' } })
    expect(preview).toHaveBeenCalledWith('ORD-001', 'VEH-004')
  })

  it('拖放訂單只觸發後端預覽且空車有白話原因', () => {
    const preview = vi.fn()
    const { container } = render(<VehiclePanel plan={plan} activeVehicle={null} onSelectVehicle={vi.fn()} onReassignPreview={preview} />)
    const source = screen.getByText('ORD-001').closest('.order-move-row')!
    const target = container.querySelectorAll('.vehicle-card')[1]
    const data = new Map<string, string>()
    const dataTransfer = { setData: (key: string, value: string) => data.set(key, value), getData: (key: string) => data.get(key) || '' }
    fireEvent.dragStart(source, { dataTransfer })
    fireEvent.drop(target, { dataTransfer })
    expect(preview).toHaveBeenCalledWith('ORD-001', 'VEH-004')
    expect(screen.getByText(/保留備援容量/)).toBeInTheDocument()
  })

  it('訂單超過六張時可展開，確保指定訂單可拖拉或用鍵盤換車', () => {
    const manyStops = Array.from({ length: 8 }, (_, index) => ({
      ...plan.vehicles[0].stops[0],
      sequence: index + 1,
      order_id: `ORD-${String(index + 1).padStart(3, '0')}`,
    }))
    render(<VehiclePanel plan={{ ...plan, vehicles: [{ ...plan.vehicles[0], order_count: 8, stops: manyStops }, plan.vehicles[1]] }} activeVehicle={null} onSelectVehicle={vi.fn()} />)
    expect(screen.queryByText('ORD-008')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看全部 8 張訂單' }))
    expect(screen.getByText('ORD-008')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '收合訂單' }))
    expect(screen.queryByText('ORD-008')).not.toBeInTheDocument()
  })
})
