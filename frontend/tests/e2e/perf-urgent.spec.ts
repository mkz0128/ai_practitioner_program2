import { expect, test } from '@playwright/test'
import path from 'node:path'

const relaxedWorkbook = path.resolve('..', 'data', 'samples', 'demo-50-relaxed.xlsx')

type AgentBody = { evidence?: Array<{ tool: string; data: Record<string, unknown> }>; message?: string }

test('PERF-1 baseline：1／3／10 張急單分別量測理解與預覽', async ({ page }) => {
  test.setTimeout(1_800_000)
  await page.setViewportSize({ width: 1440, height: 900 })

  // 用 demo 現場那種一行一張的簡表。整段寫成完整欄位的句子會走到
  // preview_multiple_urgent_insert，那條路沒有【產生插單預覽】這一步，
  // 量不到這支要量的「理解 → 預覽」兩段時間。
  const ordersFor = (count: number) => Array.from({ length: count }, (_, index) => {
    const orderId = `PERF-${String(index + 1).padStart(3, '0')}`
    return `${orderId} 25.033/121.565 Z3 1公斤 1件 早上`
  }).join('\n')

  const send = async (message: string): Promise<{ body: AgentBody; seconds: number }> => {
    const input = page.getByRole('textbox', { name: '輸入訊息' })
    const responsePromise = page.waitForResponse((response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST', { timeout: 300_000 })
    const started = Date.now()
    await input.click()
    // 對話框的 Enter 就是送出，多行要用 Shift+Enter 換行，
    // 不然第一行就先送出去了。
    const lines = message.split('\n')
    await input.pressSequentially(lines[0] || '')
    for (const line of lines.slice(1)) {
      await input.press('Shift+Enter')
      await input.pressSequentially(line)
    }
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
    // 選檔案只是附加，要按【送出】才會上傳排班。
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.getByLabel('配送地圖', { exact: true })).toBeVisible({ timeout: 180_000 })

    // 只貼資料，不要在前面加「請一次新增 N 張急單」。那句話會被當成
    // 「使用者在描述多張急單」而走到 preview_multiple_urgent_insert，
    // 那條路沒有【產生插單預覽】這一步，量不到這支要量的兩段時間。
    const summary = await send(ordersFor(count))
    const usedWorkflow = summary.body.evidence?.some((item) => item.tool === 'urgent_insertion_workflow')
    const usedBatchSolver = summary.body.evidence?.some((item) => item.tool === 'preview_multiple_urgent_insert')
    expect(usedWorkflow || usedBatchSolver, `系統實際回覆：${summary.body.message}`).toBeTruthy()

    // 張數多的時候系統會直接一次算完（preview_multiple_urgent_insert），
    // 沒有【產生插單預覽】那一步。那條路的理解與預覽本來就是同一次往返，
    // 量到的就是那一個數字。
    if (!usedWorkflow) {
      console.log(`PERF-1 baseline ${count} 張：一次算完 ${summary.seconds.toFixed(3)} 秒`)
      continue
    }
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
