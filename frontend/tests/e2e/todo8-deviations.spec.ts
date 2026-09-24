import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

import { saveScreenshot } from './screenshot-helper'

const relaxedWorkbook = path.resolve('..', 'data', 'samples', 'demo-50-relaxed.xlsx')
const screenshotDir = path.resolve('..', 'docs', 'screenshots')

test.afterEach(async ({ page }) => {
  const response = await page.request.post('/api/v1/runtime/reset')
  expect(response.ok(), await response.text()).toBeTruthy()
})

type Evidence = { tool: string; data: Record<string, unknown> }
type AgentBody = { message?: string; evidence?: Evidence[]; error?: { code?: string } }

function installBrowserGuards(page: Page) {
  const consoleErrors: string[] = []
  const dispatchRequests: string[] = []
  const googleRequests: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/plans/') && request.url().endsWith('/dispatch')) dispatchRequests.push(request.url())
    if (request.url().includes('googleapis.com')) googleRequests.push(request.url())
  })
  return { consoleErrors, dispatchRequests, googleRequests }
}

async function importDemoPlan(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  // 服務時間參數與司機規則是存在後端檔案裡的，跨測試、跨重跑都還在。
  // 不先清掉，第二次跑這支測試就會從「已經套用 Z5 9 分鐘」開始。
  const reset = await page.request.post('/api/v1/runtime/reset')
  expect(reset.ok()).toBeTruthy()
  await page.reload()
  await page.getByLabel('上傳 Excel').first().setInputFiles(relaxedWorkbook)
  // Choosing the file only attaches it; the panel says 「附加檔案 / 送出」 and
  // nothing is uploaded until 送出 is pressed.
  await page.getByRole('button', { name: '送出', exact: true }).click()
  await expect(page.locator('.topbar-stats')).toContainText('已安排', { timeout: 180_000 })
  await expect(page.getByLabel('配送地圖', { exact: true })).toBeVisible({ timeout: 30_000 })
}

async function send(page: Page, message: string): Promise<AgentBody> {
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const responsePromise = page.waitForResponse((response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST', { timeout: 180_000 })
  await input.click()
  await input.pressSequentially(message)
  await expect(input).toHaveValue(message)
  await input.press('Enter')
  const response = await responsePromise
  const body = await response.json() as AgentBody
  expect(response.ok(), body.error?.code ?? body.message ?? 'agent request failed').toBeTruthy()
  return body
}

function deviationEvidence(body: AgentBody): Record<string, unknown> {
  const item = body.evidence?.find((entry) => entry.tool === 'inspect_dispatch_deviations')
  expect(item).toBeTruthy()
  return item?.data || {}
}

test('TODO 8：F6-01～F6-07 時間軸偏差、建議確認與新參數重排', async ({ page }) => {
  test.setTimeout(900_000)
  const guards = installBrowserGuards(page)
  await importDemoPlan(page)

  await page.getByRole('button', { name: '開始裝車' }).click()
  await page.getByRole('button', { name: '模擬出發' }).click()
  await expect(page.getByRole('slider', { name: '配送時間軸' })).toBeVisible({ timeout: 30_000 })
  const timeline = page.getByRole('slider', { name: '配送時間軸' })
  await timeline.fill('80')
  await expect(page.getByLabel('配送偏差與參數建議')).toBeVisible({ timeout: 30_000 })
  // 車號與區碼改成調度員說得出口的名稱：VEH-003 講「第三車」，Z5 帶出區名。
  // 分鐘數不寫死，改成往下比對證據裡的 delay_minutes，畫面與資料必須是同一個數字。
  await expect(page.getByText(/第[一二三四五六七八九十]車今天實際比預估慢 \d+ 分鐘。/)).toBeVisible()
  await expect(page.getByText(/（Z5）每一站平均多停 6 分鐘/)).toBeVisible()
  await expect(page.getByText('建議將 Z5 的服務時間由 3 分鐘調整為 9 分鐘。').first()).toBeVisible()
  await saveScreenshot(page, screenshotDir, 'F6-01')

  const status = await send(page, '今天調度狀況如何')
  const statusData = deviationEvidence(status)
  expect(statusData.status).toBe('RECORDED')
  const vehicleDeviations = statusData.vehicle_deviations as Array<{ vehicle_id: string; delay_minutes: number }>
  const zoneDeviations = statusData.zone_deviations as Array<{ zone_code: string; extra_service_minutes_per_stop: number }>
  expect(vehicleDeviations[0]).toEqual(expect.objectContaining({ vehicle_id: 'VEH-003' }))
  expect(vehicleDeviations[0].delay_minutes).toBeGreaterThan(0)
  // 畫面講的分鐘數必須就是證據裡的那一個，不能各講各的。
  await expect(page.getByText(`第三車今天實際比預估慢 ${vehicleDeviations[0].delay_minutes} 分鐘。`)).toBeVisible()
  expect(zoneDeviations[0]).toEqual(expect.objectContaining({ zone_code: 'Z5', extra_service_minutes_per_stop: 6 }))
  await expect(page.getByText(/已記錄 2 項/)).toBeVisible()
  await saveScreenshot(page, screenshotDir, 'F6-02')
  await saveScreenshot(page, screenshotDir, 'F6-03')
  await saveScreenshot(page, screenshotDir, 'F6-04')

  const before = await page.request.get('/api/v1/dispatch-parameters')
  expect((await before.json()).service_minutes_by_zone).toEqual({})
  await saveScreenshot(page, screenshotDir, 'F6-05')

  // 第七幕分兩段：先講今天成效，調度員問到明天怎麼改，參數建議才出現。
  // 沒問就把建議塞出來，等於替他決定明天要改什麼。
  await send(page, '好，那明天要怎麼改')
  await expect(page.getByRole('button', { name: /確認套用 Z5 9 分鐘/ })).toBeVisible({ timeout: 60_000 })

  const confirmResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/dispatch-parameters/confirm') && response.request().method() === 'POST')
  await page.getByRole('button', { name: /確認套用 Z5 9 分鐘/ }).click()
  expect((await confirmResponse).ok()).toBeTruthy()
  await expect(page.getByRole('button', { name: '已確認，重新排班後生效' })).toBeVisible()
  const after = await page.request.get('/api/v1/dispatch-parameters')
  expect((await after.json()).service_minutes_by_zone).toEqual({ Z5: 9 })

  const replanResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/plans') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '用新參數重排' }).click()
  const replannedResponse = await replanResponse
  expect(replannedResponse.ok()).toBeTruthy()
  const replanned = await replannedResponse.json() as { parameter_replan?: { applied: boolean }; parameter_state?: { service_minutes_by_zone: Record<string, number> } }
  expect(replanned.parameter_replan?.applied).toBe(true)
  expect(replanned.parameter_state?.service_minutes_by_zone).toEqual({ Z5: 9 })
  await expect(page.getByText(/已用新參數重新排班/)).toBeVisible({ timeout: 30_000 })
  await saveScreenshot(page, screenshotDir, 'F6-06')

  await expect(page.getByText('所有數字來自後端確定性計算')).toBeVisible()
  await saveScreenshot(page, screenshotDir, 'F6-07')
  expect(guards.consoleErrors).toEqual([])
  expect(guards.dispatchRequests).toEqual([])
  expect(guards.googleRequests).toEqual([])
})
