import { describe, expect, it } from 'vitest'
import { friendlyText } from './AgentPanel'

describe('Agent 對外訊息格式', () => {
  it('工具回傳 JSON 時只顯示白話證據摘要', () => {
    const text = friendlyText(
      '{"tool":"highest_load_vehicle","vehicle_id":"VEH-003","planned_load_kg":154,"max_load_kg":160,"load_utilization":0.9625}',
      [{ tool: 'highest_load_vehicle', data: { vehicle_id: 'VEH-003', planned_load_kg: 154, max_load_kg: 160, load_utilization: 0.9625 } }],
    )

    expect(text).toContain('VEH-003')
    expect(text).toContain('154.0／160.0 kg')
    expect(text).not.toContain('"tool"')
  })

  it('資料不足時列出結構化缺欄，不回傳錯誤或猜測結果', () => {
    const text = friendlyText('需要更多資料。', [
      { tool: 'request_missing_fields', data: { missing_fields: ['order_id', 'packages'] } },
    ])

    expect(text).toContain('訂單編號、包裹重量')
    expect(text).not.toContain('Raw')
  })

  it('車輛停用預覽以白話顯示且不暴露狀態代碼或 JSON', () => {
    const text = friendlyText(
      '{"vehicle_id":"三號車","status":"UNAVAILABLE","result":"預覽已產生，未套用"}',
      [{ tool: 'change_vehicle_availability', data: { vehicle_id: '三號車', status: 'UNAVAILABLE' } }],
    )

    expect(text).toContain('三號車')
    expect(text).toContain('暫停使用')
    expect(text).toContain('尚未套用')
    expect(text).not.toContain('UNAVAILABLE')
    expect(text).not.toContain('{')
  })

  it('插單預覽顯示可驗證差異而不是通用工程訊息', () => {
    const text = friendlyText('已完成確定性工具計算。', [{
      tool: 'preview_urgent_insert',
      data: {
        order_id: 'ORD-041', affected_vehicle_count: 1, moved_order_count: 0,
        diff: { total_distance_delta_m: 1207, total_duration_delta_s: 210 },
        validator: { valid: true },
      },
    }])

    expect(text).toContain('ORD-041')
    expect(text).toContain('1 台車')
    expect(text).toContain('0 張')
    expect(text).toContain('1,207 公尺')
    expect(text).toContain('210 秒')
    expect(text).not.toContain('確定性工具')
  })

  it('無對應格式器時也不直接顯示 JSON', () => {
    const text = friendlyText('{"internal_status":"SOMETHING"}', [{ tool: 'unknown_tool', data: {} }])
    expect(text).toBe('已完成處理；詳細的計算依據已收合，請展開查看。')
  })
})
