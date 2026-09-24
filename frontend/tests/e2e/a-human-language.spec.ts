import { expect, test } from '@playwright/test'
import path from 'node:path'

const workbook = path.resolve('..', 'data', 'samples', 'demo-50-relaxed.xlsx')
const screenshotDir = path.resolve('..', 'docs', 'screenshots')

async function send(page: import('@playwright/test').Page, message: string): Promise<string> {
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  await input.click()
  await input.pressSequentially(message)
  await expect(input).toHaveValue(message)
  await input.press('Enter')
  await expect(input).toBeEnabled({ timeout: 180_000 })
  const bubble = page.locator('.chat-log > div.mr-auto').last()
  await expect(bubble).toBeVisible({ timeout: 30_000 })
  await expect
    .poll(async () => (await bubble.innerText()).trim(), { timeout: 180_000 })
    .not.toBe('調度助理')
  const lines = (await bubble.innerText()).split('\n')
  return lines.slice(1).join('\n').trim()
}

test('A 組五句常識題都在畫面上回白話', async ({ page }) => {
  test.setTimeout(600_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const uploader = page.getByLabel('上傳 Excel')
  if (await uploader.count()) await uploader.setInputFiles(workbook)
  // Choosing the file only attaches it; the panel says 「附加檔案 / 送出」 and
  // nothing is uploaded until 送出 is pressed.
  await page.getByRole('button', { name: '送出', exact: true }).click()
  await expect(page.locator('.topbar-stats')).toContainText('50/50 已安排', { timeout: 240_000 })

  const cases = [
    ['你是誰', /調度|配送|排班|派車/],
    ['你可以做什麼', /訂單|排班|配送|插單/],
    ['這個系統是做什麼的', /配送|調度|排班|方案/],
    ['急單需要哪些欄位', /訂單|欄位|包裹|時段/],
    ['載重是怎麼算的', /載重|重量|上限|包裹/],
  ] as const

  for (const [index, [message, expected]] of cases.entries()) {
    const visible = await send(page, message)
    const normalized = visible.trim()
    expect(normalized, `${message}：畫面沒有回覆`).not.toBe('')
    expect(normalized.startsWith('{') || normalized.startsWith('['), `${message}：畫面出現 JSON`).toBe(false)
    expect(normalized, `${message}：畫面出現罐頭`).not.toContain('已完成確定性工具計算')
    expect(normalized, `${message}：不是白話回覆`).toMatch(expected)
    expect(normalized, `${message}：不應顯示缺欄清單`).not.toContain('缺少：')
    await page.screenshot({ path: path.join(screenshotDir, `A-0${index + 1}.png`), fullPage: true })
  }
})
