import { test, expect } from '@playwright/test'
import path from 'node:path'

test('控制塔完整 Live 流程：Agent、Google Maps、插單與人工確認', async ({ page }) => {
  test.skip(!process.env.RUN_LIVE_FRONTEND_E2E, 'Set RUN_LIVE_FRONTEND_E2E=1 for the real provider gate')
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const screenshotDir = path.resolve('..', 'docs', 'screenshots')
  let dispatchRequests = 0
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/plans/') && request.url().endsWith('/dispatch')) dispatchRequests += 1
  })

  await page.goto('/')
  await page.screenshot({ path: path.join(screenshotDir, 'live-01-empty-chat.png') })
  await page.getByRole('button', { name: /看看你可以做什麼/ }).click()
  await expect(page.getByText(/可整理訂單、檢查欄位/)).toBeVisible({ timeout: 60_000 })

  await page.getByLabel('上傳 Excel').setInputFiles(path.resolve('..', 'data', 'samples', 'demo-delivery-40-orders.xlsx'))
  await expect(page.getByText(/已匯入 40 張訂單/)).toBeVisible({ timeout: 120_000 })
  await expect(page.getByText('Google Maps · 即時道路')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('Validator 通過')).toBeVisible({ timeout: 60_000 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: path.join(screenshotDir, 'live-02-google-map-plan.png') })

  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const send = async (message: string) => {
    const before = await page.locator('.chat-bubble.agent').count()
    await input.fill(message)
    await input.press('Enter')
    await expect.poll(() => page.locator('.chat-bubble.agent').count(), { timeout: 90_000 }).toBeGreaterThan(before)
  }
  await send('今天的配送方案怎麼分配？')
  await send('哪台車的載重最高？')
  await send('為什麼？')
  await send('ORD-032 為什麼給這台車？')
  await page.getByText('配送順序與理由').scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(screenshotDir, 'live-03-agent-evidence.png') })
  await send('預覽 ORD-041 插單')
  await send('只告訴我受影響的部分。')
  await page.getByRole('button', { name: 'ORD-041 插單差異' }).click()
  const previewMode = page.locator('.bottom-panel .success-box').filter({ hasText: /模式：MINIMAL_CHANGE|模式：FULL_REPLAN/ })
  await expect(previewMode).toBeVisible({ timeout: 90_000 })
  await previewMode.scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(screenshotDir, 'live-04-urgent-diff.png') })
  await send('好，我確認這個新方案。')
  await expect(page.getByRole('button', { name: '人工確認預覽' })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '人工確認預覽' }).click()
  await expect(page.getByText(/已確認方案版本/)).toBeVisible({ timeout: 60_000 })
  await expect.poll(() => dispatchRequests).toBe(0)
  await page.screenshot({ path: path.join(screenshotDir, 'live-05-human-confirmed.png') })

  await page.getByRole('button', { name: '配送任務' }).first().click()
  await expect(page.locator('h1').filter({ hasText: '配送任務' })).toBeVisible()
  await expect(page.getByRole('table')).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, 'live-06-delivery-tasks.png') })

  await page.getByRole('button', { name: '路線追蹤' }).first().click()
  await expect(page.locator('h1').filter({ hasText: '路線追蹤' })).toBeVisible()
  await expect(page.getByText('Google Maps · 即時道路')).toBeVisible()
  await page.getByRole('button', { name: /VEH-003/ }).last().click()
  await page.screenshot({ path: path.join(screenshotDir, 'live-07-route-tracking.png') })
})
