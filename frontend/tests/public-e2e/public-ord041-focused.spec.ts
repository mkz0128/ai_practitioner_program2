import { expect, test } from '@playwright/test'
import path from 'node:path'

const workbook = path.resolve('..', 'data', 'samples', 'demo-delivery-40-orders.xlsx')

test('公開站建立正式方案後可由 Agent 預覽 ORD-041', async ({ page }) => {
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

  const incidentResponsePromise = page.waitForResponse((item) => item.url().includes('/api/v1/agent/chat') && item.request().method() === 'POST')
  await input.fill('三號車今天不能出車，其他車先幫忙重新安排，但不要直接套用。')
  await input.press('Enter')
  const incidentResponse = await incidentResponsePromise
  const incidentBody = await incidentResponse.json() as { runner_result_type?: string; evidence?: Array<{ tool?: string }>; error?: { code?: string } }
  expect(incidentResponse.status(), incidentBody.error?.code ?? 'UNKNOWN_AGENT_ERROR').toBe(200)
  expect(incidentBody.runner_result_type).toBe('RunResult')
  expect(incidentBody.evidence?.some((item) => item.tool === 'change_vehicle_availability')).toBeTruthy()

  const responsePromise = page.waitForResponse((item) => item.url().includes('/api/v1/agent/chat') && item.request().method() === 'POST')
  await input.fill('幫我插入 ORD-041。')
  await input.press('Enter')
  const response = await responsePromise
  const body = await response.json() as { runner_result_type?: string; evidence?: Array<{ tool?: string; data?: { stage?: string } }> ; error?: { code?: string } }
  expect(response.status(), body.error?.code ?? 'UNKNOWN_AGENT_ERROR').toBe(200)
  expect(body.runner_result_type).toBe('RunResult')
  expect(body.evidence?.find((item) => item.tool === 'urgent_insertion_workflow')?.data?.stage).toBe('REVIEW_READY')
  const previewPromise = page.waitForResponse((item) => item.url().includes('/api/v1/agent/chat') && item.request().method() === 'POST')
  await page.getByRole('button', { name: '產生插單預覽' }).click()
  const preview = await previewPromise
  const previewBody = await preview.json() as { evidence?: Array<{ tool?: string; data?: { stage?: string } }> }
  expect(preview.status()).toBe(200)
  expect(previewBody.evidence?.find((item) => item.tool === 'urgent_insertion_workflow')?.data?.stage).toBe('PREVIEW_READY')
  await expect(page.getByText('局部變更預覽')).toBeVisible({ timeout: 180_000 })
})
