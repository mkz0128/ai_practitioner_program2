import { expect, test } from '@playwright/test'
import path from 'node:path'

const screenshotDir = path.resolve('..', 'docs', 'screenshots')
/**
 * 不要寫死 50／50。預設範例已改成 demo-50-tight（49／50），
 * 因為 relaxed 的 VEH-003 沒有超過 20 kg 的單，demo 第 2 幕會變成「影響 0 張」。
 * 這裡要驗的是「開場不用上傳就自動排完」，不是某一份資料的張數。
 */
const PLANNED = /已完成 \d+／50 張訂單的排班/

test.describe('D／E 控制塔畫面驗收', () => {
  test('D：自動開場、排序與同車站序後端預覽', async ({ page }) => {
    test.setTimeout(240_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await expect(page.getByText(PLANNED)).toBeVisible({ timeout: 180_000 })
    await expect(page.getByRole('heading', { name: '配送調度控制塔' })).toBeVisible()
    await expect(page.getByText('下載範例格式')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '示範一張急單' })).toHaveCount(0)
    await page.screenshot({ path: path.join(screenshotDir, 'd-auto-loaded.png'), fullPage: true })

    const orderHeader = page.getByRole('button', { name: '訂單（可排序）' })
    await orderHeader.click()
    const sortedOrderHeader = page.getByRole('button', { name: '訂單（升序）' })
    await expect(sortedOrderHeader).toHaveAttribute('aria-label', '訂單（升序）')
    await page.screenshot({ path: path.join(screenshotDir, 'd-order-sorted.png'), fullPage: true })

    const vehicleRows = page.locator('tbody tr').filter({ hasText: 'VEH-001' })
    expect(await vehicleRows.count()).toBeGreaterThan(2)
    await vehicleRows.nth(0).dragTo(vehicleRows.nth(2))
    await expect(page.getByRole('status', { name: '站序預覽結果' })).toBeVisible({ timeout: 30_000 })
    await page.screenshot({ path: path.join(screenshotDir, 'd-route-preview.png'), fullPage: true })
  })

  test('E：鍵盤送出後持續顯示真實等待階段', async ({ page }) => {
    test.setTimeout(240_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await expect(page.getByText(PLANNED)).toBeVisible({ timeout: 180_000 })

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
