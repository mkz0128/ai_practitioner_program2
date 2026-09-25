import type { ValidationError } from '../types'

export const fieldLabels: Record<string, string> = {
  order_id: '訂單編號',
  zone_code: '配送區域',
  city: '城市',
  district: '行政區',
  location_label: '地點名稱',
  latitude: '緯度',
  longitude: '經度',
  time_slot: '配送時段',
  declared_package_count: '包裹件數',
  priority: '優先程度',
  package_id: '包裹編號',
  weight_kg: '重量',
  package_weight_kg: '每件重量',
  vehicle_id: '車輛編號',
  vehicle_name: '車輛名稱',
  max_load_kg: '載重上限',
  current_load_kg: '目前載重',
}

/**
 * 排不進去的原因，後端給的是代碼。畫面上印 `ORD-050：CAPACITY_LIMIT`
 * 等於沒講。這裡的字跟後端 `_unassigned_reason_label` 一致。
 */
const unassignedReasons: Record<string, string> = {
  OVER_VEHICLE_CAPACITY: '這張單比最大的那台車還重，空車也裝不下',
  CAPACITY_LIMIT: '每一台車的載重餘裕都不夠裝這張單',
  SERVICE_ZONE_UNAVAILABLE: '沒有車負責這一區',
  TIME_OR_ROUTE_CONFLICT: '配送時段排不下，或是繞過去會讓別的單遲到',
  TIME_WINDOW_CONFLICT: '配送時段排不下',
  VEHICLE_UNAVAILABLE: '今天可用的車不夠',
  UNASSIGNABLE: '載重、責任區、配送時段三個條件湊不出可行的安排',
  UNASSIGNED_BY_SOLVER: '載重、責任區、配送時段三個條件湊不出可行的安排',
}

export function unassignedReasonLabel(reason: string | undefined | null): string {
  if (!reason) return '目前的條件下排不進去'
  return unassignedReasons[reason] || reason
}

export function fieldLabel(path: string): string {
  const separator = path.lastIndexOf('.')
  const key = separator >= 0 ? path.slice(separator + 1) : path
  return fieldLabels[key] || key
}

/** `orders` / `packages` are sheet names in the file, not words anyone says. */
const sheetNouns: Record<string, string> = {
  orders: '訂單',
  packages: '包裹',
  vehicles: '車輛',
  zones: '區域',
}

/** `orders.ORD-001.location_label` → `訂單 ORD-001 缺「地點名稱」` */
export function formatValidationError(error: ValidationError): string {
  if (error.code !== 'MISSING_REQUIRED_FIELD') return error.message
  const parts = error.path.split('.')
  const noun = sheetNouns[parts[0]] || ''
  const id = parts.length >= 3 ? parts[1] : ''
  const subject = [noun, id].filter(Boolean).join(' ')
  return subject ? `${subject} 缺「${fieldLabel(error.path)}」` : `缺「${fieldLabel(error.path)}」`
}

/**
 * One readable block instead of a single line of clauses joined by 「；」.
 *
 * A dispatcher looking at this has to know three things: how many problems
 * there are, which rows they are on, and that fixing the file and uploading it
 * again is the whole remedy. The old string buried all three.
 */
export function formatValidationReport(errors: ValidationError[], fallback: string): string {
  const missing = errors.filter((error) => error.code === 'MISSING_REQUIRED_FIELD')
  if (missing.length === 0) {
    const others = errors.map((error) => error.message)
    return others.length ? [fallback, ...others].join('\n') : fallback
  }
  const rows = missing.map(formatValidationError)
  const rest = errors.filter((error) => error.code !== 'MISSING_REQUIRED_FIELD')
  const tail = rest.length ? ['', ...rest.map((error) => error.message)] : []
  return [
    `這份檔案有 ${missing.length} 個地方要補，補完再傳一次就可以排班：`,
    '',
    ...rows,
    ...tail,
    '',
    '其他欄位都讀到了。',
  ].join('\n')
}
