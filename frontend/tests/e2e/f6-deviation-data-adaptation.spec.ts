import path from 'node:path'

import { expect, test } from '@playwright/test'

const samples = [
  path.resolve('..', 'data', 'samples', 'demo-50-tight.xlsx'),
  path.resolve('..', 'data', 'samples', 'demo-delivery-40-orders.xlsx'),
]
const screenshotDir = path.resolve('..', 'docs', 'screenshots')

test('F6：偏差車輛與區域會隨輸入資料計算', async ({ page }) => {
  test.setTimeout(360_000)
  const vehicleMessages: string[] = []
  const zoneMessages: string[] = []

  for (const [index, workbook] of samples.entries()) {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await page.getByLabel('上傳 Excel').first().setInputFiles(workbook)
    // 選檔案只是附加，要按【送出】才會上傳排班。
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.locator('.topbar-stats')).toContainText('已安排', { timeout: 180_000 })
    await page.getByRole('button', { name: '開始裝車' }).click()
    await page.getByRole('button', { name: '模擬出發' }).click()
    const timeline = page.getByRole('slider', { name: '配送時間軸' })
    await expect(timeline).toBeVisible({ timeout: 30_000 })
    await timeline.fill('80')

    const panel = page.getByLabel('配送偏差與參數建議')
    await expect(panel).toBeVisible({ timeout: 30_000 })
    await panel.scrollIntoViewIfNeeded()
    await expect(panel).toBeInViewport()
    const paragraphs = await panel.locator('p').allInnerTexts()
    const vehicleMessage = paragraphs.find((text) => text.includes('實際比預估慢'))
    // 區域偏差改成人話了：「東區（Z2）每一站平均多停 6 分鐘」。
    const zoneMessage = paragraphs.find((text) => text.includes('每一站平均多停'))
    expect(vehicleMessage, `偏差車輛沒有畫面訊息：${paragraphs.join('｜')}`).toBeTruthy()
    expect(zoneMessage, `偏差區域沒有畫面訊息：${paragraphs.join('｜')}`).toBeTruthy()
    vehicleMessages.push(vehicleMessage || '')
    zoneMessages.push(zoneMessage || '')
    await page.screenshot({
      path: path.join(screenshotDir, `f6-deviation-${index === 0 ? 'tight' : '40'}.png`),
      fullPage: true,
    })
  }

  expect(new Set(vehicleMessages).size).toBe(2)
  expect(new Set(zoneMessages).size).toBe(2)
})
