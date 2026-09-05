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
})
