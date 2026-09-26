import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const samples = path.resolve('..', 'data', 'samples')
const out = path.resolve('..', 'artifacts', 'demo-script.md')

const lines: string[] = []
function log(text = '') {
  lines.push(text)
  console.log(text)
}
function flush() {
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, lines.join('\n'), 'utf-8')
}

/** The last assistant bubble, which is everything the dispatcher can read. */
async function reply(page: Page): Promise<string> {
  const bubble = page.locator('.chat-log > div.mr-auto').last()
  return (await bubble.count()) ? (await bubble.innerText()).trim() : '(沒有回覆泡泡)'
}

async function record(page: Page, step: string, did: string) {
  log(`### ${step}`)
  log()
  log(`**你**：${did}`)
  log()
  log('**它**')
  log()
  log('```')
  log(await reply(page))
  log('```')
  log()
  // 還沒排班時上排那條統計不存在,讀不到不是錯誤,就是「還沒排」。
  const stats = page.locator('.topbar-stats')
  const shown = (await stats.count()) ? (await stats.innerText()).replace(/\s+/g, ' ').trim() : '（還沒排班）'
  log(`**上排**：${shown}`)
  log()
  log('---')
  log()
  flush()
}

async function send(page: Page, message: string) {
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const assistants = page.locator('.chat-log > div.mr-auto')
  const before = await assistants.count()
  await expect(input).toBeEnabled({ timeout: 120_000 })
  await input.click()
  await input.fill('')
  // Enter 就是送出,多行要用 Shift+Enter,不然第一行就先送出去了。
  const parts = message.split('\n')
  await input.pressSequentially(parts[0] || '')
  for (const part of parts.slice(1)) {
    await input.press('Shift+Enter')
    await input.pressSequentially(part)
  }
  await input.press('Enter')
  await expect.poll(async () => assistants.count(), { timeout: 120_000 }).toBeGreaterThan(before)
  await expect
    .poll(
      async () => {
        const text = await assistants.last().innerText()
        return ['正在理解', '正在執行', '正在整理'].some((p) => text.includes(p)) ? '' : text
      },
      { timeout: 180_000 },
    )
    .not.toBe('')
}

/** Pick 方案 A and apply it, then report where the confirmation showed up.
 *  第五幕時畫面上還留著第四幕那一組方案卡,一定要挑最新的那一組,
 *  不然點到的是已經套用過的舊卡,【確認套用】根本不會出現。 */
async function applyPlanA(page: Page, step: string, did: string) {
  const group = page.getByRole('group', { name: '臨時插單方案' }).last()
  await expect(group).toBeVisible({ timeout: 60_000 })
  await group.locator('button.urgent-card:not(.urgent-card-unavailable)').first().click()
  await group.getByRole('button', { name: '確認套用', exact: true }).first().click()
  await expect(page.getByText('已建立新版本。').last()).toBeVisible({ timeout: 180_000 })
  await page.waitForTimeout(4000)
  await record(page, step, did)
}

test('Demo 逐句腳本：二十步走完,最後的數字要對得上', async ({ page }) => {
  test.setTimeout(2_400_000)
  await page.setViewportSize({ width: 1440, height: 900 })

  log('# Demo 逐句腳本　實跑紀錄')
  log()
  log('真的開瀏覽器逐字打進去,抄畫面上的字。')
  log()
  log('---')
  log()

  await page.goto('/')
  await expect(page.getByText('先放入今天的訂單', { exact: true })).toBeVisible({ timeout: 60_000 })

  // ── 1 ────────────────────────────────────────────────────────────
  log('## 第 1 幕　丟檔案、排班')
  log()
  await page.getByLabel('上傳 Excel').last().setInputFiles(path.join(samples, 'demo-50-tight-missing.xlsx'))
  await send(page, '請幫我排今天的班')
  await record(page, '①', '附加 demo-50-tight-missing.xlsx,打「請幫我排今天的班」')

  await send(page, 'ORD-001 是北投示範配送點 01，ORD-002 早上送，PKG-003-01 是 1.35 公斤')
  await expect(page.locator('.topbar-stats')).toContainText('49/50 已安排', { timeout: 240_000 })
  await record(page, '②', '直接把三個值講出來')

  // ── 2 ────────────────────────────────────────────────────────────
  log('## 第 2 幕　司機身體不舒服')
  log()
  await send(page, '二號車的阿明今天身體不舒服，不能拿太重，而且要早點下班去看醫生')
  await record(page, '③', '二號車的阿明今天身體不舒服，不能拿太重，而且要早點下班去看醫生')

  await send(page, '今天就好，20公斤以內，五點前要收工')
  await record(page, '④', '今天就好，20公斤以內，五點前要收工')

  await page.getByRole('button', { name: '套用', exact: true }).last().click()
  await page.waitForTimeout(8000)
  await record(page, '⑤', '按【套用】')

  // ── 3 ────────────────────────────────────────────────────────────
  log('## 第 3 幕　看板拖拉')
  log()
  const board = page.getByRole('list', { name: '四台車訂單看板' })
  await expect(board).toBeVisible({ timeout: 60_000 })
  const source = board.locator('[data-order-id="ORD-042"]')
  await source.scrollIntoViewIfNeeded()
  await source.dragTo(page.getByRole('region', { name: 'VEH-004 訂單欄' }).locator('.order-board-stop').nth(4))
  await page.waitForTimeout(6000)
  await record(page, '⑥', '把第三車第 1 站的 ORD-042 拖到第四車')

  const applyChange = page.getByRole('button', { name: '套用變更', exact: true }).last()
  await expect(applyChange).toBeVisible({ timeout: 60_000 })
  await applyChange.click()
  await page.waitForTimeout(8000)
  // 拖拉的回覆不在對話框,在地圖的浮出訊息跟看板最下面。
  await expect(page.locator('body')).toContainText('已套用 ORD-042 的跨車站序', { timeout: 60_000 })
  await record(page, '⑦', '按【套用變更】')

  // ── 4 ────────────────────────────────────────────────────────────
  log('## 第 4 幕　三張急單')
  log()
  await send(page, '客戶剛打來，三張急單今天要送')
  await record(page, '⑧', '客戶剛打來，三張急單今天要送')

  await send(
    page,
    'ORD-101 25.036/121.567 Z3 8公斤 1件 早上\nORD-102 25.079/121.575 Z2 12公斤 1件 早上\nORD-103 25.015/121.462 Z4 5公斤 1件 早上',
  )
  await record(page, '⑨', '三行一次貼進去')

  await page.getByRole('button', { name: '產生插單預覽' }).last().click()
  await page.waitForTimeout(6000)
  await record(page, '⑩', '按【產生插單預覽】')

  await applyPlanA(page, '⑪', '點方案 A,按【確認套用】')

  // ── 5 ────────────────────────────────────────────────────────────
  log('## 第 5 幕　裝車後又來一張急單')
  log()
  await page.getByRole('button', { name: '開始裝車', exact: true }).click()
  await page.waitForTimeout(6000)
  await record(page, '⑫', '按【開始裝車】')

  await send(page, '又來一張急單 ORD-104 25.041/121.543 Z3 6公斤 1件 下午')
  await record(page, '⑬', '又來一張急單 ORD-104 25.041/121.543 Z3 6公斤 1件 下午')

  await page.getByRole('button', { name: '產生插單預覽' }).last().click()
  await page.waitForTimeout(6000)
  await record(page, '⑭', '按【產生插單預覽】')

  await applyPlanA(page, '⑮', '點方案 A,按【確認套用】')

  // ── 6 ────────────────────────────────────────────────────────────
  log('## 第 6 幕　模擬出發後要提前')
  log()
  await page.getByRole('button', { name: '模擬出發', exact: true }).click()
  await page.waitForTimeout(6000)
  await record(page, '⑯', '按【模擬出發】')

  const slider = page.getByRole('slider', { name: '配送時間軸' })
  const max = await slider.getAttribute('max')
  await slider.fill(String(Math.floor(Number(max) / 2)))
  await page.waitForTimeout(4000)
  await record(page, '⑰', '時間軸拉到中間')

  await send(page, 'ORD-036 客戶說中午前一定要拿到')
  await record(page, '⑱', 'ORD-036 客戶說中午前一定要拿到')

  // ── 7 ────────────────────────────────────────────────────────────
  log('## 第 7 幕　成效回顧')
  log()
  await send(page, '今天成效如何')
  const review = await reply(page)
  await record(page, '⑲', '今天成效如何')

  await send(page, '好，那明天要怎麼改')
  await record(page, '⑳', '好，那明天要怎麼改')

  // 成效那句話報的張數,必須跟上排統計是同一組數字。調度員會兩邊對照,
  // 對不起來就是我們自己的資料在打架。
  const stats = await page.locator('.topbar-stats').innerText()
  const topbarTotal = stats.match(/(\d+)\s*張訂單/)?.[1]
  const topbarAssigned = stats.match(/(\d+)\s*\/\s*\d+\s*已安排/)?.[1]
  const spoken = review.match(/今天送達 (\d+)／(\d+) 張/) || review.match(/今天 (\d+) 張全部送達/)
  log(`**對帳**：上排 ${stats.replace(/\s+/g, ' ').trim()}　／　成效那句 ${spoken?.[0] ?? '(沒抓到)'}`)
  log()
  flush()
  expect(spoken, `成效回覆沒給張數：${review}`).toBeTruthy()
  const spokenAssigned = spoken![1]
  const spokenTotal = spoken![2] ?? spoken![1]
  expect(spokenTotal, `上排寫 ${topbarTotal} 張訂單,成效那句說 ${spokenTotal} 張`).toBe(topbarTotal)
  expect(spokenAssigned, `上排寫已安排 ${topbarAssigned},成效那句說送達 ${spokenAssigned}`).toBe(topbarAssigned)
})
