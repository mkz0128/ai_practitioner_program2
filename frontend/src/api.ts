import type {
  ApiErrorBody,
  ChatResponse,
  DatasetImportResponse,
  MapData,
  Plan,
  ProviderResponse,
  UrgentPreview,
  ValidationError,
  ValidationPayload,
} from './types'

const baseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')

export class ApiError extends Error {
  readonly code: string
  readonly requestId?: string
  readonly fieldErrors: ValidationError[]

  constructor(public readonly status: number, body: ApiErrorBody) {
    super(body.error?.message || '後端請求失敗。')
    this.name = 'ApiError'
    this.code = body.error?.code || 'REQUEST_FAILED'
    this.requestId = body.request_id || body.error?.details?.request_id as string | undefined
    this.fieldErrors = body.error?.field_errors || []
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers || {}),
    },
  })
  const body = (await response.json().catch(() => ({}))) as T & ApiErrorBody
  if (!response.ok) throw new ApiError(response.status, body)
  return body as T
}

export async function importWorkbook(file: File): Promise<DatasetImportResponse> {
  const form = new FormData()
  form.append('file', file)
  return request<DatasetImportResponse>('/api/v1/datasets/import-excel', {
    method: 'POST',
    body: form,
  })
}

export function getValidation(datasetId: string): Promise<{ dataset_id: string; validation: ValidationPayload }> {
  return request(`/api/v1/datasets/${encodeURIComponent(datasetId)}/validation`)
}

export function createPlan(datasetId: string): Promise<Plan> {
  return request<Plan>('/api/v1/plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dataset_id: datasetId,
      algorithm: 'ORTOOLS',
      route_provider_preference: 'AUTO',
      traffic_mode: 'AUTO',
    }),
  })
}

export function getPlan(planId: string, version?: number): Promise<Plan> {
  const query = version ? `?version=${version}` : ''
  return request<Plan>(`/api/v1/plans/${encodeURIComponent(planId)}${query}`)
}

export function getMapData(planId: string, version?: number): Promise<MapData> {
  const query = version ? `?version=${version}` : ''
  return request<MapData>(`/api/v1/plans/${encodeURIComponent(planId)}/map-data${query}`)
}

export function getProviderStatus(): Promise<ProviderResponse> {
  return request<ProviderResponse>('/api/v1/providers/status')
}

export function chat(
  sessionId: string,
  message: string,
  context: Record<string, unknown>,
): Promise<ChatResponse> {
  return request<ChatResponse>('/api/v1/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, message, context }),
  })
}

export function previewUrgent(planId: string, baseVersion: number): Promise<UrgentPreview> {
  return request<UrgentPreview>(`/api/v1/plans/${encodeURIComponent(planId)}/urgent-insert/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      base_plan_version: baseVersion,
      order: {
        order_id: 'ORD-041',
        zone_code: 'Z4',
        city: '臺北市',
        district: '信義',
        location_label: '臨時插單展示點',
        latitude: 25.033,
        longitude: 121.565,
        time_slot: 'PM',
        declared_package_count: 1,
        priority: 'HIGH',
        note: '前端 preview，不執行 Dispatch',
      },
      packages: [{ package_id: 'PKG-041-01', order_id: 'ORD-041', weight_kg: 2 }],
    }),
  })
}

export function confirmPlan(planId: string, version: number): Promise<Plan> {
  return request<Plan>(`/api/v1/plans/${encodeURIComponent(planId)}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version, confirmation: 'CONFIRM_PLAN', dispatcher_reference: 'frontend-user' }),
  })
}
