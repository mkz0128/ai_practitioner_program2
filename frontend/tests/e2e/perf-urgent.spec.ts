import { expect, test } from '@playwright/test'
import path from 'node:path'

const relaxedWorkbook = path.resolve('..', 'data', 'samples', 'demo-50-relaxed.xlsx')

type AgentBody = { evidence?: Array<{ tool: string; data: Record<string, unknown> }>; message?: string }

test('PERF-1 baseline：1／3／10 張急單分別量測理解與預覽', async ({ page }) => {
  test.setTimeout(1_800_000)
  await page.setViewportSize({ width: 1440, height: 900 })

  const ordersFor = (count: number) => Array.from({ length: count }, (_, index) => {
    const orderId = `PERF-${String(index + 1).padStart(3, '0')}`
    return `訂單編號 ${orderId}，配送區域 Z4，城市臺北市，行政區信義，地點標示信義效能測試站 ${orderId}，緯度 25.033，經度 121.565，包裹件數 1，每件重量 1 公斤，早上配送`
  }).join('；')

  const send = async (message: string): Promise<{ body: AgentBody; seconds: number }> => {
    const input = page.getByRole('textbox', { name: '輸入訊息' })
    const responsePromise = page.waitForResponse((response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST', { timeout: 300_000 })
    const started = Date.now()
    await input.click()
    await input.pressSequentially(message)
    await expect(input).toHaveValue(message)
    await input.press('Enter')
    const response = await responsePromise
    const raw = await response.text()
    expect(response.ok(), raw).toBeTruthy()
    return { body: JSON.parse(raw) as AgentBody, seconds: (Date.now() - started) / 1000 }
  }

  for (const count of [1, 3, 10]) {
    await page.goto('/')
    await page.getByLabel('上傳 Excel').setInputFiles(relaxedWorkbook)
    await expect(page.getByLabel('配送地圖', { exact: true })).toBeVisible({ timeout: 180_000 })

    const summary = await send(`請一次新增${count}張急單：${ordersFor(count)}。`)
    expect(summary.body.evidence?.some((item) => item.tool === 'urgent_insertion_workflow')).toBeTruthy()

    const previewButton = page.getByRole('button', { name: '產生插單預覽' }).last()
    await expect(previewButton).toBeVisible({ timeout: 30_000 })
    const previewResponse = page.waitForResponse((response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST', { timeout: 300_000 })
    const previewStarted = Date.now()
    await previewButton.click()
    const response = await previewResponse
    const raw = await response.text()
    expect(response.ok(), raw).toBeTruthy()
    const preview = JSON.parse(raw) as AgentBody
    expect(preview.evidence?.some((item) => item.tool === 'urgent_insertion_workflow')).toBeTruthy()
    console.log(`PERF-1 baseline ${count} 張：理解 ${summary.seconds.toFixed(3)} 秒；預覽 ${((Date.now() - previewStarted) / 1000).toFixed(3)} 秒`)
  }
})
