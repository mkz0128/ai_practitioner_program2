import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

test('第二組隨機資料可在瀏覽器一次匯入並完成多筆插單驗收', async ({ page }) => {
  test.skip(!process.env.RUN_RANDOM_FRONTEND_E2E, 'Set RUN_RANDOM_FRONTEND_E2E=1 for the real Agent browser gate')
  test.setTimeout(300_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const workbook = path.resolve('..', 'data', 'samples', 'random-dispatch-seed-260904.xlsx')
  const screenshotDir = path.resolve('..', 'docs', 'screenshots')
  const dispatchRequests: string[] = []
  const consoleErrors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/plans/') && request.url().endsWith('/dispatch')) dispatchRequests.push(request.url())
  })
  // Keep this second-data browser run keyless for Google cost control; the
  // existing live gate covers one representative Google Matrix flow.
  await page.route('**/api/v1/plans', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const body = JSON.parse(route.request().postData() || '{}') as Record<string, unknown>
    await route.continue({ postData: JSON.stringify({ ...body, route_provider_preference: 'SIMULATED', traffic_mode: 'SIMULATED' }) })
  })
  await page.goto('/')
  await page.locator('.agent-panel').evaluate((element) => {
    element.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
  })
  const bytes = Array.from(fs.readFileSync(workbook))
  await page.locator('.agent-panel').evaluate((element, payload) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array(payload.bytes)], payload.name, { type: payload.type }))
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  }, { bytes, name: path.basename(workbook), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  await expect(page.getByRole('status')).toContainText('random-dispatch-seed-260904.xlsx')
  await page.screenshot({ path: path.join(screenshotDir, 'random-01-attached.png') })
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  await input.fill('請匯入這份訂單並建立今天的配送方案')
  await input.press('Enter')
  await expect(page.locator('.processing-bubble')).toHaveCount(0, { timeout: 180_000 })
  await expect(page.getByText(/已匯入 40 張訂單/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Validator 通過')).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: path.join(screenshotDir, 'random-02-base-plan.png') })

  // The API keeps immutable plans for the lifetime of the local server. Use a
  // per-run suffix so a second audit run cannot collide with an earlier
  // accepted temporary order while preserving the same structured scenarios.
  const runSuffix = Date.now().toString().slice(-6)

  const sendAndWait = async (message: string) => {
    await input.fill(message)
    await input.press('Enter')
    await expect(page.locator('.processing-bubble')).toHaveCount(0, { timeout: 120_000 })
  }
  const confirmPreview = async () => {
    await page.getByRole('button', { name: '臨時插單差異' }).click()
    await expect(page.locator('.bottom-panel .success-box').filter({ hasText: /最小變動插入|完整重新排程/ })).toBeVisible({ timeout: 30_000 })
    const confirm = page.getByRole('button', { name: '人工確認預覽' })
    if (await confirm.count()) {
      await confirm.click()
      await expect(page.getByText('此方案已由調度員確認。')).toBeVisible({ timeout: 60_000 })
    }
  }
  await sendAndWait(`預覽臨時訂單 TMP-RND-${runSuffix}-001：Z4、臺北市信義、信義臨時站、座標 25.033,121.565、PM、1 件、1 公斤、NORMAL；package_id=TPK-RND-${runSuffix}-001、order_id=TMP-RND-${runSuffix}-001、weight_kg=1`)
  await confirmPreview()
  await page.screenshot({ path: path.join(screenshotDir, 'random-03-insert-1.png') })
  await sendAndWait(`預覽臨時訂單 TMP-RND-${runSuffix}-002：Z4、臺北市信義、信義臨時站二號、座標 25.034,121.566、AM、1 件、1.2 公斤、HIGH；package_id=TPK-RND-${runSuffix}-002、order_id=TMP-RND-${runSuffix}-002、weight_kg=1.2`)
  await confirmPreview()
  await page.screenshot({ path: path.join(screenshotDir, 'random-04-insert-2.png') })
  await sendAndWait(`預覽臨時訂單 TMP-RND-${runSuffix}-003：Z4、臺北市信義、容量測試站、座標 25.035,121.567、PM、1 件、5 公斤、HIGH；package_id=TPK-RND-${runSuffix}-003、order_id=TMP-RND-${runSuffix}-003、weight_kg=5`)
  await confirmPreview()
  await page.screenshot({ path: path.join(screenshotDir, 'random-05-final-plan.png') })

  await page.reload()
  await expect(page.getByText('Validator 通過')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByLabel('配送任務')).toBeVisible()
  await expect(dispatchRequests).toHaveLength(0)
  await expect(consoleErrors).toEqual([])
})

test('純附件送出會使用預設匯入意圖', async ({ page }) => {
  test.skip(!process.env.RUN_RANDOM_FRONTEND_E2E, 'Set RUN_RANDOM_FRONTEND_E2E=1 for the real Agent browser gate')
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const workbook = path.resolve('..', 'data', 'samples', 'random-dispatch-seed-260904.xlsx')
  const screenshotDir = path.resolve('..', 'docs', 'screenshots')
  const consoleErrors: string[] = []
  let importRequests = 0
  let dispatchRequests = 0
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/datasets/import-excel')) importRequests += 1
    if (request.url().includes('/api/v1/plans/') && request.url().endsWith('/dispatch')) dispatchRequests += 1
  })
  await page.route('**/api/v1/plans', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const body = JSON.parse(route.request().postData() || '{}') as Record<string, unknown>
    await route.continue({ postData: JSON.stringify({ ...body, route_provider_preference: 'SIMULATED', traffic_mode: 'SIMULATED' }) })
  })
  await page.goto('/')
  const bytes = Array.from(fs.readFileSync(workbook))
  await page.locator('.agent-panel').evaluate((element, payload) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array(payload.bytes)], payload.name, { type: payload.type }))
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  }, { bytes, name: path.basename(workbook), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  await expect(page.getByRole('status')).toContainText('random-dispatch-seed-260904.xlsx')
  await page.getByRole('button', { name: '送出' }).click()
  await expect(page.locator('.processing-bubble')).toHaveCount(0, { timeout: 120_000 })
  await expect(page.getByText(/已匯入 40 張訂單/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Validator 通過')).toBeVisible({ timeout: 30_000 })
  const userBubble = page.locator('.chat-bubble.user').last()
  await expect(userBubble).toContainText('請匯入並檢查這份配送資料')
  await expect(userBubble.locator('.message-attachment')).toContainText('random-dispatch-seed-260904.xlsx')
  await expect.poll(() => importRequests).toBe(1)
  await expect(dispatchRequests).toBe(0)
  await page.screenshot({ path: path.join(screenshotDir, 'random-06-attachment-only.png') })
  await expect(consoleErrors).toEqual([])
})
