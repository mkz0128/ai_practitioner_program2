import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Plan, UrgentPreview } from '../types'
import { DetailsPanel } from './DetailsPanel'

const stops = Array.from({ length: 12 }, (_, index) => ({
  sequence: index + 1,
  order_id: `ORD-${String(index + 1).padStart(3, '0')}`,
  location_label: `配送點 ${index + 1}`,
  latitude: 25,
  longitude: 121,
  time_slot: index % 2 ? 'PM' as const : 'AM' as const,
  eta: '09:00',
  service_duration_s: 180,
  leg_distance_m: 1000,
  leg_duration_s: 300,
  order_weight_kg: 5,
}))

const plan = {
  plan_id: 'PLAN-1', version: 1, dataset_id: 'DS-1', state: 'PROPOSED',
  timezone: 'Asia/Taipei', provider_mode: 'SIMULATED', algorithm: 'ORTOOLS',
  objective: 'FASTEST', is_fully_feasible: true, requires_human_confirmation: true,
  completeness: { is_complete: true, assigned_order_count: 12, total_order_count: 12, unassigned_order_count: 0 },
  rule_check: { passed: true, violations: {} }, confirmability: { can_confirm: true, blockers: [] },
  summary: { assigned_order_count: 12, unassigned_order_count: 0, total_package_count: 12, total_weight_kg: 60, assigned_weight_kg: 60, total_distance_m: 12000, total_duration_s: 3600, unassigned_orders: [], vehicles: [] },
  vehicles: [{ vehicle_id: 'VEH-001', vehicle_name: '一號車', service_zone_codes: ['Z1'], order_count: 12, package_count: 12, planned_load_kg: 60, max_load_kg: 120, load_utilization: .5, total_distance_m: 12000, total_duration_s: 3600, route_provider_mode: 'SIMULATED', unused_reason: null, stops }],
  unassigned_orders: [], unassigned_reasons: {}, validation: { valid: true, violations: {}, errors: [] }, warnings: [],
} satisfies Plan

describe('方案明細', () => {
  it('以十筆分頁並可搜尋訂單，不會一次塞滿全部訂單', () => {
    render(<DetailsPanel plan={plan} preview={null} onConfirm={vi.fn()} busy={false} />)
    expect(screen.getByText('第 1 / 2 頁')).toBeInTheDocument()
    expect(screen.queryByText('ORD-011')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '下一頁' }))
    expect(screen.getByText('ORD-011')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '搜尋訂單' }), { target: { value: 'ORD-012' } })
    expect(screen.getByText('ORD-012')).toBeInTheDocument()
    expect(screen.queryByText('ORD-011')).not.toBeInTheDocument()
  })

  it('收到換車預覽後自動顯示差異與取消按鈕', () => {
    const preview = {
      plan_id: 'PLAN-1', base_version: 1, preview_version: 2, feasible: true,
      requires_human_confirmation: true, mode: 'MINIMAL_CHANGE', affected_vehicle_count: 2,
      moved_order_count: 1, before: plan.summary, after: plan.summary,
      comparison: { base_algorithm: 'ORTOOLS', preview_algorithm: 'ORTOOLS', base_dataset_hash: 'a', preview_dataset_hash: 'a' },
      diff: { inserted_order_id: 'ORD-001', reassigned_orders: [{}], sequence_changes: [], vehicle_load_changes: [], total_distance_delta_m: 20, total_duration_delta_s: 3 },
    } satisfies UrgentPreview
    render(<DetailsPanel plan={plan} preview={preview} onConfirm={vi.fn()} onCancelPreview={vi.fn()} busy={false} />)
    expect(screen.getByText(/影響 2 台車/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消變更' })).toBeInTheDocument()
  })
})
