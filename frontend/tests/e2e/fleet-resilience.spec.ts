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

const vehicleCases = [
  ['FLEET-01', '一號車今天不能出車', 'VEH-001'],
  ['FLEET-02', '二號車今天不能出車', 'VEH-002'],
  ['FLEET-03', '三號車今天不能出車', 'VEH-003'],
  ['FLEET-04', '四號車今天不能出車', 'VEH-004'],
] as const

for (const [id, input, vehicleId] of vehicleCases) {
  test(`${id} ${input}：停駛後仍回報可安排張數`, async ({ page }) => {
    test.setTimeout(600_000)
    await openFreshDataset(page, sample('demo-50-tight.xlsx'))

    const reply = await sendUi(page, input)
    await expectHumanReply(page, input)
    expect(reply).toContain(vehicleId)
    expect(reply).toContain('目前可安排')
    expect(reply).toContain('張')
    expect(reply).not.toContain('沒有任何訂單能在目前限制下指派')
    await expectCleanScreen(page, id)
    await saveStep(page, id)
  })
}
