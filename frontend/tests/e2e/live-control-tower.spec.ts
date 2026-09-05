import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

test('AI 調度：附件與文字一次送出並完成 Live 排程', async ({ page }) => {
  test.skip(!process.env.RUN_LIVE_FRONTEND_E2E, 'Set RUN_LIVE_FRONTEND_E2E=1 for the real provider gate')
  test.setTimeout(300_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const screenshotDir = path.resolve('..', 'docs', 'screenshots')
  const workbook = path.resolve('..', 'data', 'samples', 'demo-delivery-40-orders.xlsx')
  let importRequests = 0
  let agentRequests = 0
  let dispatchRequests = 0
  const browserErrors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()) })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/datasets/import-excel')) importRequests += 1
    if (request.url().includes('/api/v1/agent/chat')) agentRequests += 1
    if (request.url().includes('/api/v1/plans/') && request.url().endsWith('/dispatch')) dispatchRequests += 1
  })

  await page.goto('/')
  await page.screenshot({ path: path.join(screenshotDir, 'chat-composer-empty.png') })
  await expect(page.getByText('今天想先處理什麼？')).toBeVisible()

  const input = page.getByRole('textbox', { name: '輸入訊息' })
  await input.fill('你可以做什麼？')
  await input.press('Enter')
  await expect(page.locator('.processing-bubble')).toHaveCount(0, { timeout: 90_000 })
  await expect(page.locator('.chat-bubble.agent').last()).toContainText(/訂單|資料|協助/, { timeout: 30_000 })

  // Verify invalid format is explained in the conversation, then recover.
  await page.getByLabel('上傳 Excel').setInputFiles({ name: 'orders.csv', mimeType: 'text/csv', buffer: Buffer.from('not an xlsx') })
  await expect(page.getByText(/只接受 \.xlsx|不支援/)).toBeVisible()
  await expect(page.getByRole('status')).toHaveCount(0)

  // Start the attachment screenshot from a clean conversation after the
  // invalid-format recovery check.
  await page.reload()

  // Dispatch a real browser drop event with the sample workbook.
  const bytes = Array.from(fs.readFileSync(workbook))
  await page.locator('.agent-panel').evaluate((element) => {
    element.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
  })
  await expect(page.getByText('放開以上傳 Excel')).toBeVisible()
  await page.locator('.agent-panel').evaluate((element, payload) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array(payload.bytes)], payload.name, { type: payload.type }))
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  }, { bytes, name: path.basename(workbook), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  await expect(page.getByRole('status')).toContainText('demo-delivery-40-orders.xlsx')
  await page.screenshot({ path: path.join(screenshotDir, 'chat-composer-attached.png') })

  // Remove and re-attach before the one-and-only planning submit.
  await page.getByRole('button', { name: /移除附件/ }).click()
  await expect(page.getByRole('status')).toHaveCount(0)
  await page.getByLabel('上傳 Excel').setInputFiles(workbook)
  await expect(page.getByRole('status')).toContainText('demo-delivery-40-orders.xlsx')

  // Shift+Enter stays in the same composer; Enter performs the single submit.
  await input.fill('請用這份資料建立今天的配送方案')
  await input.press('Shift+Enter')
  await input.type('請保留時段限制')
  await expect(input).toHaveValue('請用這份資料建立今天的配送方案\n請保留時段限制')
  await input.fill('請用這份資料建立今天的配送方案')
  await input.press('Enter')
  await expect(page.locator('.processing-bubble')).toHaveCount(0, { timeout: 180_000 })
  await expect.poll(() => importRequests, { timeout: 30_000 }).toBe(1)
  await expect.poll(() => agentRequests, { timeout: 30_000 }).toBe(2)
  await expect(page.getByText(/已匯入 40 張訂單/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('即時道路地圖')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('方案檢查通過').first()).toBeVisible({ timeout: 30_000 })
  const submittedBubble = page.locator('.chat-bubble.user').filter({ hasText: '請用這份資料建立今天的配送方案' })
  await expect(submittedBubble).toHaveCount(1)
  await expect(submittedBubble.locator('.message-attachment')).toContainText('demo-delivery-40-orders.xlsx')
  await expect(page.locator('.agent-progress').last()).toContainText(/正在讀取訂單|資料驗證完成|正在規劃配送|方案已建立/)
  await page.screenshot({ path: path.join(screenshotDir, 'chat-composer-completed.png') })

  const send = async (message: string) => {
    await input.fill(message)
    await input.press('Enter')
    await expect(page.locator('.processing-bubble')).toHaveCount(0, { timeout: 90_000 })
  }
  await send('哪台車的載重最高？')
  await expect(page.locator('.chat-bubble.agent').last()).toContainText(/載重最高|VEH-00/, { timeout: 30_000 })
  await send('為什麼 ORD-020 分給這台車？')
  await expect(page.locator('.chat-bubble.agent').last()).toContainText(/說明|車輛|時段|證據/, { timeout: 30_000 })

  await send('預覽 ORD-041 插單')
  await send('只告訴我受影響的部分。')
  await page.getByRole('button', { name: '臨時插單差異' }).click()
  const previewMode = page.locator('.bottom-panel .success-box').filter({ hasText: /最小變動插入|完整重新排程/ })
  await expect(previewMode).toBeVisible({ timeout: 60_000 })
  await expect(previewMode).toContainText(/影響 1 台車|換車 0 張/)
  await page.screenshot({ path: path.join(screenshotDir, 'chat-composer-urgent-diff.png') })

  await send('好，我確認這個新方案。')
  await expect(page.getByRole('button', { name: '套用變更' })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '套用變更' }).click()
  await expect(page.getByText(/已確認方案版本/)).toBeVisible({ timeout: 60_000 })
  await expect.poll(() => dispatchRequests).toBe(0)

  // Exercise the stop control against a real Agent request.  The route is only
  // delayed to make the cancellation window deterministic; no response is
  // fabricated and the request is aborted by the UI.
  await page.route('**/api/v1/agent/chat', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 5_000))
    try { await route.continue() } catch { /* request was intentionally aborted */ }
  })
  await input.fill('請再說明目前的配送方案')
  await input.press('Enter')
  await expect(page.getByRole('button', { name: '停止' })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: '停止' }).click()
  await expect(page.locator('.chat-bubble.agent').last()).toContainText('已停止這次處理', { timeout: 15_000 })
  await page.unroute('**/api/v1/agent/chat')
  await expect(browserErrors).toEqual([])
})
