import { test, expect } from '@playwright/test'

test('控制塔顯示安全邊界並等待匯入', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('AI 配送調度中心')).toBeVisible()
  await expect(page.getByText(/不提供自動 Dispatch/)).toBeVisible()
  await expect(page.getByLabel('上傳 Excel')).toBeVisible()
})
