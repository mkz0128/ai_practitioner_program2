import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

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
  await page.getByLabel('上傳 Excel').first().setInputFiles(relaxedWorkbook)
  await expect(page.getByText(/已完成 \d+／\d+ 張訂單的排班/)).toBeVisible({ timeout: 180_000 })
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
  await expect(page.getByText('VEH-003 今天實際比預估慢 22 分鐘。已記錄。')).toBeVisible()
  await expect(page.getByText(/Z5 區每站停留時間平均比預估多 6 分鐘/)).toBeVisible()
  await expect(page.getByText('建議將 Z5 的服務時間由 3 分鐘調整為 9 分鐘。').first()).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, 'F6-01.png'), fullPage: true })

  const status = await send(page, '今天調度狀況如何')
  const statusData = deviationEvidence(status)
  expect(statusData.status).toBe('RECORDED')
  const vehicleDeviations = statusData.vehicle_deviations as Array<{ vehicle_id: string; delay_minutes: number }>
  const zoneDeviations = statusData.zone_deviations as Array<{ zone_code: string; extra_service_minutes_per_stop: number }>
  expect(vehicleDeviations[0]).toEqual(expect.objectContaining({ vehicle_id: 'VEH-003', delay_minutes: 22 }))
  expect(zoneDeviations[0]).toEqual(expect.objectContaining({ zone_code: 'Z5', extra_service_minutes_per_stop: 6 }))
  await expect(page.getByText(/已記錄 2 項/)).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, 'F6-02.png'), fullPage: true })
  await page.screenshot({ path: path.join(screenshotDir, 'F6-03.png'), fullPage: true })
  await page.screenshot({ path: path.join(screenshotDir, 'F6-04.png'), fullPage: true })

  const before = await page.request.get('/api/v1/dispatch-parameters')
  expect((await before.json()).service_minutes_by_zone).toEqual({})
  await page.screenshot({ path: path.join(screenshotDir, 'F6-05.png'), fullPage: true })

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
  await page.screenshot({ path: path.join(screenshotDir, 'F6-06.png'), fullPage: true })

  await expect(page.getByText('所有數字來自後端確定性計算')).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, 'F6-07.png'), fullPage: true })
  expect(guards.consoleErrors).toEqual([])
  expect(guards.dispatchRequests).toEqual([])
  expect(guards.googleRequests).toEqual([])
})
