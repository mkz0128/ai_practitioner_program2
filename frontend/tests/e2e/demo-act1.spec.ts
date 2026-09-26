import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

const samples = path.resolve('..', 'data', 'samples')
const workbook = path.join(samples, 'demo-50-tight-missing.xlsx')

/**
 * 第一幕只有一個檔案。檔案有三格留白,系統講出是哪三格,調度員直接把值
 * 講出來,系統填進去就排班——全程不用改 Excel、不用再上傳一次。
 */
async function send(page: Page, message: string) {
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const assistants = page.locator('.chat-log > div.mr-auto')
  const before = await assistants.count()
  await expect(input).toBeEnabled({ timeout: 120_000 })
  await input.click()
  await input.fill('')
  await input.pressSequentially(message)
  await input.press('Enter')
  await expect.poll(async () => assistants.count(), { timeout: 120_000 }).toBeGreaterThan(before)
}

test('第一幕：一個檔案,留白的格子用講的補完就排班', async ({ page }) => {
  test.setTimeout(420_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByText('先放入今天的訂單', { exact: true })).toBeVisible({ timeout: 60_000 })

  const log = page.locator('.chat-log')
  await page.getByLabel('上傳 Excel').last().setInputFiles(workbook)
  await send(page, '請幫我排今天的班')

  // 講出是哪三格,用人看得懂的欄位名,而且要說值講給它就好。
  await expect(log).toContainText('這份檔案有 3 個地方要補', { timeout: 120_000 })
  await expect(log).toContainText('直接跟我講就可以，不用改檔案')
  await expect(log).toContainText('訂單 ORD-001 缺「地點名稱」')
  await expect(log).toContainText('訂單 ORD-002 缺「配送時段」')
  await expect(log).toContainText('包裹 PKG-003-01 缺「重量」')
  await expect(log).toContainText('值講給我，我就填進去排班。')
  await expect(log).not.toContainText('補完再傳一次')
  for (const machineField of ['location_label', 'time_slot', 'weight_kg']) {
    await expect(page.locator('body')).not.toContainText(machineField)
  }

  // 一句話補三格。
  await send(page, 'ORD-001 是北投示範配送點 01，ORD-002 早上送，PKG-003-01 是 1.35 公斤')
  await expect(page.locator('.topbar-stats')).toContainText('49/50 已安排', { timeout: 240_000 })

  // 覆述填了什麼,時段要講「早上」不是 MORNING。
  await expect(log).toContainText('補好了：', { timeout: 60_000 })
  await expect(log).toContainText('ORD-001 的地點名稱：北投示範配送點 01')
  await expect(log).toContainText('ORD-002 的配送時段：早上')
  await expect(log).toContainText('PKG-003-01 的重量：1.35')
  await expect(log).not.toContainText('MORNING')

  // 然後就是平常那份排班結果,數字要跟 demo-50-tight 一模一樣。
  await expect(log).toContainText('讀好了：50 張訂單、4 台車。')
  await expect(log).toContainText('排進去 49 張，有 1 張排不進去')
  await expect(log).toContainText('ORD-050')
  await expect(log).toContainText('比最大的那台車還重，空車也裝不下')
  await expect(log).toContainText('還是這幾張先留給人工處理？')

  // 第一幕講過的話要留在畫面上,換版面不能把它洗掉。
  await expect(log).toContainText('這份檔案有 3 個地方要補')
})

test('第一幕：只補一格,剩下的還會再問', async ({ page }) => {
  test.setTimeout(420_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByText('先放入今天的訂單', { exact: true })).toBeVisible({ timeout: 60_000 })

  const log = page.locator('.chat-log')
  await page.getByLabel('上傳 Excel').last().setInputFiles(workbook)
  await send(page, '請幫我排今天的班')
  await expect(log).toContainText('這份檔案有 3 個地方要補', { timeout: 120_000 })

  await send(page, 'ORD-002 是早上送')
  await expect(log).toContainText('記下來了：', { timeout: 120_000 })
  await expect(log).toContainText('ORD-002 的配送時段：早上')
  await expect(log).toContainText('還差 2 個')
  // 沒補完就不會排班:上排那條統計還沒出現。
  await expect(page.locator('.topbar-stats')).toHaveCount(0)

  await send(page, 'ORD-001 是北投示範配送點 01，PKG-003-01 1.35 公斤')
  await expect(page.locator('.topbar-stats')).toContainText('49/50 已安排', { timeout: 240_000 })
  await expect(log).toContainText('補好了：', { timeout: 60_000 })
})
