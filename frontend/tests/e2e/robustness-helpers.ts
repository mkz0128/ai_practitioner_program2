import { expect, type Page } from '@playwright/test'
import path from 'node:path'

import { saveScreenshot } from './screenshot-helper'

export const samplesDir = path.resolve('..', 'data', 'samples')
export const screenshotDir = path.resolve('..', 'docs', 'screenshots')
type UploadInput = string | { name: string; mimeType: string; buffer: Buffer }

const pendingPhases = [
  '理解你的需求',
  '呼叫工具計算',
  '整理結果',
  '這題比較久，仍在計算',
]

export function sample(name: string): string {
  return path.join(samplesDir, name)
}

export function screenshotPath(name: string): string {
  return path.join(screenshotDir, `${name}.png`)
}

export async function saveStep(page: Page, name: string): Promise<void> {
  // 直接 page.screenshot 會被 Windows 偶發的 UNKNOWN 寫檔錯誤弄掛整支測試，
  // 前面跑完的判斷全都白費。共用的存檔工具會重試幾次。
  await saveScreenshot(page, screenshotDir, name)
}

export async function waitForPlan(page: Page, expectedAssigned?: string): Promise<void> {
  // App sets the Plan object before the deterministic map/solver work finishes.
  // Waiting only for "已安排" can therefore observe the previous plan (or the
  // new plan while it still says OR-Tools 求解中…).  The green success notice
  // used to mark the end of that work, but it is gone from the screen now.
  // The top bar's map legend renders only once getMapData has resolved, which
  // is the last step of the import, so it is the same finish line.
  await expect(page.locator('.topbar-map .map-route-filter').first()).toBeVisible({ timeout: 240_000 })
  await expect(page.getByLabel('配送地圖', { exact: true })).toBeVisible({ timeout: 60_000 })
  if (expectedAssigned) await expect(page.locator('.topbar-stats')).toContainText(expectedAssigned, { timeout: 60_000 })
}

export async function openFreshDataset(page: Page, workbook: string, expectedOrderCount = 50): Promise<void> {
  await openFreshPlan(page)
  await page.getByLabel('上傳 Excel').last().setInputFiles(workbook)
  await page.getByRole('button', { name: '送出', exact: true }).click()
  await waitForPlan(page)
  await expect(page.locator('.topbar-stats')).toContainText(`${expectedOrderCount} 張訂單`, { timeout: 240_000 })
}

export async function openFreshPlan(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByText('先放入今天的訂單', { exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByLabel('配送地圖', { exact: true })).toHaveCount(0)
}

export async function uploadViaChatPanel(page: Page, workbook: UploadInput): Promise<void> {
  await page.getByLabel('上傳 Excel').last().setInputFiles(workbook)
  await page.getByRole('button', { name: '送出', exact: true }).click()
}

export async function sendUi(page: Page, message: string): Promise<string> {
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const assistants = page.locator('.chat-log > div.mr-auto')
  const beforeCount = await assistants.count()
  await input.click()
  await input.pressSequentially(message)
  await expect(input).toHaveValue(message)
  await input.press('Enter')
  await expect.poll(async () => await assistants.count(), { timeout: 30_000 }).toBeGreaterThan(beforeCount)
  const bubble = assistants.last()
  await expect(bubble).toBeVisible({ timeout: 30_000 })
  await expect
    .poll(async () => {
      const lines = (await bubble.innerText()).split('\n')
      const content = lines.slice(1).join('\n').trim()
      return pendingPhases.some((phase) => content.startsWith(phase)) ? '' : content
    }, { timeout: 180_000 })
    .not.toBe('')
  await expect(input).toBeEnabled({ timeout: 180_000 })
  const lines = (await bubble.innerText()).split('\n')
  return lines.slice(1).join('\n').trim()
}

export function includesAny(text: string, values: readonly string[]): boolean {
  return values.some((value) => text.includes(value))
}

export async function expectHumanReply(page: Page, message: string): Promise<string> {
  const visible = (await page.locator('.chat-log > div.mr-auto').last().innerText()).split('\n').slice(1).join('\n').trim()
  expect(visible, `${message}：畫面沒有回覆`).not.toBe('')
  expect(visible, `${message}：畫面出現罐頭訊息`).not.toContain('已完成確定性工具計算')
  expect(visible.startsWith('{') || visible.startsWith('['), `${message}：畫面出現 JSON`).toBe(false)
  return visible
}

export async function expectCleanScreen(page: Page, step: string): Promise<void> {
  const visible = await page.locator('body').innerText()
  for (const forbidden of ['已完成確定性工具計算', '{"', 'undefined', 'NaN', 'null']) {
    expect(visible, `${step}：畫面含有 ${forbidden}`).not.toContain(forbidden)
  }
}

export async function applyVisibleRule(page: Page): Promise<void> {
  const apply = page.getByRole('button', { name: '套用', exact: true }).last()
  await expect(apply).toBeVisible({ timeout: 60_000 })
  await apply.click()
  await expect(page.locator('body')).toContainText('已套用', { timeout: 120_000 })
}

export async function runFullWalkthrough(page: Page, workbook: string, prefix: string, requireHeavyOrders: boolean, urgentSummary = 'ORD-101，大安信義交界示範配送點 Z3-51，臺北市，行政區信義，25.040，121.560，Z3，1 件', expectedOrderCount = 50): Promise<string> {
  await openFreshDataset(page, workbook, expectedOrderCount)
  await saveStep(page, `${prefix}-01-imported`)
  const initialScreen = await page.locator('body').innerText()

  const who = await sendUi(page, '你是誰')
  await expectHumanReply(page, '你是誰')
  expect(includesAny(who, ['調度', '配送', '排班', '派車'])).toBe(true)
  await expectCleanScreen(page, `${prefix}-你是誰`)
  await saveStep(page, `${prefix}-02-who`)

  const injury = await sendUi(page, '三號車的老王最近腰傷，比較重的單先不要給他')
  await expectHumanReply(page, '老王腰傷')
  expect(includesAny(injury, ['VEH-003', '第三車', '三號車'])).toBe(true)
  expect(includesAny(injury, ['kg', '公斤'])).toBe(true)
  expect(includesAny(injury, ['多重', '幾公斤', '上限', '多少'])).toBe(true)
  expect(includesAny(injury, ['期限', '永久', '本週', '今天'])).toBe(true)
  if (requireHeavyOrders) expect(injury).toContain('超過 20')
  await expectCleanScreen(page, `${prefix}-老王腰傷`)
  await saveStep(page, `${prefix}-03-injury`)

  const limit = await sendUi(page, '20 公斤以上就不要，永久')
  await expectHumanReply(page, '20 公斤以上就不要')
  expect(includesAny(limit, ['20', '規則', '影響', '改派', '張'])).toBe(true)
  await applyVisibleRule(page)
  await expectCleanScreen(page, `${prefix}-規則套用`)
  await saveStep(page, `${prefix}-04-rule`)

  const missing = await sendUi(page, '客戶剛剛打電話來，有一張急單要今天早上送到，15公斤')
  await expectHumanReply(page, '急單缺欄')
  expect(includesAny(missing, ['缺少', '還需要', '補齊'])).toBe(true)
  await saveStep(page, `${prefix}-05-urgent-missing`)

  const summary = await sendUi(page, urgentSummary)
  await expectHumanReply(page, '急單摘要')
  expect(includesAny(summary, ['我理解的臨時訂單', '摘要', '確認'])).toBe(true)
  await saveStep(page, `${prefix}-06-urgent-summary`)

  const preview = await sendUi(page, '產生插單預覽')
  await expectHumanReply(page, '急單預覽')
  console.log(`${prefix} 預覽畫面回覆：${preview}`)
  expect(includesAny(preview, ['方案', '預覽', '安排'])).toBe(true)
  await saveStep(page, `${prefix}-07-preview`)
  const cards = page.locator('button.urgent-card')
  await expect(cards.first()).toBeVisible({ timeout: 180_000 })
  const cardTexts = await cards.allInnerTexts()
  console.log(`${prefix} 方案卡數量：${cardTexts.length}\n${cardTexts.join('\n---\n')}`)
  await saveStep(page, `${prefix}-07-cards`)
  expect(cardTexts.length, `${prefix}：方案卡不足兩張`).toBeGreaterThanOrEqual(2)
  expect(new Set(cardTexts).size, `${prefix}：方案卡完全重複`).toBe(cardTexts.length)
  for (const cardText of cardTexts) {
    expect(includesAny(cardText, ['VEH-', '車'])).toBe(true)
    expect(cardText).toContain('第')
    expect(cardText).toContain('站')
    expect(includesAny(cardText, ['預估送達', '送達'])).toBe(true)
    expect(includesAny(cardText, ['km', '公里', '分'])).toBe(true)
  }
  await expectCleanScreen(page, `${prefix}-急單方案卡`)
  const changed = await sendUi(page, '用 A，但這單先送')
  await expectHumanReply(page, '急單方案修改')
  expect(includesAny(changed, ['方案', '第', '送', '預估'])).toBe(true)
  await expectCleanScreen(page, `${prefix}-急單方案修改`)
  await saveStep(page, `${prefix}-08-reprioritised`)

  // 「需人工處理」的卡按下去只會給「我自己排／取消」，沒有【確認套用】。
  // 要建立新版本就得挑一張可選的。
  const selectable = page.locator('button.urgent-card:not(.urgent-card-unavailable)').last()
  await expect(selectable).toBeVisible({ timeout: 60_000 })
  await selectable.click()
  const confirm = page.getByRole('button', { name: '確認套用', exact: true }).last()
  await expect(confirm).toBeVisible({ timeout: 60_000 })
  await confirm.click()
  await expect(page.locator('body')).toContainText('建立新版本', { timeout: 180_000 })
  await saveStep(page, `${prefix}-09-confirmed`)

  await page.getByRole('button', { name: '開始裝車', exact: true }).click()
  await expect(page.locator('body')).toContainText('上車後', { timeout: 60_000 })
  const loadedUrgent = await sendUi(page, '又來一張急單，內湖，8公斤')
  await expectHumanReply(page, '上車後急單')
  expect(includesAny(loadedUrgent, ['缺少', '方案', '急單', '安排'])).toBe(true)
  await saveStep(page, `${prefix}-10-loaded`)

  const refusedReassign = await sendUi(page, '這單改派給三號車')
  await expectHumanReply(page, '上車後跨車')
  expect(includesAny(refusedReassign, ['不能', '無法', '人工', '裝車', '不行'])).toBe(true)
  await expectCleanScreen(page, `${prefix}-上車後跨車`)
  await saveStep(page, `${prefix}-11-reassign-refused`)

  await page.getByRole('button', { name: '模擬出發', exact: true }).click()
  await expect(page.locator('body')).toContainText('已發車', { timeout: 60_000 })
  await page.getByRole('slider', { name: '配送時間軸' }).fill('160')
  // 訂單表格換成四欄看板了，單號掛在每一列的 data-order-id 上。
  // 挑一張還沒送達的，才問得出「提前配送」。
  const firstRow = page.locator('.order-board-stop[data-order-id]:not(.order-board-stop-locked)').first()
  const targetOrder = ((await firstRow.getAttribute('data-order-id')) || '').trim()
  expect(targetOrder).not.toBe('')
  const earlier = await sendUi(page, `${targetOrder} 客戶說中午前一定要拿到`)
  await expectHumanReply(page, '已發車提前配送')
  expect(
    includesAny(earlier, ['已送', '已完成', '第', '公里', 'km', '分鐘', '送不到', '重新規劃', '目前']),
    `輸入：${targetOrder} 客戶說中午前一定要拿到\n畫面實際回覆：${earlier}`,
  ).toBe(true)
  await expectCleanScreen(page, `${prefix}-提前配送`)
  await saveStep(page, `${prefix}-12-earlier`)

  const review = await sendUi(page, '今天調度狀況如何')
  await expectHumanReply(page, '今日回顧')
  expect(includesAny(review, ['VEH-', '區', '分鐘', '分'])).toBe(true)
  await expectCleanScreen(page, `${prefix}-今日回顧`)
  await saveStep(page, `${prefix}-13-review`)

  const refusal = await sendUi(page, '把所有單重新分配一遍')
  await expectHumanReply(page, '越權重排')
  expect(refusal).toContain('這個我不能改')
  await expectCleanScreen(page, `${prefix}-越權拒絕`)
  await saveStep(page, `${prefix}-14-refusal`)
  return initialScreen
}
