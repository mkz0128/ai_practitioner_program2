import path from 'node:path'

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

async function runEarlyDeliveryCase(workbook: string, run: number, page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByLabel('上傳 Excel').setInputFiles(workbook)
  const expectedImportMessage = path.basename(workbook) === 'demo-50-tight.xlsx'
    ? '已完成 49／50 張訂單的排班'
    : '已完成 50／50 張訂單的排班'
  await expect(page.getByText(expectedImportMessage)).toBeVisible({ timeout: 120_000 })
  await page.getByRole('button', { name: '開始裝車' }).click()
  await expect(page.getByText('上車後').first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '模擬出發' }).click()
  await expect(page.getByText('已發車').first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('slider', { name: '配送時間軸' }).fill('100')

  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST',
  )
  await input.click()
  await input.pressSequentially('ORD-011 客戶說中午前一定要拿到')
  await expect(input).toHaveValue('ORD-011 客戶說中午前一定要拿到')
  await input.press('Enter')
  const response = await responsePromise
  expect(response.ok(), await response.text()).toBeTruthy()
  const body = await response.json() as AgentResponse
  const evidence = body.evidence.find((item) => item.tool === 'prioritize_order_preview')
  const group = page.locator('[aria-label="臨時插單方案"]').last()
  await expect(group).toBeVisible({ timeout: 60_000 })
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
  expect(frozen.has('ORD-011')).toBe(false)
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
  await expect(page.getByText('已完成 50／50 張訂單的排班')).toBeVisible({ timeout: 120_000 })
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

  await send('ORD-011 客戶說中午前一定要拿到')
  const earlyGroup = page.locator('[aria-label="臨時插單方案"]').last()
  await expect(earlyGroup).toBeVisible({ timeout: 60_000 })
  await expect(earlyGroup).not.toContainText('預估送達 —')
  await expect(earlyGroup).toContainText('預估送達 13:00')
  await page.screenshot({ path: path.join(screenshotDir, 'NIT-1-early.png'), fullPage: true })

  const review = await send('今天調度狀況如何')
  expect(review.message).toContain('今天回顧：')
  expect(review.message).toContain('VEH-003')
  expect(review.message).toContain('Z5')
  expect(review.message).not.toContain('已完成確定性工具計算')
  await page.screenshot({ path: path.join(screenshotDir, 'NIT-2-review.png'), fullPage: true })

  const timeChange = await send('ORD-019 改成下午送')
  expect(timeChange.message).toContain('時段')
  expect(timeChange.message).not.toContain('已完成確定性工具計算')
  await page.screenshot({ path: path.join(screenshotDir, 'NIT-2-time-slot.png'), fullPage: true })
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
  await expect(page.getByText('已完成 50／50 張訂單的排班')).toBeVisible({ timeout: 120_000 })
  await page.getByRole('button', { name: '開始裝車' }).click()
  await expect(page.getByText('上車後').first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '模擬出發' }).click()
  await expect(page.getByText('已發車').first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('slider', { name: '配送時間軸' }).fill('100')

  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST',
  )
  await input.click()
  await input.pressSequentially('ORD-018 改明天送')
  await expect(input).toHaveValue('ORD-018 改明天送')
  await input.press('Enter')
  const response = await responsePromise
  expect(response.ok(), await response.text()).toBeTruthy()
  await response.json() as AgentResponse
  const group = page.locator('[aria-label="臨時插單方案"]').last()
  await expect(group).toBeVisible({ timeout: 60_000 })
  await expect(group).not.toContainText('預估送達 —')
  await page.screenshot({ path: path.join(screenshotDir, 'NIT-1-remove.png'), fullPage: true })
  expect(guards.consoleErrors).toEqual([])
  expect(guards.dispatchRequests).toEqual([])
  expect(guards.googleRequests).toEqual([])
})
