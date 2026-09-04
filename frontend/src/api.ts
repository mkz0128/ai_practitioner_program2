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
  UrgentOrderPayload,
  UrgentPackagePayload,
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

export async function importWorkbook(file: File, signal?: AbortSignal): Promise<DatasetImportResponse> {
  const form = new FormData()
  form.append('file', file)
  return request<DatasetImportResponse>('/api/v1/datasets/import-excel', {
    method: 'POST',
    body: form,
    signal,
  })
}

export function getValidation(datasetId: string, signal?: AbortSignal): Promise<{ dataset_id: string; validation: ValidationPayload }> {
  return request(`/api/v1/datasets/${encodeURIComponent(datasetId)}/validation`, { signal })
}

export function createPlan(datasetId: string, signal?: AbortSignal): Promise<Plan> {
  return request<Plan>('/api/v1/plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dataset_id: datasetId,
      algorithm: 'ORTOOLS',
      route_provider_preference: 'AUTO',
      traffic_mode: 'AUTO',
    }),
    signal,
  })
}

export function getPlan(planId: string, version?: number): Promise<Plan> {
  const query = version ? `?version=${version}` : ''
  return request<Plan>(`/api/v1/plans/${encodeURIComponent(planId)}${query}`)
}

export function getMapData(planId: string, version?: number, signal?: AbortSignal): Promise<MapData> {
  const query = version ? `?version=${version}` : ''
  return request<MapData>(`/api/v1/plans/${encodeURIComponent(planId)}/map-data${query}`, { signal })
}

export function getProviderStatus(): Promise<ProviderResponse> {
  return request<ProviderResponse>('/api/v1/providers/status')
}

export function chat(
  sessionId: string,
  message: string,
  context: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ChatResponse> {
  return request<ChatResponse>('/api/v1/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, message, context }),
    signal,
  })
}

export function previewUrgent(
  planId: string,
  baseVersion: number,
  order: UrgentOrderPayload,
  packages: UrgentPackagePayload[],
  signal?: AbortSignal,
): Promise<UrgentPreview> {
  return request<UrgentPreview>(`/api/v1/plans/${encodeURIComponent(planId)}/urgent-insert/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      base_plan_version: baseVersion,
      order,
      packages,
    }),
    signal,
  })
}

export function confirmPlan(planId: string, version: number): Promise<Plan> {
  return request<Plan>(`/api/v1/plans/${encodeURIComponent(planId)}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version, confirmation: 'CONFIRM_PLAN', dispatcher_reference: 'frontend-user' }),
  })
}
