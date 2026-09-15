import { expect, test, type Page } from '@playwright/test'

import {
  applyVisibleRule,
  expectCleanScreen,
  expectHumanReply,
  includesAny,
  openFreshDataset,
  sample,
  saveStep,
  sendUi,
} from './robustness-helpers'

test.describe.configure({ mode: 'serial' })

async function openSequencePage(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openFreshDataset(page, sample('demo-50-tight.xlsx'))
}

test('R3-1：交錯操作不污染脈絡', async ({ page }) => {
  test.setTimeout(1_200_000)
  await openSequencePage(page)

  const injury = await sendUi(page, '三號車的老王最近腰傷，比較重的單先不要給他')
  console.log(`R3-1-01 畫面回覆：${injury}`)
  expect(includesAny(injury, ['VEH-003', '三號車'])).toBe(true)
  await saveStep(page, 'R3-1-01-injury')

  const rule = await sendUi(page, '20 公斤以上就不要，永久')
  expect(includesAny(rule, ['20', '規則', '影響', '改派'])).toBe(true)
  await saveStep(page, 'R3-1-02-rule')
  await applyVisibleRule(page)
  await saveStep(page, 'R3-1-03-applied')

  const missing = await sendUi(page, '客戶剛剛打電話來，有一張急單要今天早上送到，15公斤')
  expect(includesAny(missing, ['缺少', '還需要', '補齊'])).toBe(true)
  await saveStep(page, 'R3-1-04-missing')
  const summary = await sendUi(page, 'ORD-101，大安信義交界示範配送點，臺北市，行政區信義，25.040，121.560，Z3，1 件')
  expect(includesAny(summary, ['臨時訂單', '摘要', '確認'])).toBe(true)
  await saveStep(page, 'R3-1-05-summary')
  const preview = await sendUi(page, '產生插單預覽')
  console.log(`R3-1-06 畫面回覆：${preview}`)
  await saveStep(page, 'R3-1-06-preview-response')
  expect(includesAny(preview, ['方案', '預覽', '安排'])).toBe(true)
  await expect(page.locator('button.urgent-card').first()).toBeVisible({ timeout: 180_000 })
  await saveStep(page, 'R3-1-06-preview')
  const selected = await sendUi(page, '用 A，但這單先送')
  expect(includesAny(selected, ['方案', '第', '送'])).toBe(true)
  await saveStep(page, 'R3-1-07-selected')

  const highest = await sendUi(page, '哪台車載重最高')
  await expectHumanReply(page, 'R3-1-08')
  expect(includesAny(highest, ['VEH-', '載重', 'kg', '公斤'])).toBe(true)
  await saveStep(page, 'R3-1-08-highest')
  const assignment = await sendUi(page, 'ORD-101 為什麼排這裡')
  console.log(`R3-1-09 畫面回覆：${assignment}`)
  await saveStep(page, 'R3-1-09-assignment-response')
  await expectHumanReply(page, 'R3-1-09')
  expect(assignment).toContain('ORD-101')
  expect(includesAny(assignment, ['VEH-', '安排'])).toBe(true)
  await saveStep(page, 'R3-1-09-assignment')
  const unavailable = await sendUi(page, '三號車今天不能出車')
  console.log(`R3-1-10 畫面回覆：${unavailable}`)
  await saveStep(page, 'R3-1-10-unavailable-response')
  await expectHumanReply(page, 'R3-1-10')
  expect(includesAny(unavailable, ['VEH-003', '三號車'])).toBe(true)
  expect(includesAny(unavailable, ['不能', '停駛', '請假', '重排', '安排'])).toBe(true)
  await saveStep(page, 'R3-1-10-unavailable')
  const refusal = await sendUi(page, '把所有單重新分配一遍')
  await expectHumanReply(page, 'R3-1-11')
  expect(refusal).toContain('這個我不能改')
  await expectCleanScreen(page, 'R3-1')
  await saveStep(page, 'R3-1-11-refusal')
})

test('R3-2：放棄急單後可正常開新流程', async ({ page }) => {
  test.setTimeout(720_000)
  await openSequencePage(page)
  const first = await sendUi(page, '客戶剛剛打電話來，有一張急單要今天早上送到，15公斤')
  expect(includesAny(first, ['缺少', '還需要', '補齊'])).toBe(true)
  await saveStep(page, 'R3-2-01-start')
  const abandoned = await sendUi(page, '算了不要了')
  await expectHumanReply(page, 'R3-2-02')
  expect(includesAny(abandoned, ['取消', '撤', '不要', '原方案'])).toBe(true)
  await saveStep(page, 'R3-2-02-abandoned')
  const highest = await sendUi(page, '哪台車載重最高')
  await expectHumanReply(page, 'R3-2-03')
  expect(includesAny(highest, ['VEH-', '載重', 'kg', '公斤'])).toBe(true)
  await saveStep(page, 'R3-2-03-highest')
  const second = await sendUi(page, '再加一張急單，內湖，8公斤')
  await expectHumanReply(page, 'R3-2-04')
  expect(includesAny(second, ['缺少', '還需要', '補齊'])).toBe(true)
  expect(second).not.toContain('ORD-101')
  await saveStep(page, 'R3-2-04-new-urgent')
})

test('R3-3：補欄位中插入查詢後仍可完成草稿', async ({ page }) => {
  test.setTimeout(720_000)
  await openSequencePage(page)
  const first = await sendUi(page, '客戶剛剛打電話來，有一張急單要今天早上送到，15公斤')
  expect(includesAny(first, ['缺少', '還需要', '補齊'])).toBe(true)
  await saveStep(page, 'R3-3-01-start')
  const district = await sendUi(page, '行政區是信義')
  await expectHumanReply(page, 'R3-3-02')
  expect(district).not.toContain('找不到這台車')
  expect(district).not.toContain('車輛清單')
  expect(includesAny(district, ['缺少', '還需要', '補齊', '訂單'])).toBe(true)
  await saveStep(page, 'R3-3-02-district')
  const load = await sendUi(page, '這樣會不會超載')
  console.log(`R3-3-03 畫面回覆：${load}`)
  await saveStep(page, 'R3-3-03-load-response')
  await expectHumanReply(page, 'R3-3-03')
  expect(includesAny(load, ['載重', '超載', '容量', '公斤', '方案', '安排'])).toBe(true)
  await saveStep(page, 'R3-3-03-load')
  const completed = await sendUi(page, 'ORD-101，大安信義交界示範配送點，臺北市，25.040，121.560，Z3，1 件')
  await expectHumanReply(page, 'R3-3-04')
  expect(includesAny(completed, ['臨時訂單', '摘要', '確認'])).toBe(true)
  await saveStep(page, 'R3-3-04-completed')
})
