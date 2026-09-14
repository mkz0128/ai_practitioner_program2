import { expect, test } from '@playwright/test'
import path from 'node:path'

const relaxedWorkbook = path.resolve('..', 'data', 'samples', 'demo-50-relaxed.xlsx')
const missingWorkbook = path.resolve('..', 'data', 'samples', 'demo-missing-fields.xlsx')

test('NIT-4：任何主要畫面狀態都沒有裝飾性英文小標', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '配送調度控制塔' })).toBeVisible()
  await expect(page.locator('[class~="uppercase"][class~="tracking-wider"]')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('Column mapping')
  await expect(page.locator('body')).not.toContainText('Selected order')

  await page.getByLabel('上傳 Excel').setInputFiles(relaxedWorkbook)
  await expect(page.getByLabel('配送地圖', { exact: true })).toBeVisible({ timeout: 180_000 })
  await expect(page.locator('[class~="uppercase"][class~="tracking-wider"]')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('Column mapping')
  await expect(page.locator('body')).not.toContainText('Selected order')
})

test('NIT-6：模擬網路層失敗顯示中文失敗訊息，不假裝成功', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/v1/agent/chat', (route) => route.abort('failed'))
  await page.goto('/')
  await page.getByLabel('上傳 Excel').setInputFiles(relaxedWorkbook)
  await expect(page.getByLabel('配送地圖', { exact: true })).toBeVisible({ timeout: 180_000 })
  await page.getByRole('textbox', { name: '輸入訊息' }).fill('今天調度狀況如何')
  await page.getByRole('button', { name: '送出' }).click()
  const assistant = page.locator('.chat-log').getByText('連線失敗：目前連不上後端服務，請稍後再試。')
  await expect(assistant).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.chat-log')).not.toContainText('Failed to fetch')
  await expect(page.locator('.chat-log')).not.toContainText('TypeError')
  await expect(page.locator('.chat-log')).not.toContainText('stack')
})

test('NIT-5：匯入缺欄報告使用中文欄位名', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByLabel('上傳 Excel').setInputFiles(missingWorkbook)
  const missingAlert = page.getByRole('alert')
  await expect(missingAlert).toContainText('ORD-001')
  await expect(missingAlert).toContainText('ORD-002')
  await expect(missingAlert).toContainText('PKG-003-01')
  await expect(missingAlert).toContainText('地點名稱')
  await expect(missingAlert).toContainText('配送時段')
  await expect(missingAlert).toContainText('重量')
  for (const machineField of ['location_label', 'time_slot', 'weight_kg']) {
    await expect(missingAlert).not.toContainText(machineField)
  }
})
