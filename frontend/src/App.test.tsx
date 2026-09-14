import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { MapData, Plan } from './types'

const api = vi.hoisted(() => ({ getProviderStatus: vi.fn(), getDispatchRules: vi.fn(), inspectWorkbook: vi.fn(), importWorkbook: vi.fn(), createPlan: vi.fn(), getMapData: vi.fn(), chat: vi.fn(), resetRuntimeState: vi.fn(), confirmRouteOrder: vi.fn(), previewRouteOrder: vi.fn(), NetworkRequestError: class extends Error {}, ApiError: class extends Error {} }))
vi.mock('./api', () => api)
// Leaflet 的替身必須涵蓋 MapView 真正用到的每個 API。
// 少一個（例如 divIcon）就會在 render 時丟 TypeError，而錯誤訊息會指向
// 「找不到某段文字」，跟真正的原因完全無關，很難追。
vi.mock('leaflet', () => {
  const layer = () => ({ addTo: vi.fn().mockReturnThis(), bindTooltip: vi.fn().mockReturnThis(), on: vi.fn().mockReturnThis() })
  return { default: { map: vi.fn(() => ({ setView: vi.fn().mockReturnThis(), remove: vi.fn(), fitBounds: vi.fn() })), tileLayer: vi.fn(() => layer()), layerGroup: vi.fn(() => ({ clearLayers: vi.fn().mockReturnThis(), addTo: vi.fn().mockReturnThis() })), polyline: vi.fn(layer), circleMarker: vi.fn(layer), marker: vi.fn(layer), divIcon: vi.fn(() => ({})) } }
})

const plan = { plan_id: 'PLAN-TEST', version: 1, dataset_id: 'DATA-TEST', state: 'PROPOSED', timezone: 'Asia/Taipei', provider_mode: 'SIMULATED', algorithm: 'ORTOOLS', is_fully_feasible: true, completeness: { is_complete: true, assigned_order_count: 1, total_order_count: 1, unassigned_order_count: 0 }, rule_check: { passed: true, violations: {} }, confirmability: { can_confirm: true, blockers: [] }, requires_human_confirmation: true, summary: { assigned_order_count: 1, unassigned_order_count: 0, total_package_count: 1, total_weight_kg: 3, assigned_weight_kg: 3, total_distance_m: 1200, total_duration_s: 900, unassigned_orders: [], vehicles: [] }, vehicles: [{ vehicle_id: 'VEH-001', vehicle_name: '配送車 1', service_zone_codes: ['Z1'], order_count: 1, package_count: 1, planned_load_kg: 3, max_load_kg: 100, load_utilization: .03, total_distance_m: 1200, total_duration_s: 900, route_provider_mode: 'SIMULATED', stops: [] }], unassigned_orders: [], unassigned_reasons: {}, validation: { valid: true, violations: {}, errors: [] }, warnings: [] } as unknown as Plan
const mapData = { plan_id: 'PLAN-TEST', version: 1, stage: 'PRE_LOAD', timeline_minutes: null, provider_mode: 'SIMULATED', depot: { depot_id: 'DEPOT-001', latitude: 25, longitude: 121 }, routes: [], warnings: [] } as MapData

describe('配送調度控制塔 v2 前端', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['xlsx']) })); api.getProviderStatus.mockResolvedValue({ providers: [] }); api.getDispatchRules.mockResolvedValue({ rules: [], active_count: 0 }); api.inspectWorkbook.mockResolvedValue({ status: 'CANONICAL', source_name: 'demo.xlsx', requires_confirmation: false, entries: [], missing_fields: [], mapping: {} }); api.importWorkbook.mockResolvedValue({ dataset_id: 'DATA-TEST', status: 'VALIDATED', counts: { orders: 1, packages: 1, vehicles: 1, zones: 1 }, total_weight_kg: 3, validation: { is_valid: true, error_count: 0, warning_count: 0, requires_manual_review: false, errors: [], warnings: [] } }); api.createPlan.mockResolvedValue(plan); api.getMapData.mockResolvedValue(mapData) })
  it('開啟後自動載入方案，不畫空白 KPI', async () => { render(<App />); await waitFor(() => expect(screen.getByText('車輛概況')).toBeInTheDocument()); expect(screen.getAllByLabelText('上傳 Excel')).toHaveLength(2); expect(screen.queryByText('下載範例格式')).not.toBeInTheDocument(); expect(screen.queryByText('—')).not.toBeInTheDocument() })
  it('自動載入有效 Excel 後呈現方案、車輛與地圖', async () => { render(<App />); await waitFor(() => expect(screen.getByText('車輛概況')).toBeInTheDocument()); expect(screen.getByText('1/1 已安排')).toBeInTheDocument(); expect(api.importWorkbook).toHaveBeenCalledTimes(1); expect(api.createPlan).toHaveBeenCalledWith('DATA-TEST', 'BALANCED', expect.any(AbortSignal)) })
})
