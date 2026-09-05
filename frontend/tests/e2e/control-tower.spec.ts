import { test, expect } from '@playwright/test'

test('控制塔顯示安全邊界並等待匯入', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '今日配送規劃' })).toBeVisible()
  await expect(page.getByText(/人工確認後才會套用/)).toBeVisible()
  await expect(page.getByText(/Validator|UNASSIGNABLE|Provider|Matrix/)).toHaveCount(0)
  await expect(page.getByLabel('上傳 Excel')).toBeAttached()
  await page.getByRole('button', { name: '附加訂單檔案' }).click()
  await expect(page.getByRole('link', { name: '下載範例格式' })).toHaveAttribute('href', '/demo-delivery-40-orders.xlsx')
})
