import { expect, test } from '@playwright/test'
import path from 'node:path'

const workbook = path.resolve('..', 'data', 'samples', 'demo-delivery-40-orders.xlsx')

test('公開站通用超重插單證據會顯示且禁止套用', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => window.localStorage.clear())
  await expect.poll(async () => {
    const response = await page.request.get('/health', { timeout: 120_000 })
    return response.ok() && (response.headers()['content-type'] ?? '').includes('application/json')
  }, { timeout: 300_000, intervals: [2_000, 5_000, 10_000] }).toBe(true)
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: '附加訂單檔案' }).click()
  await page.getByLabel('上傳 Excel').setInputFiles(workbook)
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const planResponsePromise = page.waitForResponse((item) => item.url().includes('/api/v1/agent/chat') && item.request().method() === 'POST')
  await input.fill('請用這份資料建立今天的配送方案')
  await input.press('Enter')
  const planResponse = await planResponsePromise
  const planBody = await planResponse.json() as { error?: { code?: string; details?: { exception_type?: string } } }
  expect(
    planResponse.status(),
    `${planBody.error?.code ?? 'UNKNOWN_AGENT_ERROR'}:${planBody.error?.details?.exception_type ?? 'UNKNOWN_EXCEPTION'}`,
  ).toBe(200)
  await expect(page.getByText('40／40', { exact: true })).toBeVisible({ timeout: 300_000 })

  const responsePromise = page.waitForResponse((item) => item.url().includes('/api/v1/agent/chat') && item.request().method() === 'POST')
  await input.fill('新增急單 ORD-OVER-901，配送區域 Z1，城市是新北市，行政區填板橋，地點標示超重測試點，座標 25.0114,121.4618，上午配送，共 3 件包裹、每件 50 公斤；包裹編號 PKG-OVER-901-A、PKG-OVER-901-B、PKG-OVER-901-C 都屬於 ORD-OVER-901，高優先，請只預覽不要套用。')
  await input.press('Enter')
  const response = await responsePromise
  const body = await response.json() as { evidence?: Array<{ tool?: string; data?: { stage?: string } }> }
  expect(response.status()).toBe(200)
  expect(body.evidence?.find((item) => item.tool === 'urgent_insertion_workflow')?.data?.stage).toBe('REVIEW_READY')
  const previewPromise = page.waitForResponse((item) => item.url().includes('/api/v1/agent/chat') && item.request().method() === 'POST')
  await page.getByRole('button', { name: '產生插單預覽' }).click()
  const preview = await previewPromise
  const previewBody = await preview.json() as { error?: { code?: string } }
  expect(preview.status()).toBe(409)
  expect(previewBody.error?.code).toBe('URGENT_INSERT_UNASSIGNABLE')
  await expect(page.locator('.chat-bubble.agent').last()).toContainText(/無法合法安排|原方案未變更/)
  await expect(page.getByRole('button', { name: '套用變更' })).toHaveCount(0)
})
