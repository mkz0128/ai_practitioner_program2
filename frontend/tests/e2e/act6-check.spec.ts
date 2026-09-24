import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

const workbook = path.resolve('..', 'data', 'samples', 'demo-50-tight.xlsx')

async function sendTyped(page: Page, message: string): Promise<string> {
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const assistants = page.locator('.chat-log > div.mr-auto')
  const before = await assistants.count()
  await expect(input).toBeEnabled({ timeout: 240_000 })
  await input.click()
  await input.pressSequentially(message)
  await expect(input).toHaveValue(message)
  await input.press('Enter')
  await expect.poll(async () => assistants.count(), { timeout: 60_000 }).toBeGreaterThan(before)
  const bubble = assistants.last()
  await expect.poll(async () => {
    const text = await bubble.innerText()
    const pending = ['正在理解', '正在執行', '正在整理']
    return pending.some((phase) => text.includes(phase)) ? '' : text
  }, { timeout: 240_000 }).not.toBe('')
  return (await bubble.innerText()).trim()
}

test('第6幕：發車後要提前，選項是否真的提前、能不能套用', async ({ page }) => {
  test.setTimeout(900_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByText('先放入今天的訂單', { exact: true })).toBeVisible({ timeout: 60_000 })
  await page.getByLabel('上傳 Excel').last().setInputFiles(workbook)
  // The planning turn does not settle like an ordinary chat reply, so wait on
  // the success banner the way polish.spec.ts does instead of on a bubble.
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  await expect(input).toBeEnabled({ timeout: 60_000 })
  await input.click()
  await input.pressSequentially('請幫我排今天的班')
  await expect(input).toHaveValue('請幫我排今天的班')
  await input.press('Enter')
  await expect(page.locator('.topbar-map .map-route-filter').first()).toBeVisible({ timeout: 240_000 })
  await expect(page.getByLabel('配送地圖', { exact: true })).toBeVisible({ timeout: 60_000 })

  await page.getByRole('button', { name: '開始裝車', exact: true }).click()
  await expect(page.getByText('上車後', { exact: true }).first()).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: '模擬出發', exact: true }).click()
  await expect(page.getByText('已發車', { exact: true }).first()).toBeVisible({ timeout: 60_000 })

  // Pick a stop that is genuinely still undelivered and genuinely late, so the
  // "customer wants it before noon" request has something real to move.
  const rows = page.locator('.timeline-stop[aria-disabled="false"]')
  const count = await rows.count()
  const candidates: string[] = []
  for (let index = 0; index < Math.min(count, 40); index += 1) {
    const label = await rows.nth(index).innerText()
    const match = label.match(/ORD-\d{3}/)
    if (match) candidates.push(match[0])
  }
  console.log('=== 還沒送、可以動的訂單 ===', candidates.slice(0, 20).join(', '))

  const target = candidates[Math.min(6, candidates.length - 1)]
  console.log('=== 選中 ===', target)

  const preview = await sendTyped(page, `${target} 客戶說中午前一定要拿到`)
  console.log('=== 6-2 畫面回覆 ===\n' + preview)
  await page.screenshot({ path: path.resolve('..', 'docs', 'screenshots', 'ACT6-1-preview.png'), fullPage: true })

  // Now try to actually apply the first selectable option.
  const buttons = page.getByRole('button')
  const labels: string[] = []
  for (let index = 0; index < (await buttons.count()); index += 1) {
    const text = (await buttons.nth(index).innerText()).trim()
    if (text) labels.push(text)
  }
  console.log('=== 畫面上所有按鈕 ===', [...new Set(labels)].join(' | '))

  const applyCandidates = ['套用 A', '套用', '套用變更', '確認套用', '先送這單']
  for (const name of applyCandidates) {
    const button = page.getByRole('button', { name, exact: true }).last()
    if (await button.count() === 0) continue
    if (!(await button.isVisible())) continue
    console.log('=== 按下 ===', name)
    await button.click()
    await page.waitForTimeout(6000)
    const body = await page.locator('body').innerText()
    const refused = body.includes('已出發的規劃不可再次確認')
    console.log('=== 6-3 按完之後，畫面有沒有出現拒絕訊息 ===', refused ? '有，被拒絕' : '沒有，看起來成功')
    const bubble = page.locator('.chat-log > div.mr-auto').last()
    console.log('=== 6-3 最後一則回覆 ===\n' + (await bubble.innerText()).trim())
    await page.screenshot({ path: path.resolve('..', 'docs', 'screenshots', 'ACT6-2-applied.png'), fullPage: true })
    break
  }
})
