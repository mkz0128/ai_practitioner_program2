import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const samples = path.resolve('..', 'data', 'samples')
const out = path.resolve('..', 'artifacts', 'demo-script.md')
const screenshotDir = path.resolve('..', 'docs', 'screenshots')
const steps = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳']

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
  // 方案概況放在可展開的訂單明細，不再常駐在頂列。
  const stats = page.locator('.topbar-stats')
  const shown = (await stats.count()) ? ((await stats.textContent()) || '').replace(/\s+/g, ' ').trim() : '（還沒排班）'
  log(`**方案概況**：${shown}`)
  log()
  log('---')
  log()
  flush()
  fs.mkdirSync(screenshotDir, { recursive: true })
  await page.waitForTimeout(350)
  await page.screenshot({ path: path.join(screenshotDir, `DEMO-${String(steps.indexOf(step) + 1).padStart(2, '0')}.png`) })
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
  await expect(input).toBeEnabled({ timeout: 180_000 })
  await expect(assistants.last().locator('.chat-thinking-status')).toHaveCount(0)
  await expect
    .poll(
      async () => assistants.last().innerText(),
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

test('Demo 逐句腳本：二十步逐項驗收', async ({ page }) => {
  test.setTimeout(2_400_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const consoleErrors: string[] = []
  const forbiddenRequests: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/dispatch' || url.hostname.includes('googleapis')) forbiddenRequests.push(request.url())
  })

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
  for (const expected of ['3 個地方', 'ORD-001', '地點名稱', 'ORD-002', '配送時段', 'PKG-003-01', '重量']) expect(await reply(page)).toContain(expected)
  await record(page, '①', '附加 demo-50-tight-missing.xlsx,打「請幫我排今天的班」')

  await send(page, 'ORD-001 是北投示範配送點 01，ORD-002 早上送，PKG-003-01 是 1.35 公斤')
  await expect(page.locator('.topbar-stats')).toContainText('49/50 已安排', { timeout: 240_000 })
  for (const expected of ['北投示範配送點 01', '早上', '1.35', '50 張訂單', '4 台車', '49 張', 'ORD-050', '空車也裝不下']) expect(await reply(page)).toContain(expected)
  await record(page, '②', '直接把三個值講出來')

  // ── 2 ────────────────────────────────────────────────────────────
  log('## 第 2 幕　司機身體不舒服')
  log()
  await send(page, '二號車的阿明今天身體不舒服，不能拿太重，而且要早點下班去看醫生')
  for (const expected of ['兩個數字', '22 kg', '3 張', '15:02']) expect(await reply(page)).toContain(expected)
  await record(page, '③', '二號車的阿明今天身體不舒服，不能拿太重，而且要早點下班去看醫生')

  await send(page, '今天就好，20公斤以內，五點前要收工')
  for (const expected of ['20 kg', '17:00', '19 張', '14:31', '+12.5 km', '+26 分鐘']) expect(await reply(page)).toContain(expected)
  await record(page, '④', '今天就好，20公斤以內，五點前要收工')

  await page.getByRole('button', { name: '套用', exact: true }).last().click()
  await expect(page.locator('.topbar-stats')).toContainText('2 條規則', { timeout: 120_000 })
  await expect(page.locator('.map-change-summary')).toContainText('3 張訂單換車')
  await expect(page.getByRole('button', { name: '司機規則 2' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '訂單與車輛' }).click()
  await expect(page.locator('.order-board-stop-changed')).toHaveCount(3)
  await expect(page.locator('.map-stop-changed')).toHaveCount(3)
  await record(page, '⑤', '按【套用】')

  // ── 3 ────────────────────────────────────────────────────────────
  log('## 第 3 幕　看板拖拉')
  log()
  const board = page.getByRole('list', { name: '四台車訂單看板' })
  await expect(board).toBeVisible({ timeout: 60_000 })
  const source = board.locator('[data-order-id="ORD-042"]')
  await source.scrollIntoViewIfNeeded()
  await source.dragTo(page.getByRole('region', { name: 'VEH-004 訂單欄' }).locator('.order-board-stop').nth(4))
  await expect(page.getByRole('button', { name: '套用變更', exact: true }).last()).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.topbar-stats')).toContainText('49/50')
  await record(page, '⑥', '把第三車第 1 站的 ORD-042 拖到第四車')

  const applyChange = page.getByRole('button', { name: '套用變更', exact: true }).last()
  await expect(applyChange).toBeVisible({ timeout: 60_000 })
  await applyChange.click()
  await expect(page.getByRole('region', { name: 'VEH-004 訂單欄' }).locator('[data-order-id="ORD-042"]')).toHaveClass(/order-board-stop-changed/, { timeout: 60_000 })
  await expect(page.getByRole('region', { name: 'VEH-003 訂單欄' }).locator('[data-order-id="ORD-042"]')).toHaveCount(0)
  await expect(page.locator('.map-stop-changed')).toHaveCount(1)
  // 拖拉的回覆不在對話框,在地圖的浮出訊息跟看板最下面。
  await expect(page.locator('body')).toContainText('已套用 ORD-042 的跨車站序', { timeout: 60_000 })
  await record(page, '⑦', '按【套用變更】')
  await expect(page.locator('.map-change-summary')).toHaveCount(0, { timeout: 7000 })

  // ── 4 ────────────────────────────────────────────────────────────
  log('## 第 4 幕　三張急單')
  log()
  await send(page, '客戶剛打來，三張急單今天要送')
  for (const expected of ['訂單編號', '配送地點', '座標', '配送區域', '重量', '件數', '配送時段']) expect(await reply(page)).toContain(expected)
  await record(page, '⑧', '客戶剛打來，三張急單今天要送')

  await send(
    page,
    'ORD-101 25.036/121.567 Z3 8公斤 1件 早上\nORD-102 25.079/121.575 Z2 12公斤 1件 早上\nORD-103 25.015/121.462 Z4 5公斤 1件 早上',
  )
  for (const expected of ['ORD-101', 'ORD-102', 'ORD-103', '產生插單預覽']) expect(await reply(page)).toContain(expected)
  await record(page, '⑨', '三行一次貼進去')

  await page.getByRole('button', { name: '產生插單預覽' }).last().click()
  await expect(page.getByRole('group', { name: '臨時插單方案' }).last().locator('button.urgent-card')).toHaveCount(2, { timeout: 180_000 })
  for (const expected of ['+1.9 公里', '+4.4 分鐘', '既有訂單都不用換車', '11:41', '09:30', '還沒套用']) expect(await reply(page)).toContain(expected)
  await record(page, '⑩', '按【產生插單預覽】')

  await applyPlanA(page, '⑪', '點方案 A,按【確認套用】')
  await expect(page.locator('.topbar-stats')).toContainText('52/53 已安排')
  for (const orderId of ['ORD-101', 'ORD-102', 'ORD-103']) await expect(board.locator(`[data-order-id="${orderId}"]`)).toHaveClass(/order-board-stop-changed/)
  await expect(page.locator('.map-stop-changed')).toHaveCount(3)

  // ── 5 ────────────────────────────────────────────────────────────
  log('## 第 5 幕　裝車後又來一張急單')
  log()
  await page.getByRole('button', { name: '開始裝車', exact: true }).click()
  await expect(page.getByText('上車後', { exact: true }).first()).toBeVisible({ timeout: 60_000 })
  await record(page, '⑫', '按【開始裝車】')

  await send(page, '又來一張急單 ORD-104 25.041/121.543 Z3 6公斤 1件 下午')
  for (const expected of ['ORD-104', '6 公斤', '下午', '產生插單預覽']) expect(await reply(page)).toContain(expected)
  await record(page, '⑬', '又來一張急單 ORD-104 25.041/121.543 Z3 6公斤 1件 下午')

  await page.getByRole('button', { name: '產生插單預覽' }).last().click()
  await expect(page.getByRole('group', { name: '臨時插單方案' }).last().locator('button.urgent-card')).toHaveCount(1, { timeout: 180_000 })
  for (const expected of ['ORD-104', '+0.5 公里', '+1.1 分鐘', '13:05', '還沒套用']) expect(await reply(page)).toContain(expected)
  await record(page, '⑭', '按【產生插單預覽】')

  await applyPlanA(page, '⑮', '點方案 A,按【確認套用】')
  await expect(page.locator('.topbar-stats')).toContainText('53/54 已安排')
  await expect(board.locator('[data-order-id="ORD-104"]')).toHaveClass(/order-board-stop-changed/)
  await expect(page.locator('.map-stop-changed')).toHaveCount(1)

  // ── 6 ────────────────────────────────────────────────────────────
  log('## 第 6 幕　模擬出發後要提前')
  log()
  await page.getByRole('button', { name: '模擬出發', exact: true }).click()
  await expect(page.getByText('已發車', { exact: true }).first()).toBeVisible({ timeout: 60_000 })
  await record(page, '⑯', '按【模擬出發】')

  const slider = page.getByRole('slider', { name: '配送時間軸' })
  const max = await slider.getAttribute('max')
  await slider.fill(String(Math.floor(Number(max) / 2)))
  await expect(page.locator('.timeline-stop-completed').first()).toBeVisible()
  await expect(page.locator('.timeline-stop-upcoming').first()).toBeVisible()
  const completedColor = await page.locator('.timeline-stop-completed').first().evaluate((node) => getComputedStyle(node).backgroundColor)
  expect(completedColor).toBe('rgb(148, 163, 184)')
  await record(page, '⑰', '時間軸拉到中間')

  await send(page, 'ORD-036 客戶說中午前一定要拿到')
  for (const expected of ['ORD-036', '第 6 站', '13:38', '已送 5 站', '1 小時 39 分鐘', '需人工處理']) expect(await reply(page)).toContain(expected)
  await expect(page.getByRole('button', { name: '確認套用', exact: true })).toHaveCount(0)
  await record(page, '⑱', 'ORD-036 客戶說中午前一定要拿到')

  await slider.fill(String(max))
  await expect(page.getByText('今日模擬行程已跑完', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看今日回顧', exact: true })).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, 'DEMO-END.png') })
  await page.getByRole('button', { name: '查看今日回顧', exact: true }).click()
  await expect(page.getByLabel('今日回顧位置')).toBeFocused()
  await expect(page.locator('.topbar-stats')).toContainText('53/54 已安排')

  // ── 7 ────────────────────────────────────────────────────────────
  log('## 第 7 幕　成效回顧')
  log()
  await send(page, '今天成效如何')
  const review = await reply(page)
  for (const expected of ['模擬進度', '53／54', '245.6', '64%', 'Z3', '5 分鐘', '14 張', '1 小時 10 分鐘']) expect(review).toContain(expected)
  expect(review).toContain('已排入方案')
  expect(review).toContain('計畫總里程')
  expect(review).toContain('依模擬路段推估')
  expect(review).not.toContain('今天送達')
  expect(review).not.toContain('最後幾站會掉出配送時段')
  await expect(page.getByText('下次排班會調高這台車的行駛時間估計，或少排 2 站。')).toHaveCount(0)
  await record(page, '⑲', '今天成效如何')

  await send(page, '好，那明天要怎麼改')
  await record(page, '⑳', '好，那明天要怎麼改')
  const suggestion = await reply(page)
  expect(suggestion).toContain('Z3')
  expect(suggestion).toContain('3 → 8')
  await expect(page.getByRole('button', { name: '套用建議', exact: true }).last()).toBeVisible()
  await expect(page.getByRole('button', { name: '先不要', exact: true }).last()).toBeVisible()
  expect(consoleErrors).toEqual([])
  expect(forbiddenRequests).toEqual([])

  // 成效那句話報的張數,必須跟上排統計是同一組數字。調度員會兩邊對照,
  // 對不起來就是我們自己的資料在打架。
  const stats = (await page.locator('.topbar-stats').textContent()) || ''
  log(`**對帳**：方案概況 ${stats}；成效那句 53／54 張`)
  log()
  flush()
  await expect(page.locator('.topbar-stats')).toContainText('54 張訂單')
  await expect(page.locator('.topbar-stats')).toContainText('53/54 已安排')
  expect(review).toContain('53／54 張')
})
