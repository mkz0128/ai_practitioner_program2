import { expect, test } from '@playwright/test'
import path from 'node:path'

const screenshotDir = path.resolve('..', 'docs', 'screenshots')
const workbook = path.resolve('..', 'data', 'samples', 'demo-taipei-50.xlsx')
const PLANNED = /已完成 \d+／50 張訂單的排班/

async function loadAndPlan(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.getByText('先放入今天的訂單', { exact: true })).toBeVisible({ timeout: 60_000 })
  await page.getByLabel('上傳 Excel').last().setInputFiles(workbook)
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  await input.click()
  await input.pressSequentially('請幫我排今天的班')
  await expect(input).toHaveValue('請幫我排今天的班')
  await input.press('Enter')
  await expect(page.getByText('● 正在執行：每日排班', { exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(PLANNED)).toBeVisible({ timeout: 180_000 })
}

test.describe('D／E 控制塔畫面驗收', () => {
  test('D：手動上傳、四車看板與同車站序後端預覽', async ({ page }) => {
    test.setTimeout(240_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await loadAndPlan(page)
    await expect(page.getByRole('heading', { name: '配送調度控制塔' })).toBeVisible()
    await expect(page.getByText('下載範例格式')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '示範一張急單' })).toHaveCount(0)
    await page.screenshot({ path: path.join(screenshotDir, 'd-auto-loaded.png'), fullPage: true })

    const board = page.getByRole('list', { name: '四台車訂單看板' })
    await expect(board).toBeVisible()
    await expect(board.getByRole('region')).toHaveCount(4)
    await page.screenshot({ path: path.join(screenshotDir, 'd-order-sorted.png'), fullPage: true })

    const vehicleColumn = page.getByRole('region', { name: 'VEH-001 訂單欄' })
    const vehicleStops = vehicleColumn.locator('.order-board-stop')
    await vehicleStops.first().dragTo(vehicleStops.nth(2))
    await expect(page.getByRole('status', { name: '站序預覽結果' })).toBeVisible({ timeout: 30_000 })
    await page.screenshot({ path: path.join(screenshotDir, 'd-route-preview.png'), fullPage: true })
  })

  test('E：鍵盤送出後持續顯示真實等待階段', async ({ page }) => {
    test.setTimeout(240_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await loadAndPlan(page)

    const input = page.getByRole('textbox', { name: '輸入訊息' })
    const message = '請分析目前四台車的配送方案、每台車的載重與路線，並說明有哪些需要調度員確認的地方'
    await input.click()
    await input.pressSequentially(message)
    await expect(input).toHaveValue(message)
    await input.press('Enter')

    const assistant = page.locator('.chat-log > div.mr-auto').last()
    await expect(assistant).toContainText(/理解你的需求|呼叫工具計算|整理結果|這題比較久|連線失敗|AI 服務/, { timeout: 5_000 })
    await page.screenshot({ path: path.join(screenshotDir, 'e-thinking-1.png'), fullPage: true })
    await page.waitForTimeout(1_500)
    await expect(assistant).toContainText(/理解你的需求|呼叫工具計算|這題比較久，仍在計算/)
    await page.screenshot({ path: path.join(screenshotDir, 'e-thinking-2.png'), fullPage: true })
    await page.waitForTimeout(8_000)
    await expect(assistant).toContainText(/理解你的需求|呼叫工具計算|整理結果|這題比較久，仍在計算|調度助理/)
    await page.screenshot({ path: path.join(screenshotDir, 'e-thinking-3.png'), fullPage: true })
  })
})
