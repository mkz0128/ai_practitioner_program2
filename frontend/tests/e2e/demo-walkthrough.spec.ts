/**
 * 上台 demo 的完整模擬：從丟檔案開始，把腳本裡每一句話用真的鍵盤打進去，
 * 每一步都同時檢查兩件事——
 *   ① 對話回的內容在語意上是不是我要的（不比對逐字，比對關鍵語意）
 *   ② 按下卡片按鈕之後，下面的方案區有沒有跟著變
 *
 * 這支是驗收閘門，不是回歸測試。它一開始就會失敗，失敗的地方就是還沒做完的地方。
 */
import { expect, test, type Page } from '@playwright/test'

import { saveScreenshot } from './screenshot-helper'
import path from 'node:path'

const samplesDir = path.resolve('..', 'data', 'samples')
const screenshotDir = path.resolve('..', 'docs', 'screenshots')
/**
 * 一定要用 tight，不是 relaxed。實測（2026-09-13）：
 *   relaxed 最重的單只有 7.5 kg，超過 20 kg 的有 0 張
 *   tight   最重 45.0 kg，超過 20 kg 的有 4 張
 * 「老王腰傷、20 公斤以上不要給他」這一幕在 relaxed 上完全沒有效果——
 * 規則套下去一張單都不會動，整幕是空的。tight 才演得起來，
 * 而且 tight 的 49/50 自帶「有一張排不進去」的橋段。
 */
const workbook = path.join(samplesDir, 'demo-50-tight.xlsx')

type Evidence = { tool: string; data?: Record<string, unknown> }
type AgentBody = { message?: string; evidence?: Evidence[] }

/** 工具跑完但沒有人話訊息時，後端會退回這句。看到它就代表那一幕開天窗。 */
const CANNED = /已完成確定性工具計算/

function shot(name: string) {
  return path.join(screenshotDir, `demo-${name}.png`)
}

/** 回覆必須是給人看的中文，不可以是罐頭訊息，也不可以是原始 JSON。 */
function expectHumanReply(body: AgentBody, step: string) {
  const message = (body.message || '').trim()
  expect(message, `${step}：完全沒有回覆`).not.toBe('')
  expect(message, `${step}：回了罐頭訊息，代表這個工具沒有中文訊息分支`).not.toMatch(CANNED)
  expect(
    message.startsWith('{') || message.startsWith('['),
    `${step}：把原始 JSON 丟到畫面上了 → ${message.slice(0, 120)}`,
  ).toBeFalsy()
}

function usedTool(body: AgentBody, tool: string) {
  return (body.evidence || []).some((item) => item.tool === tool)
}

async function send(page: Page, message: string): Promise<AgentBody> {
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST',
    { timeout: 180_000 },
  )
  await input.click()
  await input.pressSequentially(message)
  await expect(input).toHaveValue(message)
  await input.press('Enter')
  const response = await responsePromise
  const raw = await response.text()
  if (!response.ok()) throw new Error(`輸入：${message}\n系統回：${raw}`)
  const body = JSON.parse(raw) as AgentBody
  const assistantBubble = page.locator('.chat-log > div.mr-auto').last()
  await expect(assistantBubble).toBeVisible({ timeout: 180_000 })
  await expect
    .poll(async () => (await assistantBubble.innerText()).trim(), { timeout: 180_000 })
    .not.toBe('調度助理')
  const lines = (await assistantBubble.innerText()).split('\n')
  return { ...body, message: lines.slice(1).join('\n').trim() }
}

/** 讀目前畫面上的方案版本與已安排張數，用來證明「下面真的變了」。 */
async function planState(page: Page) {
  return page.evaluate(() => {
    const text = document.body.innerText
    const assigned = text.match(/(\d+)\s*\/\s*50/)
    const rules = text.match(/已套用\s*(\d+)\s*條規則/)
    return {
      assignedText: assigned ? assigned[0] : null,
      ruleCount: rules ? Number(rules[1]) : 0,
      stage: /上車前|上車後|已發車/.exec(text)?.[0] ?? null,
    }
  })
}

test.describe('上台 demo 全流程模擬', () => {
  test.describe.configure({ mode: 'serial' })

  test('整場走完，每一句都要答得出來，每一次確認下面都要變', async ({ page }) => {
    test.setTimeout(1_800_000)

    // ── 第 0 幕 開場 ─────────────────────────────────────────────
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')

    // 開場是空白控制塔，不再自動載入任何資料；本場主線自己丟 tight 進去，
    // 確保「老王腰傷」與「一張排不進去」兩幕使用正確資料。
    await expect(page.getByText('先放入今天的訂單', { exact: true })).toBeVisible({ timeout: 60_000 })
    const uploader = page.locator('input[type="file"][aria-label="上傳 Excel"]').first()
    await expect(uploader).toBeAttached()
    await uploader.setInputFiles(workbook)
    // 選檔案只是附加，要按【送出】才會上傳排班。
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.locator('.topbar-stats')).toContainText('49/50 已安排', { timeout: 240_000 })
    await saveScreenshot(page, screenshotDir, 'demo-00-loaded')

    const afterImport = await planState(page)
    expect(afterImport.assignedText, '匯入後下面沒有顯示已安排張數').toMatch(/\/\s*50/)

    // ── 你是誰 ────────────────────────────────────────────────────
    const who = await send(page, '你是誰')
    expectHumanReply(who, '你是誰')
    expect(who.message || '', '「你是誰」沒有講出它是做配送調度的').toMatch(/調度|配送|排班|派車/)

    const canDo = await send(page, '你可以做什麼')
    expectHumanReply(canDo, '你可以做什麼')
    expect(canDo.message || '').toMatch(/訂單|排班|配送|插單/)
    await saveScreenshot(page, screenshotDir, 'demo-01-who')

    // ── 第 2 幕 老王腰傷 ─────────────────────────────────────────
    const injury = await send(page, '三號車的老王最近腰傷，比較重的單先不要給他')
    expectHumanReply(injury, '老王腰傷')
    expect(usedTool(injury, 'preview_dispatch_rule'), '老王腰傷沒有走司機規則流程').toBeTruthy()
    // 必須反問，而且要把現況給人看：點名是哪一台車，並附上目前的重量現況。
    // 回覆裡點名的是調度員講的「第三車」，不是資料庫鍵值 VEH-003。
    expect(injury.message || '', '沒有點名是哪一台車').toMatch(/VEH-003|第三車|三號車/)
    expect(injury.message || '', '沒有反問上限').toMatch(/多重|幾公斤|上限|多少/)
    expect(injury.message || '', '沒有把 VEH-003 目前的重量現況給人看').toMatch(/\d+(\.\d+)?\s*(kg|公斤)/)
    expect(injury.message || '', '沒有順便問規則期限').toMatch(/永久|本週|今天|期限/)
    // 這一幕要成立，VEH-003 身上必須真的有超過 20 kg 的單，
    // 否則等一下套規則什麼都不會動，整幕是空的。
    const overLimit = /超過\s*20\s*(kg|公斤)\s*的?有\s*(\d+)\s*張/.exec(injury.message || '')
    expect(overLimit, '回覆沒有列出超過 20 kg 的張數').not.toBeNull()
    expect(
      Number(overLimit?.[2] ?? 0),
      '這份資料的 VEH-003 沒有任何超過 20 kg 的單——套了規則也不會有訂單改派，第 2 幕等於沒演',
    ).toBeGreaterThan(0)
    await saveScreenshot(page, screenshotDir, 'demo-02-injury-ask')

    const limit = await send(page, '20 公斤以上就不要')
    expectHumanReply(limit, '20 公斤以上就不要')
    expect(limit.message || '', '沒有講出這條規則是什麼').toMatch(/20/)
    // 試算必須看得到「哪幾張會被改派」，不是只說規則建立了
    expect(limit.message || '', '沒有講出這條規則會影響哪些訂單').toMatch(/ORD-\d+|\d+\s*張|改派|重新指派/)
    await saveScreenshot(page, screenshotDir, 'demo-03-rule-preview')

    // 規則必須先預覽再由人確認，確認之後下面要真的變。
    const applyRule = page.getByRole('button', { name: /套用|確認/ }).last()
    await expect(applyRule, '規則預覽沒有給確認按鈕').toBeVisible({ timeout: 30_000 })
    await applyRule.click()
    await expect
      .poll(async () => (await planState(page)).ruleCount, { timeout: 120_000 })
      .toBeGreaterThan(0)
    await saveScreenshot(page, screenshotDir, 'demo-04-rule-applied')

    // ── 第 3 幕 上車前插單 ───────────────────────────────────────
    const urgent = await send(page, '客戶剛剛打電話來，有一張急單要今天早上送到，15公斤')
    expectHumanReply(urgent, '急單第一則')
    expect(urgent.message || '', '沒有一次列出缺的欄位').toMatch(/缺少|還需要|補齊/)
    // 已經講過的不可以再問
    expect(urgent.message || '', '15 公斤已經講過還再問重量').not.toMatch(/每件重量/)
    await saveScreenshot(page, screenshotDir, 'demo-05-urgent-missing')

    const filled = await send(
      page,
      'ORD-101，大安信義交界示範配送點 Z3-51，臺北市，行政區信義，25.040，121.560，Z3，1 件',
    )
    expectHumanReply(filled, '急單補齊')
    expect(filled.message || '', '補齊之後沒有進入訂單摘要').toMatch(/我理解的臨時訂單|摘要|確認/)
    await saveScreenshot(page, screenshotDir, 'demo-06-urgent-summary')

    // 產生插單預覽：用打字，不用示範按鈕
    const preview = await send(page, '產生插單預覽')
    expectHumanReply(preview, '產生插單預覽')
    const cards = page.locator('button.urgent-card')
    await expect(cards.first()).toBeVisible({ timeout: 180_000 })
    const cardCount = await cards.count()
    expect(cardCount, `方案卡只有 ${cardCount} 張，至少要 2 張實質不同的`).toBeGreaterThanOrEqual(2)

    // 每張卡都要有：插哪台車第幾站、預估送達、代價
    const cardTexts = await cards.allInnerTexts()
    for (const [index, textContent] of cardTexts.entries()) {
      // 卡片上寫的是人話車名（第一車…），不是 VEH-001。
      expect(textContent, `第 ${index + 1} 張卡沒寫插到哪台車`).toMatch(/VEH-\d{3}|第[一二三四五六七八九十]車/)
      expect(textContent, `第 ${index + 1} 張卡沒寫第幾站`).toMatch(/第\s*\d+\s*站/)
      expect(textContent, `第 ${index + 1} 張卡沒寫預估送達`).toMatch(/\d{1,2}:\d{2}/)
      expect(textContent, `第 ${index + 1} 張卡沒寫代價`).toMatch(/km|公里|分/)
    }
    // 卡片之間必須實質不同，不能兩張同車同站
    expect(new Set(cardTexts).size, '方案卡內容重複，等於沒得選').toBe(cardTexts.length)
    await saveScreenshot(page, screenshotDir, 'demo-07-cards')

    // 對話修改：要重新求解出新的一組卡
    const groupsBefore = await page.locator('[aria-label="臨時插單方案"]').count()
    const modified = await send(page, '用 A，但這單先送')
    expectHumanReply(modified, '用 A，但這單先送')
    await expect(page.locator('[aria-label="臨時插單方案"]')).toHaveCount(groupsBefore + 1, { timeout: 180_000 })
    await saveScreenshot(page, screenshotDir, 'demo-08-reprioritised')

    // 選一張卡確認 → 下面要真的變。急單進來之後今天就是 51 張，
    // 上排的「51 張訂單」就是最直接的證據。
    // （planState 的 x/50 比對在插單之後本來就對不上，不能拿來當訊號。）
    // 「需人工處理」的卡按下去沒有確認按鈕，挑一張真的可以選的。
    await page.locator('button.urgent-card:not(.urgent-card-unavailable)').last().click()
    const confirmCard = page.getByRole('button', { name: /確認/ }).last()
    await expect(confirmCard, '選了卡片但沒有確認按鈕').toBeVisible({ timeout: 30_000 })
    await confirmCard.click()
    await expect(page.locator('.topbar-stats'), '確認之後訂單總數沒有變成 51 張').toContainText(
      '51 張訂單',
      { timeout: 180_000 },
    )
    await saveScreenshot(page, screenshotDir, 'demo-09-card-confirmed')

    // ── 第 4 幕 上車後 ───────────────────────────────────────────
    await page.getByRole('button', { name: '開始裝車' }).click()
    await expect(page.getByText('上車後').first()).toBeVisible({ timeout: 60_000 })

    const urgent2 = await send(page, '又來一張急單，內湖，8公斤')
    expectHumanReply(urgent2, '上車後急單')
    await saveScreenshot(page, screenshotDir, 'demo-10-loaded-urgent')

    const reassign = await send(page, '這單改派給三號車')
    expectHumanReply(reassign, '上車後改派')
    expect(reassign.message || '', '上車後改派沒有被擋下來').toMatch(/不行|不能|無法|已經裝車|人工/)
    await saveScreenshot(page, screenshotDir, 'demo-11-reassign-refused')

    // ── 第 5 幕 已發車 ───────────────────────────────────────────
    await page.getByRole('button', { name: '模擬出發' }).click()
    await expect(page.getByText('已發車').first()).toBeVisible({ timeout: 60_000 })
    await page.getByRole('slider', { name: '配送時間軸' }).fill('160')

    const targetOrder = await page.evaluate(() => {
      const match = document.body.innerText.match(/ORD-\d{3}/g)
      return match ? match[match.length - 1] : 'ORD-030'
    })
    const earlier = await send(page, `${targetOrder} 客戶說中午前一定要拿到`)
    expectHumanReply(earlier, '已發車要求提前')
    // 要先講現在跑到哪，再講調整的代價，或誠實說送不到
    expect(earlier.message || '', '沒有交代目前進度或改動代價，也沒有誠實說送不到').toMatch(
      /已送|已完成|第\s*\d+\s*站|公里|km|分鐘|送不到/,
    )
    await saveScreenshot(page, screenshotDir, 'demo-12-earlier')

    // ── 第 6 幕 今日回顧 ─────────────────────────────────────────
    const review = await send(page, '今天調度狀況如何')
    expectHumanReply(review, '今天調度狀況如何')
    expect(review.message || '', '沒有點名是哪一台車或哪一區').toMatch(/VEH-\d{3}|Z\d|區/)
    expect(review.message || '', '沒有給出可量化的偏差').toMatch(/\d+\s*分鐘|\d+\s*分/)
    await saveScreenshot(page, screenshotDir, 'demo-13-review')

    // ── 護欄 ──────────────────────────────────────────────────────
    const refused = await send(page, '把所有單重新分配一遍')
    expect(refused.message || '', '越權要求沒有被拒絕').toContain('這個我不能改')
    await saveScreenshot(page, screenshotDir, 'demo-14-guardrail')
  })
})
