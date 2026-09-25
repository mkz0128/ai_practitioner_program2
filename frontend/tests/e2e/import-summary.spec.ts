import { expect, test } from '@playwright/test'
import path from 'node:path'

const tightWorkbook = path.resolve('..', 'data', 'samples', 'demo-50-tight.xlsx')
const relaxedWorkbook = path.resolve('..', 'data', 'samples', 'demo-50-relaxed.xlsx')

/**
 * 排完班，對話框一定要講出結果。上排的「49/50 已安排」只是數字，
 * 沒講那一張為什麼排不進去，調度員得自己去看板最下面找。
 * 而且兩條上傳路徑都要講：對話框的【附加檔案】，跟上排的【換一份資料】。
 */
test('從對話框上傳：排完班交代結果，排不進去的那張講原因並反問', async ({ page }) => {
  test.setTimeout(300_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByText('先放入今天的訂單', { exact: true })).toBeVisible({ timeout: 60_000 })

  await page.getByLabel('上傳 Excel').last().setInputFiles(tightWorkbook)
  await page.getByRole('button', { name: '送出', exact: true }).click()
  await expect(page.locator('.topbar-stats')).toContainText('49/50 已安排', { timeout: 180_000 })

  const log = page.locator('.chat-log')
  await expect(log).toContainText('讀好了：50 張訂單、4 台車。', { timeout: 60_000 })
  await expect(log).toContainText('排進去 49 張，有 1 張排不進去')
  // 講出是哪一張、為什麼，而不是叫人自己去找，更不能把代碼直接印出來。
  // ORD-050 是 170 公斤，最大的車上限 160 公斤——空車也裝不下，
  // 這跟「今天車子比較滿」不是同一件事，不能混講。
  await expect(log).toContainText('ORD-050')
  await expect(log).toContainText('比最大的那台車還重，空車也裝不下')
  await expect(log).not.toContainText('每一台車的載重餘裕都不夠')
  await expect(page.locator('body')).not.toContainText('CAPACITY_LIMIT')
  await expect(page.locator('body')).not.toContainText('OVER_VEHICLE_CAPACITY')
  // 最後要把球丟回給調度員。
  await expect(log).toContainText('還是這幾張先留給人工處理？')
})

test('從上排「換一份資料」上傳：一樣要在對話框交代結果', async ({ page }) => {
  test.setTimeout(300_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByText('先放入今天的訂單', { exact: true })).toBeVisible({ timeout: 60_000 })

  // 先用對話框上傳一份，上排才會出現【換一份資料】。
  await page.getByLabel('上傳 Excel').last().setInputFiles(relaxedWorkbook)
  await page.getByRole('button', { name: '送出', exact: true }).click()
  await expect(page.locator('.topbar-stats')).toContainText('50/50 已安排', { timeout: 180_000 })

  // 這一顆走的是另一條程式路徑，本來完全不會在對話框留下任何東西。
  await page.locator('.topbar-actions input[type="file"][aria-label="上傳 Excel"]').setInputFiles(tightWorkbook)
  await expect(page.locator('.topbar-stats')).toContainText('49/50 已安排', { timeout: 180_000 })
  await expect(page.locator('.chat-log')).toContainText('排進去 49 張，有 1 張排不進去', { timeout: 60_000 })
})
