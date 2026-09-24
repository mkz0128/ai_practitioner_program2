import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

const samples = path.resolve('..', 'data', 'samples')

async function settle(page: Page, before: number) {
  const assistants = page.locator('.chat-log > div.mr-auto')
  await expect.poll(async () => assistants.count(), { timeout: 60_000 }).toBeGreaterThan(before)
  const bubble = assistants.last()
  await expect
    .poll(
      async () => {
        const t = await bubble.innerText()
        return ['正在理解', '正在執行', '正在整理'].some((p) => t.includes(p)) ? '' : t
      },
      { timeout: 180_000 },
    )
    .not.toBe('')
  return (await bubble.innerText()).trim()
}

async function plan(page: Page) {
  await page.goto('/')
  await expect(page.getByText('先放入今天的訂單', { exact: true })).toBeVisible({ timeout: 60_000 })
  await page.getByLabel('上傳 Excel').last().setInputFiles(path.join(samples, 'demo-50-tight.xlsx'))
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  await expect(input).toBeEnabled({ timeout: 60_000 })
  await input.click()
  await input.pressSequentially('請幫我排今天的班')
  await input.press('Enter')
  await expect(page.locator('.topbar-map .map-route-filter').first()).toBeVisible({ timeout: 240_000 })
}

test('C：三行急單一次貼上，到底吃進去幾張', async ({ page }) => {
  test.setTimeout(900_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await plan(page)

  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const assistants = page.locator('.chat-log > div.mr-auto')

  let before = await assistants.count()
  await input.click()
  await input.pressSequentially('客戶剛打來，三張急單今天要送')
  await input.press('Enter')
  console.log('=== 第一句 ===\n' + (await settle(page, before)))

  // A human pastes; they do not type newlines one key at a time. fill() puts
  // the whole three-line block in at once, which is what a paste does.
  const three =
    'ORD-101 25.036/121.567 Z3 8公斤 1件 早上\n' +
    'ORD-102 25.079/121.575 Z2 12公斤 1件 早上\n' +
    'ORD-103 25.015/121.462 Z4 5公斤 1件 早上'
  before = await assistants.count()
  await input.click()
  await input.fill(three)
  const typed = await input.inputValue()
  console.log('=== 輸入框裡實際有幾行 ===', typed.split('\n').length)
  console.log(typed)
  await input.press('Enter')
  console.log('=== 貼三行之後 ===\n' + (await settle(page, before)))
})

test('F：發車後時間軸有沒有可以動的站', async ({ page }) => {
  test.setTimeout(900_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await plan(page)

  await page.getByRole('button', { name: '開始裝車', exact: true }).click()
  await expect(page.getByText('上車後', { exact: true }).first()).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: '模擬出發', exact: true }).click()
  await expect(page.getByText('已發車', { exact: true }).first()).toBeVisible({ timeout: 60_000 })

  const slider = page.getByRole('slider', { name: '配送時間軸' })
  console.log('=== 時間軸存在嗎 ===', await slider.count())
  if (await slider.count()) {
    const max = await slider.getAttribute('max')
    console.log('=== max ===', max)
    await slider.fill(String(Math.floor(Number(max) / 2)))
    await page.waitForTimeout(4000)
  }

  for (const sel of [
    '.timeline-stop',
    '.timeline-stop[aria-disabled="false"]',
    '.timeline-stop[aria-disabled="true"]',
  ]) {
    console.log(`=== ${sel} ===`, await page.locator(sel).count())
  }
  const any = page.locator('.timeline-stop')
  if (await any.count()) {
    console.log('=== 前三個站的文字 ===')
    for (let i = 0; i < Math.min(3, await any.count()); i += 1) {
      console.log(
        `  [${i}] aria-disabled=${await any.nth(i).getAttribute('aria-disabled')}  ` +
          (await any.nth(i).innerText()).replace(/\n/g, ' '),
      )
    }
  }
  console.log('=== 目前模擬時刻 ===', (await page.locator('body').innerText()).match(/目前模擬時刻\s*\S+/)?.[0])
})
