export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

export function formatNumber(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat('zh-TW', { maximumFractionDigits }).format(value)
}

export function formatWeight(value: number): string {
  return `${formatNumber(value, 1)} kg`
}

export function formatDistance(value: number): string {
  return value >= 1000 ? `${formatNumber(value / 1000, 1)} km` : `${formatNumber(value)} m`
}

export function formatDuration(value: number): string {
  return `${formatNumber(Math.round(value / 60))} 分鐘`
}

/**
 * 預估到達一律顯示台北時間的 HH:MM。
 * 後端給的是完整 ISO（2026-09-01T09:18:34+08:00），直接印出來在畫面上
 * 又長又難讀，而且同一個數值在方案卡與訂單表會長得不一樣。
 * 解析不出來時原樣回傳，不要吞掉資料。
 */
export function formatEta(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' }).format(parsed)
}

export function timeSlotLabel(value: string): string {
  const labels: Record<string, string> = { MORNING: '早上', AFTERNOON: '中午', EVENING: '晚上', AM: '早上', PM: '中午' }
  return labels[value] || value
}

const vehicleOrdinals = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

/**
 * VEH-002 顯示成「第二車」。
 * 車號是資料的鍵，不是調度員說話的方式；對話裡已經改口，畫面再印 VEH-002
 * 兩邊就對不起來。認不出來的編號原樣回傳，不要假裝看懂。
 */
export function vehicleLabel(vehicleId: string | null | undefined): string {
  if (!vehicleId) return '這台車'
  const match = /^VEH-(\d+)$/.exec(vehicleId.trim().toUpperCase())
  if (!match) return vehicleId
  const number = Number(match[1])
  return number >= 1 && number <= vehicleOrdinals.length ? `第${vehicleOrdinals[number - 1]}車` : vehicleId
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
