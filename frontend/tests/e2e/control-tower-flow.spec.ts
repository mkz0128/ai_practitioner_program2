import { test, expect } from '@playwright/test'
import path from 'node:path'

test('控制塔 local simulated flow 可展示主要交付畫面', async ({ page }) => {
  test.setTimeout(180_000)
  const screenshotDir = path.resolve('..', 'docs', 'screenshots')
  await page.goto('/')
  await expect(page.getByText('AI 配送調度中心')).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, '01-empty-control-tower.png'), fullPage: true })

  // 讓截圖測試保持 keyless、可重現；正式 UI 預設仍送 AUTO 以啟用 Google strict path。
  await page.route('**/api/v1/plans', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const payload = JSON.parse(route.request().postData() || '{}') as Record<string, unknown>
    await route.continue({ postData: JSON.stringify({ ...payload, route_provider_preference: 'SIMULATED', traffic_mode: 'SIMULATED' }) })
  })
  await page.getByLabel('上傳 Excel').setInputFiles(path.resolve('..', 'data', 'samples', 'demo-delivery-40-orders.xlsx'))
  await expect(page.getByRole('status')).toContainText('demo-delivery-40-orders.xlsx')
  await page.getByRole('textbox', { name: '輸入訊息' }).fill('請用這份資料建立今天的配送方案')
  await page.getByRole('textbox', { name: '輸入訊息' }).press('Enter')
  await expect(page.getByText(/已匯入 40 張訂單/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Validator 通過')).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: path.join(screenshotDir, '02-imported-plan.png'), fullPage: true })
  await page.screenshot({ path: path.join(screenshotDir, '03-map-and-vehicles.png'), fullPage: true })

  await page.getByRole('textbox', { name: '輸入訊息' }).fill('哪台車的載重最高？')
  await page.getByRole('textbox', { name: '輸入訊息' }).press('Enter')
  await expect(page.locator('.chat-bubble.agent').last()).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: path.join(screenshotDir, '04-agent-blocked.png'), fullPage: true })

  await page.getByRole('textbox', { name: '輸入訊息' }).fill('預覽 ORD-041 插單')
  await page.getByRole('textbox', { name: '輸入訊息' }).press('Enter')
  await expect(page.getByText(/臨時插單差異/)).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '臨時插單差異' }).click()
  await expect(page.getByText(/最小變動插入|完整重新排程/)).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: path.join(screenshotDir, '05-urgent-preview.png'), fullPage: true })
  await expect(page.getByRole('button', { name: '人工確認預覽' })).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, '06-human-confirmation.png'), fullPage: true })
})
