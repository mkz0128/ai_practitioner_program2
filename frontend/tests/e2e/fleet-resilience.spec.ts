import { expect, test } from '@playwright/test'

import {
  expectCleanScreen,
  expectHumanReply,
  openFreshDataset,
  sample,
  saveStep,
  sendUi,
} from './robustness-helpers'

test.describe.configure({ mode: 'serial' })

// The reply names the vehicle the way a dispatcher does, not by its record id.
const vehicleCases = [
  ['FLEET-01', '一號車今天不能出車', '第一車'],
  ['FLEET-02', '二號車今天不能出車', '第二車'],
  ['FLEET-03', '三號車今天不能出車', '第三車'],
  ['FLEET-04', '四號車今天不能出車', '第四車'],
] as const

for (const [id, input, vehicleLabel] of vehicleCases) {
  test(`${id} ${input}：停駛後仍回報可安排張數`, async ({ page }) => {
    test.setTimeout(600_000)
    await openFreshDataset(page, sample('demo-50-tight.xlsx'))

    const reply = await sendUi(page, input)
    await expectHumanReply(page, input)
    expect(reply).toContain(vehicleLabel)
    expect(reply).toContain('可安排')
    expect(reply).toContain('張')
    expect(reply).not.toContain('沒有任何訂單能在目前限制下指派')
    await expectCleanScreen(page, id)
    await saveStep(page, id)
  })
}
