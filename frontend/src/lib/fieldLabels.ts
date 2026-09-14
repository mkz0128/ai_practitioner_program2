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

export function fieldLabel(path: string): string {
  const separator = path.lastIndexOf('.')
  const key = separator >= 0 ? path.slice(separator + 1) : path
  return fieldLabels[key] || key
}

export function formatValidationError(error: ValidationError): string {
  if (error.code !== 'MISSING_REQUIRED_FIELD') return error.message
  const separator = error.path.lastIndexOf('.')
  const subject = separator >= 0 ? error.path.slice(0, separator) : ''
  const prefix = subject ? `${subject} ` : ''
  return `${prefix}缺少必填欄位 ${fieldLabel(error.path)}。`
}
