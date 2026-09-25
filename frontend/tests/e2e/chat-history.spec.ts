import { expect, test } from '@playwright/test'
import path from 'node:path'

const relaxedWorkbook = path.resolve('..', 'data', 'samples', 'demo-50-relaxed.xlsx')

/**
 * 排班完成的瞬間，畫面會從空白控制塔換成正式版面。那是兩棵不同的元件樹，
 * 對話面板會被拆掉重裝——調度員剛丟完檔案抬頭一看，對話框是空的，
 * 像是什麼都沒發生。這一支就守這件事：換版面之後，剛剛講過的話還在。
 */
test('排班完成換版面之後，對話紀錄不會被清掉', async ({ page }) => {
  test.setTimeout(300_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByText('先放入今天的訂單', { exact: true })).toBeVisible({ timeout: 60_000 })

  await page.getByLabel('上傳 Excel').last().setInputFiles(relaxedWorkbook)
  // 選檔案只是附加，要按【送出】才會上傳排班。
  await page.getByRole('button', { name: '送出', exact: true }).click()

  // 送出當下就會有兩則泡泡：使用者那則帶著檔名，助理那則講正在驗證排班。
  const bubbles = page.locator('.chat-log > div')
  await expect.poll(async () => bubbles.count(), { timeout: 60_000 }).toBeGreaterThan(0)

  // 排班完成 → 版面換掉。
  await expect(page.locator('.topbar-stats')).toContainText('已安排', { timeout: 180_000 })
  await expect(page.getByLabel('配送地圖', { exact: true })).toBeVisible({ timeout: 60_000 })

  // 換完版面，對話還在，而且看得到剛剛丟的檔名。
  await expect(bubbles.first()).toBeVisible()
  await expect(page.locator('.chat-log')).toContainText('demo-50-relaxed.xlsx')

  // 排完班要在對話框交代結果，不能只有上排那串數字。
  await expect(page.locator('.chat-log')).toContainText('讀好了：50 張訂單、4 台車。', { timeout: 60_000 })
  await expect(page.locator('.chat-log')).toContainText('50 張全部排進去了')
  // 進度那句不能把結果蓋掉。
  await expect(page.locator('.chat-log')).toContainText('已送出檔案，正在進行資料驗證與排班。')

  // 之後再講話，接在同一段對話後面，不是從頭開始。
  const before = await bubbles.count()
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  await input.click()
  await input.pressSequentially('你是誰')
  await input.press('Enter')
  await expect.poll(async () => bubbles.count(), { timeout: 180_000 }).toBeGreaterThan(before)
  await expect(page.locator('.chat-log')).toContainText('demo-50-relaxed.xlsx')
})
