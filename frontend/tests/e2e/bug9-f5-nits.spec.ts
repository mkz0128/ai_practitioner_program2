import path from 'node:path'

import { saveScreenshot } from './screenshot-helper'

import { expect, test, type Page } from '@playwright/test'

const workbooks = [
  path.resolve('..', 'data', 'samples', 'demo-50-relaxed.xlsx'),
  path.resolve('..', 'data', 'samples', 'demo-50-tight.xlsx'),
]
const screenshotDir = path.resolve('..', 'docs', 'screenshots')

function installBrowserGuards(page: Page) {
  const consoleErrors: string[] = []
  const dispatchRequests: string[] = []
  const googleRequests: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/plans/') && request.url().includes('/dispatch')) {
      dispatchRequests.push(request.url())
    }
    if (request.url().includes('googleapis.com')) googleRequests.push(request.url())
  })
  return { consoleErrors, dispatchRequests, googleRequests }
}

type AgentEvidence = { tool: string; data: Record<string, unknown> }
type AgentResponse = { message?: string; evidence: AgentEvidence[] }

/**
 * 時間軸拉到某一刻之後，前面的站已經送完、被凍結；對那種單講「要提前」，
 * 系統只會回「不能更動」，問不出方案卡。ORD-011 以前還沒送，路線一改就送完了，
 * 所以改成每次從畫面上挑一張真的還沒送達的單。
 */
async function pickUndeliveredOrder(page: Page): Promise<string> {
  const stops = page.locator('.timeline-stop[aria-disabled="false"]')
  await expect(stops.first()).toBeVisible({ timeout: 60_000 })
  const count = await stops.count()
  for (let index = 0; index < count; index += 1) {
    const label = (await stops.nth(index).getAttribute('aria-label')) || ''
    const match = /ORD-\d{3}/.exec(label)
    if (match) return match[0]
  }
  throw new Error('時間軸上沒有任何還沒送達的站，這一幕演不起來')
}

async function runEarlyDeliveryCase(workbook: string, run: number, page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByLabel('上傳 Excel').setInputFiles(workbook)
  // 選檔案只是附加，要按【送出】才會上傳排班。
  await page.getByRole('button', { name: '送出', exact: true }).click()
  const expectedImportMessage = path.basename(workbook) === 'demo-50-tight.xlsx'
    ? '49/50 已安排'
    : '50/50 已安排'
  await expect(page.locator('.topbar-stats')).toContainText(expectedImportMessage, { timeout: 120_000 })
  await page.getByRole('button', { name: '開始裝車' }).click()
  await expect(page.getByText('上車後').first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '模擬出發' }).click()
  await expect(page.getByText('已發車').first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('slider', { name: '配送時間軸' }).fill('100')

  const target = await pickUndeliveredOrder(page)
  const message = `${target} 客戶說中午前一定要拿到`
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST',
  )
  await input.click()
  await input.pressSequentially(message)
  await expect(input).toHaveValue(message)
  await input.press('Enter')
  const response = await responsePromise
  expect(response.ok(), await response.text()).toBeTruthy()
  const body = await response.json() as AgentResponse
  const evidence = body.evidence.find((item) => item.tool === 'prioritize_order_preview')
  const group = page.locator('[aria-label="臨時插單方案"]').last()
  await expect(group, `輸入：${message}\n系統實際回覆：${body.message}`).toBeVisible({ timeout: 60_000 })
  const selectableCount = await group.locator('button.urgent-card').count()
  expect(selectableCount).toBeGreaterThan(0)
  const frozen = new Set(
    Array.isArray(evidence?.data.frozen_order_ids)
      ? evidence.data.frozen_order_ids.map(String)
      : [],
  )
  const sequenceChanges = (
    evidence?.data.diff as { sequence_changes?: Array<{ order_id?: string }> } | undefined
  )?.sequence_changes || []
  expect(frozen.has(target)).toBe(false)
  expect(sequenceChanges.every((item) => typeof item.order_id === 'string' && !frozen.has(item.order_id))).toBe(true)
  const options = evidence?.data.options as Array<{
    selectable?: boolean
    cost?: { distance_delta_m?: number | null; duration_delta_s?: number | null }
  }> | undefined
  const feasibleOptions = (options || []).filter((option) => option.selectable)
  expect(feasibleOptions.every((option) => (option.cost?.distance_delta_m ?? 0) >= 0)).toBe(true)
  expect(feasibleOptions.every((option) => (option.cost?.duration_delta_s ?? 0) >= 0)).toBe(true)
  await page.screenshot({
    path: path.join(screenshotDir, `BUG-9-${path.basename(workbook, '.xlsx')}-${run}.png`),
    fullPage: true,
  })
}

for (const workbook of workbooks) {
  test(`BUG-9 ${path.basename(workbook)} 兩次提前配送應有可選方案`, async ({ page }) => {
    test.setTimeout(300_000)
    const guards = installBrowserGuards(page)
    await runEarlyDeliveryCase(workbook, 1, page)
    await runEarlyDeliveryCase(workbook, 2, page)
    expect(guards.consoleErrors).toEqual([])
    expect(guards.dispatchRequests).toEqual([])
    expect(guards.googleRequests).toEqual([])
  })
}

test('NIT-1／NIT-2 目前方案卡 ETA 與工具回覆診斷', async ({ page }) => {
  test.setTimeout(300_000)
  const guards = installBrowserGuards(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByLabel('上傳 Excel').setInputFiles(workbooks[0])
  // 選檔案只是附加，要按【送出】才會上傳排班。
  await page.getByRole('button', { name: '送出', exact: true }).click()
  await expect(page.locator('.topbar-stats')).toContainText('50/50 已安排', { timeout: 120_000 })
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const send = async (message: string): Promise<AgentResponse> => {
    const responsePromise = page.waitForResponse(
      (response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST',
    )
    await input.click()
    await input.pressSequentially(message)
    await expect(input).toHaveValue(message)
    await input.press('Enter')
    const response = await responsePromise
    expect(response.ok(), await response.text()).toBeTruthy()
    return await response.json() as AgentResponse
  }

  await page.getByRole('button', { name: '開始裝車' }).click()
  await expect(page.getByText('上車後').first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '模擬出發' }).click()
  await expect(page.getByText('已發車').first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('slider', { name: '配送時間軸' }).fill('100')

  await send(`${await pickUndeliveredOrder(page)} 客戶說中午前一定要拿到`)
  const earlyGroup = page.locator('[aria-label="臨時插單方案"]').last()
  await expect(earlyGroup).toBeVisible({ timeout: 60_000 })
  // NIT-1 要的是「卡片上講得出真的時刻」，不是某一個固定的鐘點；路線一改，
  // 同一張單的到達時間本來就會變。趕不上客戶時限的那種卡沒有「預估送達」
  // 那一列，但一定會寫出最快幾點到。
  await expect(earlyGroup).not.toContainText('預估送達 —')
  await expect(earlyGroup).toContainText(/\d{1,2}:\d{2}/)
  await saveScreenshot(page, screenshotDir, 'NIT-1-early')

  const review = await send('今天調度狀況如何')
  // 這句可以答成「今日成效」也可以答成「配送偏差」，兩種都是真的在講今天。
  // NIT-2 要守的是：答出具體數字，不是罐頭訊息。
  expect(review.message).toMatch(/今天回顧：|總里程/)
  expect(review.message).toMatch(/\d/)
  expect(review.message).not.toContain('已完成確定性工具計算')
  await saveScreenshot(page, screenshotDir, 'NIT-2-review')

  const timeChange = await send('ORD-019 改成下午送')
  expect(timeChange.message).toContain('時段')
  expect(timeChange.message).not.toContain('已完成確定性工具計算')
  await saveScreenshot(page, screenshotDir, 'NIT-2-time-slot')
  expect(guards.consoleErrors).toEqual([])
  expect(guards.dispatchRequests).toEqual([])
  expect(guards.googleRequests).toEqual([])
})

test('NIT-1 移除訂單方案卡保留原預估送達', async ({ page }) => {
  test.setTimeout(300_000)
  const guards = installBrowserGuards(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByLabel('上傳 Excel').setInputFiles(workbooks[0])
  // 選檔案只是附加，要按【送出】才會上傳排班。
  await page.getByRole('button', { name: '送出', exact: true }).click()
  await expect(page.locator('.topbar-stats')).toContainText('50/50 已安排', { timeout: 120_000 })
  await page.getByRole('button', { name: '開始裝車' }).click()
  await expect(page.getByText('上車後').first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '模擬出發' }).click()
  await expect(page.getByText('已發車').first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('slider', { name: '配送時間軸' }).fill('100')

  // 已送達的站不能再動，挑一張畫面上還沒送的單。
  const removeMessage = `${await pickUndeliveredOrder(page)} 改明天送`
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST',
  )
  await input.click()
  await input.pressSequentially(removeMessage)
  await expect(input).toHaveValue(removeMessage)
  await input.press('Enter')
  const response = await responsePromise
  expect(response.ok(), await response.text()).toBeTruthy()
  await response.json() as AgentResponse
  const group = page.locator('[aria-label="臨時插單方案"]').last()
  await expect(group).toBeVisible({ timeout: 60_000 })
  await expect(group).not.toContainText('預估送達 —')
  await saveScreenshot(page, screenshotDir, 'NIT-1-remove')
  expect(guards.consoleErrors).toEqual([])
  expect(guards.dispatchRequests).toEqual([])
  expect(guards.googleRequests).toEqual([])
})
