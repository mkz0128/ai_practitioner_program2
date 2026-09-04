export type ProviderMode = 'GOOGLE' | 'TDX' | 'SIMULATED' | 'MIXED' | 'UNAVAILABLE' | 'OPENAI'

export interface ValidationError {
  path: string
  code: string
  message: string
  value_summary?: string | null
  requires_manual_review?: boolean
}

export interface ValidationPayload {
  is_valid: boolean
  error_count: number
  warning_count: number
  requires_manual_review: boolean
  errors: ValidationError[]
  warnings: ValidationError[]
}

export interface DatasetImportResponse {
  dataset_id: string
  status: string
  counts: { orders: number; packages: number; vehicles: number; zones: number }
  total_weight_kg: number
  validation: ValidationPayload
}

export interface AssignmentReason {
  summary: string
  evidence: Record<string, unknown>
}

export interface Stop {
  sequence: number
  order_id: string
  location_label: string
  latitude: number
  longitude: number
  time_slot: 'AM' | 'PM'
  eta: string
  service_duration_s: number
  leg_distance_m: number
  leg_duration_s: number
  order_weight_kg: number
  reason?: AssignmentReason | null
}

export interface VehicleRoute {
  vehicle_id: string
  vehicle_name: string
  service_zone_codes: string[]
  order_count: number
  package_count: number
  planned_load_kg: number
  max_load_kg: number
  load_utilization: number
  total_distance_m: number
  total_duration_s: number
  route_provider_mode: ProviderMode
  stops: Stop[]
}

export interface Plan {
  plan_id: string
  version: number
  dataset_id: string
  state: 'DRAFT' | 'VALIDATED' | 'PROPOSED' | 'CONFIRMED' | 'DISPATCHED'
  timezone: string
  provider_mode: ProviderMode
  matrix_hash?: string
  matrix_version?: string
  algorithm: 'BASELINE' | 'ORTOOLS'
  dataset_hash?: string
  is_fully_feasible: boolean
  requires_human_confirmation: boolean
  summary: {
    assigned_order_count: number
    unassigned_order_count: number
    total_package_count: number
    total_weight_kg: number
    assigned_weight_kg: number
    total_distance_m: number
    total_duration_s: number
    unassigned_orders: string[]
    vehicles: Array<Pick<VehicleRoute, 'vehicle_id' | 'planned_load_kg' | 'max_load_kg' | 'load_utilization'>>
  }
  vehicles: VehicleRoute[]
  unassigned_orders: string[]
  unassigned_reasons: Record<string, string>
  validation: { valid: boolean; violations: Record<string, number>; errors: string[] }
  warnings: Array<{ code: string; message: string }>
}

export interface MapRoute {
  vehicle_id: string
  color: string
  encoded_polyline: string
  is_simplified: boolean
  stops: Array<Pick<Stop, 'sequence' | 'order_id' | 'latitude' | 'longitude' | 'eta'>>
  legs: Array<{ from_sequence: number; to_sequence: number; distance_m: number; duration_s: number }>
}

export interface MapData {
  plan_id: string
  version: number
  provider_mode: ProviderMode
  matrix_hash?: string
  matrix_version?: string
  depot: { depot_id: string; latitude: number; longitude: number }
  routes: MapRoute[]
  traffic?: {
    mode: string
    data_status: string
    events: Array<Record<string, unknown>>
    route_risks: Array<Record<string, unknown>>
  }
  warnings: Array<{ code: string; message: string }>
}

export interface ProviderStatus {
  name: string
  enabled: boolean
  status: string
  mode: ProviderMode
  data_status?: string
}

export interface ProviderResponse {
  providers: ProviderStatus[]
}

export interface ChatResponse {
  session_id: string
  agent_run_id: string
  message: string
  evidence: Array<{ tool: string; data: Record<string, unknown> }>
  requires_human_confirmation: boolean
}

export interface UrgentOrderPayload {
  order_id: string
  zone_code: string
  city: string
  district: string
  location_label: string
  latitude: number
  longitude: number
  time_slot: 'AM' | 'PM'
  declared_package_count: number
  priority: 'NORMAL' | 'HIGH'
  note?: string | null
}

export interface UrgentPackagePayload {
  package_id: string
  order_id: string
  weight_kg: number
}

export interface UrgentPreview {
  plan_id: string
  base_version: number
  preview_version: number
  feasible: boolean
  requires_human_confirmation: boolean
  mode: 'MINIMAL_CHANGE' | 'FULL_REPLAN'
  full_replan_reason?: string | null
  affected_vehicle_count: number
  moved_order_count: number
  before: Plan['summary']
  after: Plan['summary']
  comparison: {
    base_algorithm: string
    preview_algorithm: string
    base_dataset_hash: string
    preview_dataset_hash: string
  }
  diff: {
    inserted_order_id: string
    reassigned_orders: Array<Record<string, unknown>>
    sequence_changes: Array<Record<string, unknown>>
    vehicle_load_changes: Array<Record<string, unknown>>
    total_distance_delta_m: number
    total_duration_delta_s: number
  }
}

export interface ApiErrorBody {
  error?: {
    code?: string
    message?: string
    field_errors?: ValidationError[]
    details?: Record<string, unknown>
  }
  request_id?: string
}
