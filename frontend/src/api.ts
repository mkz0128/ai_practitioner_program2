import type { ApiErrorBody, ChatResponse, ColumnMappingResponse, CrossVehicleRouteOrderPreview, DatasetImportResponse, DelayPreview, DispatchRuleDuration, DispatchRuleOption, DispatchRuleRecord, DispatchRuleType, DispatchRulesResponse, MapData, Plan, PlanVersionSummary, ProviderStatus, ReassignmentPreview, RouteOrderPreview, StrategyComparison, UrgentOrderBundlePayload, UrgentOrderPayload, UrgentPackagePayload, UrgentPreview, ValidationError, ValidationPayload } from './types'

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL || ''
const baseUrl = configuredBaseUrl.endsWith('/') ? configuredBaseUrl.slice(0, -1) : configuredBaseUrl

export class ApiError extends Error {
  readonly code: string
  readonly requestId?: string
  readonly fieldErrors: ValidationError[]
  readonly details: Record<string, unknown>
  constructor(public readonly status: number, body: ApiErrorBody) {
    super(body.error?.message || '後端請求失敗。')
    this.name = 'ApiError'
    this.code = body.error?.code || 'REQUEST_FAILED'
    this.requestId = body.request_id || (typeof body.error?.details?.request_id === 'string' ? body.error.details.request_id : undefined)
    this.fieldErrors = body.error?.field_errors || []
    this.details = body.error?.details || {}
  }
}

export const NETWORK_FAILURE_MESSAGE = '連線失敗：目前連不上後端服務，請稍後再試。'

export class NetworkRequestError extends Error {
  constructor() {
    super(NETWORK_FAILURE_MESSAGE)
    this.name = 'NetworkRequestError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, { ...init, headers: { Accept: 'application/json', ...(init?.headers || {}) } })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new NetworkRequestError()
  }
  const body = (await response.json().catch(() => ({}))) as T & ApiErrorBody
  if (!response.ok) throw new ApiError(response.status, body)
  return body as T
}

export function importWorkbook(file: File, columnMapping?: Record<string, Record<string, string>>, mappingName?: string, signal?: AbortSignal): Promise<DatasetImportResponse> {
  const form = new FormData()
  form.append('file', file)
  if (columnMapping) form.append('mapping', JSON.stringify(columnMapping))
  if (mappingName) form.append('mapping_name', mappingName)
  return request<DatasetImportResponse>('/api/v1/datasets/import-excel', { method: 'POST', body: form, signal })
}
export function inspectWorkbook(file: File, signal?: AbortSignal): Promise<ColumnMappingResponse> { const form = new FormData(); form.append('file', file); return request<ColumnMappingResponse>('/api/v1/datasets/inspect-excel', { method: 'POST', body: form, headers: { 'X-Dispatch-UI': 'true' }, signal }) }
export function getValidation(datasetId: string): Promise<{ dataset_id: string; validation: ValidationPayload }> { return request(`/api/v1/datasets/${encodeURIComponent(datasetId)}/validation`) }
export function createPlan(datasetId: string, objective: 'FASTEST' | 'BALANCED' | 'STABLE' = 'BALANCED', signal?: AbortSignal): Promise<Plan> { return request<Plan>('/api/v1/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataset_id: datasetId, algorithm: 'ORTOOLS', objective, route_provider_preference: 'SIMULATED', traffic_mode: 'SIMULATED' }), signal }) }
export function getPlan(planId: string, version?: number): Promise<Plan> { const query = version ? `?version=${version}` : ''; return request<Plan>(`/api/v1/plans/${encodeURIComponent(planId)}${query}`) }
export function getMapData(planId: string, version?: number, signal?: AbortSignal, timelineMinutes?: number): Promise<MapData> { const query = new URLSearchParams(); if (version) query.set('version', String(version)); if (timelineMinutes !== undefined) query.set('timeline_minutes', String(timelineMinutes)); const suffix = query.toString() ? `?${query.toString()}` : ''; return request<MapData>(`/api/v1/plans/${encodeURIComponent(planId)}/map-data${suffix}`, { signal }) }
export function getProviderStatus(): Promise<{ providers: ProviderStatus[] }> { return request('/api/v1/providers/status') }
export function chat(sessionId: string, message: string, context: Record<string, unknown>, signal?: AbortSignal, action?: 'PREVIEW_URGENT'): Promise<ChatResponse> { return request<ChatResponse>('/api/v1/agent/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: sessionId, message, context, action }), signal }) }
export function previewUrgent(planId: string, baseVersion: number, order: UrgentOrderPayload, packages: UrgentPackagePayload[], signal?: AbortSignal): Promise<UrgentPreview> { return request<UrgentPreview>(`/api/v1/plans/${encodeURIComponent(planId)}/urgent-insert/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base_plan_version: baseVersion, order, packages }), signal }) }
export function previewUrgentBatch(planId: string, baseVersion: number, orders: UrgentOrderBundlePayload[], includeUnassignableOption = false): Promise<UrgentPreview> { const query = includeUnassignableOption ? '?include_unassignable_option=true' : ''; return request<UrgentPreview>(`/api/v1/plans/${encodeURIComponent(planId)}/urgent-insert/batch-preview${query}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base_plan_version: baseVersion, orders }) }) }
export function confirmPlan(planId: string, version: number, sessionId?: string): Promise<Plan> { return request<Plan>(`/api/v1/plans/${encodeURIComponent(planId)}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(sessionId ? { 'X-Dispatch-Session': sessionId } : {}) }, body: JSON.stringify({ version, confirmation: 'CONFIRM_PLAN', dispatcher_reference: 'frontend-user' }) }) }
export function startLoading(planId: string, version: number): Promise<Plan> { return request<Plan>(`/api/v1/plans/${encodeURIComponent(planId)}/load`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version, confirmation: 'START_LOADING', dispatcher_reference: 'frontend-user' }) }) }
export function simulateDeparture(planId: string, version: number): Promise<Plan> { return request<Plan>(`/api/v1/plans/${encodeURIComponent(planId)}/simulate-departure`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version, confirmation: 'START_SIMULATED_DEPARTURE' }) }) }
export function previewReassignment(planId: string, baseVersion: number, orderId: string, targetVehicleId: string): Promise<ReassignmentPreview> { return request<ReassignmentPreview>(`/api/v1/plans/${encodeURIComponent(planId)}/reassign/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base_plan_version: baseVersion, order_id: orderId, target_vehicle_id: targetVehicleId }) }) }
export function previewRouteOrder(planId: string, baseVersion: number, vehicleId: string, orderIds: string[], timelineMinutes?: number): Promise<RouteOrderPreview> { return request<RouteOrderPreview>(`/api/v1/plans/${encodeURIComponent(planId)}/route-order/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base_plan_version: baseVersion, vehicle_id: vehicleId, order_ids: orderIds, timeline_minutes: timelineMinutes }) }) }
export function confirmRouteOrder(planId: string, baseVersion: number, vehicleId: string, orderIds: string[], timelineMinutes?: number): Promise<Plan> { return request<Plan>(`/api/v1/plans/${encodeURIComponent(planId)}/route-order/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base_plan_version: baseVersion, vehicle_id: vehicleId, order_ids: orderIds, timeline_minutes: timelineMinutes }) }) }
export function previewCrossVehicleRouteOrder(planId: string, baseVersion: number, sourceVehicleId: string, targetVehicleId: string, orderId: string, targetSequence: number, timelineMinutes?: number): Promise<CrossVehicleRouteOrderPreview> { return request<CrossVehicleRouteOrderPreview>(`/api/v1/plans/${encodeURIComponent(planId)}/route-order/cross-vehicle/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base_plan_version: baseVersion, source_vehicle_id: sourceVehicleId, target_vehicle_id: targetVehicleId, order_id: orderId, target_sequence: targetSequence, timeline_minutes: timelineMinutes }) }) }
export function confirmCrossVehicleRouteOrder(planId: string, baseVersion: number, sourceVehicleId: string, targetVehicleId: string, orderId: string, targetSequence: number, timelineMinutes?: number): Promise<Plan> { return request<Plan>(`/api/v1/plans/${encodeURIComponent(planId)}/route-order/cross-vehicle/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base_plan_version: baseVersion, source_vehicle_id: sourceVehicleId, target_vehicle_id: targetVehicleId, order_id: orderId, target_sequence: targetSequence, timeline_minutes: timelineMinutes }) }) }
export function compareStrategies(datasetId: string, planId?: string, version?: number): Promise<StrategyComparison> { return request<StrategyComparison>('/api/v1/plans/compare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataset_id: datasetId, plan_id: planId, version, route_provider_preference: 'SIMULATED', traffic_mode: 'SIMULATED' }) }) }
export function previewDelay(planId: string, version: number, delayMinutes: 10 | 20 | 30): Promise<DelayPreview> { return request<DelayPreview>(`/api/v1/plans/${encodeURIComponent(planId)}/delay-preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version, delay_minutes: delayMinutes }) }) }
export function getPlanVersions(planId: string): Promise<{ plan_id: string; current_version: number; versions: PlanVersionSummary[] }> { return request(`/api/v1/plans/${encodeURIComponent(planId)}/versions`) }
export function restorePlan(planId: string, sourceVersion: number): Promise<Plan> { return request<Plan>(`/api/v1/plans/${encodeURIComponent(planId)}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source_version: sourceVersion, dispatcher_reference: 'frontend-user' }) }) }

export function getDispatchRules(): Promise<DispatchRulesResponse> { return request<DispatchRulesResponse>('/api/v1/dispatch-rules') }
export function getDispatchParameters(): Promise<{ default_service_minutes: number; service_minutes_by_zone: Record<string, number> }> { return request('/api/v1/dispatch-parameters') }
export function resetRuntimeState(): Promise<{ default_service_minutes: number; service_minutes_by_zone: Record<string, number>; cleared_rule_count: number }> { return request('/api/v1/runtime/reset', { method: 'POST' }) }
export function confirmDispatchParameter(planId: string, baseVersion: number, zoneCode: string, fromServiceMinutes: number, toServiceMinutes: number): Promise<{ default_service_minutes: number; service_minutes_by_zone: Record<string, number>; zone_code: string; from_service_minutes: number; to_service_minutes: number; requires_replan: boolean }> { return request('/api/v1/dispatch-parameters/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan_id: planId, base_plan_version: baseVersion, zone_code: zoneCode, from_service_minutes: fromServiceMinutes, to_service_minutes: toServiceMinutes, source: 'TIMELINE_DEVIATION' }) }) }
export function confirmDispatchRule(option: DispatchRuleOption): Promise<{ rule: DispatchRuleRecord; active_count: number }> { return request<{ rule: DispatchRuleRecord; active_count: number }>(`/api/v1/dispatch-rules/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan_id: option.plan_id, base_plan_version: option.base_version, subject_type: option.rule.subject_type, subject_id: option.rule.subject_id, rule_type: option.rule.rule_type, value: option.rule.value, source_utterance: option.rule.source_utterance, duration: option.rule.duration, ...(option.rule.additional_rule ? { additional_rule: { rule_type: option.rule.additional_rule.rule_type, value: option.rule.additional_rule.value, duration: option.rule.additional_rule.duration } } : {}) }) }) }
export function deactivateDispatchRule(ruleId: string): Promise<{ rule: DispatchRuleRecord; active_count: number }> { return request(`/api/v1/dispatch-rules/${encodeURIComponent(ruleId)}/deactivate`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }) }

export type DispatchRuleConfirmation = { plan_id: string; base_plan_version: number; subject_type: 'VEHICLE' | 'ZONE'; subject_id: string; rule_type: DispatchRuleType; value: number | string; source_utterance: string; duration: DispatchRuleDuration }

export interface MappingConfirmation { mapping: Record<string, string>; source_name?: string; save_as?: string }
export function confirmColumnMapping(datasetId: string, payload: MappingConfirmation): Promise<ColumnMappingResponse> { return request(`/api/v1/datasets/${encodeURIComponent(datasetId)}/mapping/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }) }
