import { test, expect } from '@playwright/test'
import path from 'node:path'

type Evidence = { tool?: string; data?: Record<string, unknown> }
type AgentBody = { message?: string; evidence?: Evidence[]; error?: { code?: string } }

test('TODO 5 方案卡修改與對話同義句驗收', async ({ page }) => {
  test.skip(!process.env.RUN_LIVE_FRONTEND_E2E, 'Set RUN_LIVE_FRONTEND_E2E=1 for the real provider gate')
  test.setTimeout(900_000)
  await page.setViewportSize({ width: 1440, height: 900 })

  const screenshotDir = path.resolve('..', 'docs', 'screenshots')
  const workbook = path.resolve('..', 'data', 'samples', 'demo-50-relaxed.xlsx')
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const consoleErrors: string[] = []
  let dispatchRequests = 0
  let googleRequests = 0
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/plans/') && request.url().endsWith('/dispatch')) dispatchRequests += 1
    if (request.url().includes('googleapis')) googleRequests += 1
  })

  async function send(message: string): Promise<AgentBody> {
    const responsePromise = page.waitForResponse((response) => response.url().includes('/api/v1/agent/chat'), { timeout: 180_000 })
    await input.fill(message)
    await input.press('Enter')
    const response = await responsePromise
    const body = await response.json() as AgentBody
    expect(response.status(), body.error?.code ?? body.message ?? 'agent request failed').toBe(200)
    await expect(page.locator('.processing-bubble')).toHaveCount(0, { timeout: 180_000 })
    return body
  }

  await page.goto('/', { waitUntil: 'commit', timeout: 30_000 })
  await page.getByLabel('上傳 Excel').setInputFiles(workbook)
  await expect(page.getByText('已匯入 50 張訂單')).toBeVisible({ timeout: 180_000 })
  await expect(page.locator('.topbar-stats')).toContainText('50/50 已安排', { timeout: 180_000 })
  await expect(input).toBeEnabled({ timeout: 180_000 })

  const missing = await send('加一張到信義區')
  expect(missing.evidence?.some((item) => item.tool === 'urgent_insertion_workflow')).toBeTruthy()
  await expect(page.getByText('訂單編號').last()).toBeVisible()
  await expect(page.getByText('配送時段').last()).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, 'F3-08.png') })

  const urgentSummary = await send('新增急單 URG-TODO5-041，配送區域 Z4，城市臺北市，行政區信義，地點標示信義測試站，座標 25.033,121.565，上午配送，一件 2 公斤，高優先，請先預覽。')
  expect(urgentSummary.evidence?.some((item) => item.tool === 'urgent_insertion_workflow')).toBeTruthy()
  await expect(page.getByRole('button', { name: '產生插單預覽' })).toBeVisible({ timeout: 180_000 })
  const previewResponsePromise = page.waitForResponse((response) => response.url().includes('/api/v1/agent/chat'), { timeout: 180_000 })
  await page.getByRole('button', { name: '產生插單預覽' }).click()
  const previewResponse = await previewResponsePromise
  expect(previewResponse.status()).toBe(200)
  await expect(page.locator('.processing-bubble')).toHaveCount(0, { timeout: 180_000 })
  await expect(page.locator('[aria-label="臨時插單方案"]')).toHaveCount(1)

  const beforeModificationGroups = await page.locator('[aria-label="臨時插單方案"]').count()
  const prioritize = await send('用 A，但這單先送')
  expect(prioritize.evidence?.some((item) => item.tool === 'prioritize_order_preview')).toBeTruthy()
  await expect(page.locator('[aria-label="臨時插單方案"]')).toHaveCount(beforeModificationGroups + 1)
  await expect(page.getByText('新方案卡尚未套用')).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, 'F3-09.png') })

  const refused = await send('把所有單重新分配一遍')
  expect(refused.message).toContain('這個我不能改')
  await expect(page.getByText('這個我不能改').last()).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, 'F3-10.png') })

  await page.locator('button.urgent-card').last().click()
  await page.getByRole('button', { name: '取消', exact: true }).last().click()
  await expect(page.getByText('原方案版本沒有變更。').last()).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, 'F3-11.png') })

  const secondPrioritize = await send('用 A，但這單先送')
  expect(secondPrioritize.evidence?.some((item) => item.tool === 'prioritize_order_preview')).toBeTruthy()
  await page.locator('button.urgent-card').last().click()
  await page.getByRole('button', { name: '確認套用' }).last().click()
  await expect(page.getByText('已建立新版本。').last()).toBeVisible({ timeout: 180_000 })
  await expect(page.getByRole('status').filter({ hasText: '建立新版本' }).last()).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, 'F3-12.png') })

  const urgentVariants = [
    '加一張急單',
    '臨時多一張要送',
    '客戶剛剛下單，今天要到',
    '幫我插 ORD-041',
    '有張單漏掉了要補進去',
    '這張單忘記排',
    '來了一筆新的',
    'insert one more order',
  ]
  for (const message of urgentVariants) {
    const body = await send(message)
    expect(body.error).toBeUndefined()
    expect(body.evidence?.some((item) => item.tool === 'urgent_insertion_workflow')).toBeTruthy()
  }
  await page.screenshot({ path: path.join(screenshotDir, 'R-04.png') })

  const earlyDeliveryVariants = ['ORD-019 要提前', '客戶說中午前一定要拿到', '這單能不能早點送', '先送 ORD-019']
  for (const message of earlyDeliveryVariants) {
    const body = await send(message)
    expect(body.error).toBeUndefined()
    expect(body.message ?? '').not.toContain('AGENT_RUN_FAILED')
  }
  await page.screenshot({ path: path.join(screenshotDir, 'R-06.png') })

  const unknownChange = await send('這批貨的順序我想動一下')
  expect(unknownChange.error).toBeUndefined()
  expect(unknownChange.message ?? '').not.toContain('AGENT_RUN_FAILED')
  await expect(page.getByText('AGENT_RUN_FAILED')).toHaveCount(0)
  await page.screenshot({ path: path.join(screenshotDir, 'R-07.png') })

  expect(dispatchRequests).toBe(0)
  expect(googleRequests).toBe(0)
  expect(consoleErrors).toEqual([])
})
