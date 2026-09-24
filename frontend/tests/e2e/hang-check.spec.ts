import { expect, test } from '@playwright/test'
import path from 'node:path'

const samples = path.resolve('..', 'data', 'samples')

test('驗證失敗之後還能不能繼續講話', async ({ page }) => {
  test.setTimeout(600_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByText('先放入今天的訂單', { exact: true })).toBeVisible({ timeout: 60_000 })

  await page.getByLabel('上傳 Excel').last().setInputFiles(path.join(samples, 'demo-missing-fields.xlsx'))
  await page.waitForTimeout(6000)
  const assistants = page.locator('.chat-log > div.mr-auto')
  console.log('=== 上傳後泡泡數 ===', await assistants.count())
  if (await assistants.count()) {
    console.log('=== 上傳後最後一則 ===\n' + (await assistants.last().innerText()).trim())
  }

  const input = page.getByRole('textbox', { name: '輸入訊息' })
  console.log('=== 輸入框還能打字嗎 ===', await input.isEnabled())

  const before = await assistants.count()
  await input.click()
  await input.pressSequentially('請幫我排今天的班')
  await input.press('Enter')

  const started = Date.now()
  let grew = false
  for (let i = 0; i < 60; i += 1) {
    await page.waitForTimeout(2000)
    if ((await assistants.count()) > before) {
      grew = true
      break
    }
  }
  const waited = Math.round((Date.now() - started) / 1000)
  console.log('=== 有沒有出現新泡泡 ===', grew, `等了 ${waited} 秒`)
  if (grew) {
    const bubble = assistants.last()
    for (let i = 0; i < 90; i += 1) {
      const t = await bubble.innerText()
      if (!['正在理解', '正在執行', '正在整理'].some((p) => t.includes(p))) {
        console.log(`=== 回覆（總共等 ${Math.round((Date.now() - started) / 1000)} 秒）===\n` + t.trim())
        break
      }
      await page.waitForTimeout(2000)
    }
  } else {
    console.log('=== 泡泡根本沒出現，畫面上現在是 ===')
    const log = page.locator('.chat-log')
    console.log((await log.innerText()).trim().slice(-600))
  }
  await page.screenshot({
    path: path.resolve('..', 'docs', 'screenshots', 'S-hang-check.png'),
    fullPage: true,
  })
})
