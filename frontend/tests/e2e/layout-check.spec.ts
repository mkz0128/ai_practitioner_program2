import { expect, test } from '@playwright/test'
import path from 'node:path'

// 版面調整用的看圖測試：上傳一份資料，把新版面拍下來。
// 不放驗收條件，驗收在 layout-v2-e-f1-acceptance.spec.ts。
const workbook = path.resolve('..', 'data', 'samples', 'demo-50-tight.xlsx')
const outDir = path.resolve('..', 'docs', 'screenshots')

test('版面檢視：上排、對話框與車輛概況', async ({ page }) => {
  test.setTimeout(300_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByLabel('上傳 Excel').setInputFiles(workbook)
  await page.getByRole('button', { name: '送出', exact: true }).click()
  await expect(page.locator('.topbar-stats')).toContainText('已安排', { timeout: 240_000 })
  await expect(page.getByLabel('配送地圖', { exact: true })).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: path.join(outDir, 'LAYOUT-1-stage.png') })
  await page.locator('[aria-label="訂單看板"]').scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(outDir, 'LAYOUT-2-vehicle-board.png') })
  await page.screenshot({ path: path.join(outDir, 'LAYOUT-3-full.png'), fullPage: true })
})
