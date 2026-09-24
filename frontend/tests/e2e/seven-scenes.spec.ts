import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const samples = path.resolve('..', 'data', 'samples')
const shots = path.resolve('..', 'docs', 'screenshots')
const out = path.resolve('..', 'artifacts', 'seven-scenes.md')

const lines: string[] = []
function log(text = '') {
  lines.push(text)
  console.log(text)
}

async function shot(page: Page, name: string) {
  try {
    await page.screenshot({ path: path.join(shots, `S-${name}.png`), fullPage: true })
  } catch {
    // The project sits under a synced Desktop folder; a screenshot write can
    // fail transiently. Losing one image must not abandon the walkthrough.
    log(`_(截圖 ${name} 寫入失敗，不影響本步驟結果)_`)
  }
}

/** Everything the dispatcher can actually read on screen right now. */
async function screen(page: Page) {
  const bubble = page.locator('.chat-log > div.mr-auto').last()
  const reply = (await bubble.count()) ? (await bubble.innerText()).trim() : '(沒有回覆泡泡)'
  const buttons: string[] = []
  const all = page.getByRole('button')
  for (let i = 0; i < (await all.count()); i += 1) {
    const t = (await all.nth(i).innerText()).trim()
    if (t && !buttons.includes(t)) buttons.push(t)
  }
  return { reply, buttons }
}

async function record(page: Page, step: string, did: string, name: string) {
  const { reply, buttons } = await screen(page)
  log(`### ${step}`)
  log()
  log(`**做了什麼**：${did}`)
  log()
  log('**畫面回覆（一字不漏）**')
  log()
  log('```')
  log(reply)
  log('```')
  log()
  log(`**畫面上的按鈕**：${buttons.join(' ｜ ') || '（無）'}`)
  log()
  await shot(page, name)
  log(`**截圖**：docs/screenshots/S-${name}.png`)
  log()
  log('---')
  log()
  flush()
}

/** Send and wait, but never abandon the walkthrough: a step that hangs or
 *  errors is itself a finding, so it gets written down and the run goes on. */
async function send(page: Page, message: string): Promise<void> {
  try {
    const input = page.getByRole('textbox', { name: '輸入訊息' })
    const assistants = page.locator('.chat-log > div.mr-auto')
    const before = await assistants.count()
    await expect(input).toBeEnabled({ timeout: 90_000 })
    await input.click()
    await input.fill('')
    await input.pressSequentially(message)
    await input.press('Enter')
    await expect
      .poll(async () => assistants.count(), { timeout: 60_000 })
      .toBeGreaterThan(before)
    const bubble = assistants.last()
    await expect
      .poll(
        async () => {
          const t = await bubble.innerText()
          return ['正在理解', '正在執行', '正在整理'].some((p) => t.includes(p)) ? '' : t
        },
        { timeout: 120_000 },
      )
      .not.toBe('')
  } catch (error) {
    log(`> ⚠️ 這一句沒有回覆（等了 2 分鐘）：\`${message}\``)
    log(`>`)
    log(`> \`${String(error).split('\n')[0].slice(0, 160)}\``)
    log()
  }
}

/** Write what we have so far, so a crash never costs the whole transcript. */
function flush() {
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, lines.join('\n'), 'utf-8')
}

test('七段劇情逐字驗收', async ({ page }) => {
  test.setTimeout(2_400_000)
  await page.setViewportSize({ width: 1440, height: 900 })

  log('# 七段劇情　瀏覽器逐字紀錄')
  log()
  log('真的開 Chromium、逐字打進輸入框、按 Enter，抄畫面上的字。')
  log()
  log('---')
  log()

  // ── 1. 丟檔案、排班（先看漏資料的情況）──────────────────────────
  log('## 1. 丟檔案、排班')
  log()
  await page.goto('/')
  await expect(page.getByText('先放入今天的訂單', { exact: true })).toBeVisible({ timeout: 60_000 })
  await record(page, '1-0', '開啟空白畫面', '1-0-empty')

  await page.getByLabel('上傳 Excel').last().setInputFiles(path.join(samples, 'demo-missing-fields.xlsx'))
  await page.waitForTimeout(4000)
  await record(page, '1-1', '選了 demo-missing-fields.xlsx（故意缺欄位的檔）', '1-1-missing-file')

  await send(page, '請幫我排今天的班')
  await record(page, '1-2', '打「請幫我排今天的班」——看它怎麼講缺什麼', '1-2-missing-plan')

  await page.goto('/')
  await expect(page.getByText('先放入今天的訂單', { exact: true })).toBeVisible({ timeout: 60_000 })
  await page.getByLabel('上傳 Excel').last().setInputFiles(path.join(samples, 'demo-50-tight.xlsx'))
  await send(page, '請幫我排今天的班')
  await expect(page.locator('.topbar-map .map-route-filter').first()).toBeVisible({ timeout: 240_000 })
  await record(page, '1-3', '改用 demo-50-tight.xlsx 重排', '1-3-planned')

  // ── 2. 司機身體不舒服 ─────────────────────────────────────────
  log('## 2. 司機身體不舒服')
  log()
  await send(page, '二號車的阿明今天身體不舒服，不能拿太重，而且要早點下班去看醫生')
  await record(page, '2-1', '打第一句', '2-1-ask')

  await send(page, '今天就好，20公斤以內，五點前要收工')
  await record(page, '2-2', '補上三個答案', '2-2-preview')

  const apply = page.getByRole('button', { name: '套用', exact: true }).last()
  if ((await apply.count()) && (await apply.isVisible())) {
    await apply.click()
    await page.waitForTimeout(8000)
    await record(page, '2-3', '按【套用】', '2-3-applied')
  } else {
    log('### 2-3\n\n找不到【套用】按鈕，這一步沒做成。\n\n---\n')
  }

  // ── 3. 看板拖拉 ──────────────────────────────────────────────
  log('## 3. 看板上把一張單拖到另一台車')
  log()
  const board = page.getByRole('list', { name: '四台車訂單看板' })
  await expect(board).toBeVisible({ timeout: 60_000 })
  const source = board.locator('[data-order-id="ORD-042"]')
  const target = page.getByRole('region', { name: 'VEH-004 訂單欄' })
  await source.scrollIntoViewIfNeeded()
  await source.dragTo(target.locator('.order-board-stop').nth(4))
  await page.waitForTimeout(6000)
  await record(page, '3-1', '把 ORD-042 拖到 VEH-004', '3-1-drag')

  const applyChange = page.getByRole('button', { name: '套用變更', exact: true }).last()
  if ((await applyChange.count()) && (await applyChange.isVisible())) {
    await applyChange.click()
    await page.waitForTimeout(8000)
    await record(page, '3-2', '按【套用變更】', '3-2-drag-applied')
  } else {
    log('### 3-2\n\n找不到【套用變更】，這一步沒做成。\n\n---\n')
  }

  // ── 4. 三張急單 ──────────────────────────────────────────────
  log('## 4. 客戶剛打來，三張急單今天要送')
  log()
  await send(page, '客戶剛打來，三張急單今天要送')
  await record(page, '4-1', '打第一句', '4-1-missing')

  await send(
    page,
    'ORD-101 25.036/121.567 Z3 8公斤 1件 早上\nORD-102 25.079/121.575 Z2 12公斤 1件 早上\nORD-103 25.015/121.462 Z4 5公斤 1件 早上',
  )
  await record(page, '4-2', '三行一次貼進去', '4-2-summary')

  await send(page, '產生插單預覽')
  await page.waitForTimeout(3000)
  const cards = page.locator('button.urgent-card')
  const count = await cards.count()
  log(`**方案卡數量**：${count}`)
  log()
  for (let i = 0; i < count; i += 1) {
    log(`**第 ${i + 1} 張卡的完整內容**`)
    log()
    log('```')
    log((await cards.nth(i).innerText()).trim())
    log('```')
    log()
  }
  await record(page, '4-3', '打「產生插單預覽」', '4-3-cards')

  if (count > 0) {
    await cards.first().click()
    await page.waitForTimeout(4000)
    await record(page, '4-4', '點第一張方案卡', '4-4-card-picked')
    const confirm = page.getByRole('button', { name: '確認套用', exact: true }).last()
    if ((await confirm.count()) && (await confirm.isVisible())) {
      await confirm.click()
      await page.waitForTimeout(10000)
      await record(page, '4-5', '按【確認套用】', '4-5-urgent-applied')
    } else {
      log('### 4-5\n\n找不到【確認套用】，這一步沒做成。\n\n---\n')
    }
  }

  // ── 5. 裝車後又來一張急單 ────────────────────────────────────
  log('## 5. 裝車後，又來一張急單')
  log()
  const startLoading = page.getByRole('button', { name: '開始裝車', exact: true })
  if ((await startLoading.count()) && (await startLoading.isVisible())) {
    await startLoading.click()
    await page.waitForTimeout(6000)
    await record(page, '5-0', '按【開始裝車】', '5-0-loaded')
  } else {
    log('### 5-0\n\n**找不到【開始裝車】按鈕。**\n\n---\n')
  }

  await send(page, '又來一張急單 ORD-104 25.041/121.543 Z3 6公斤 1件 下午')
  await record(page, '5-1', '打急單那一句', '5-1-urgent-104')

  await send(page, '產生插單預覽')
  await page.waitForTimeout(3000)
  const cards2 = page.locator('button.urgent-card')
  const count2 = await cards2.count()
  log(`**方案卡數量**：${count2}`)
  log()
  for (let i = 0; i < count2; i += 1) {
    log(`**第 ${i + 1} 張卡**`)
    log()
    log('```')
    log((await cards2.nth(i).innerText()).trim())
    log('```')
    log()
  }
  await record(page, '5-2', '打「產生插單預覽」', '5-2-cards-after-loading')

  // ── 6. 模擬出發後要提前 ──────────────────────────────────────
  log('## 6. 模擬出發後，客戶要中午前拿到')
  log()
  const depart = page.getByRole('button', { name: '模擬出發', exact: true })
  if ((await depart.count()) && (await depart.isVisible())) {
    await depart.click()
    await page.waitForTimeout(6000)
    await record(page, '6-0', '按【模擬出發】', '6-0-dispatched')
  } else {
    log('### 6-0\n\n**找不到【模擬出發】按鈕。**\n\n---\n')
  }

  const slider = page.getByRole('slider', { name: '配送時間軸' })
  if (await slider.count()) {
    const max = await slider.getAttribute('max')
    if (max) {
      await slider.fill(String(Math.floor(Number(max) / 2)))
      await page.waitForTimeout(4000)
    }
    await record(page, '6-1', '時間軸拉到一半', '6-1-timeline')
  }

  // Pick a stop that is genuinely still undelivered.
  // The stop marker is an empty span; the order id lives in its aria-label,
  // not its text. Reading innerText here silently found nothing and skipped
  // the whole scene.
  const stops = page.locator('.timeline-stop[aria-disabled="false"]')
  const stopCount = await stops.count()
  let pick = ''
  for (let i = 0; i < Math.min(stopCount, 60); i += 1) {
    const label = (await stops.nth(i).getAttribute('aria-label')) || ''
    const m = label.match(/ORD-\d{3}/)
    if (m) {
      pick = m[0]
      break
    }
  }
  log(`**還沒送、可以動的站有 ${stopCount} 個，挑中 ${pick || '(沒挑到)'}**`)
  log()
  if (pick) {
    await send(page, `${pick} 客戶說中午前一定要拿到`)
    await record(page, '6-2', `打「${pick} 客戶說中午前一定要拿到」`, '6-2-priority')
    const confirm2 = page.getByRole('button', { name: '確認套用', exact: true }).last()
    if ((await confirm2.count()) && (await confirm2.isVisible()) && (await confirm2.isEnabled())) {
      await confirm2.click()
      await page.waitForTimeout(10000)
      await record(page, '6-3', '按【確認套用】', '6-3-priority-applied')
    } else {
      log('### 6-3\n\n【確認套用】不存在或按不下去（卡片標示不能套用）。\n\n---\n')
      await record(page, '6-3', '確認套用按不下去時的畫面', '6-3-not-applicable')
    }
  }

  // ── 7. 成效回顧 ──────────────────────────────────────────────
  log('## 7. 今天成效如何、怎麼修正')
  log()
  await send(page, '今天成效如何')
  await record(page, '7-1', '打「今天成效如何」', '7-1-review')

  await send(page, '好，那明天要怎麼改')
  await record(page, '7-2', '打「好，那明天要怎麼改」', '7-2-suggestions')

  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, lines.join('\n'), 'utf-8')
  console.log(`\n寫入 ${out}`)
})
