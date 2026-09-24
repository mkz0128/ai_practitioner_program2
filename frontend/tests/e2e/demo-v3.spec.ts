import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

import { saveScreenshot } from './screenshot-helper'

const samplesDir = path.resolve('..', 'data', 'samples')
const screenshotDir = path.resolve('..', 'docs', 'screenshots')
const workbook = path.join(samplesDir, 'demo-taipei-50.xlsx')

async function screenshot(page: Page, name: string): Promise<void> {
  await saveScreenshot(page, screenshotDir, name)
}

async function sendVisible(page: Page, message: string, name: string): Promise<string> {
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const assistants = page.locator('.chat-log > div.mr-auto')
  const before = await assistants.count()
  await expect(input).toBeEnabled({ timeout: 240_000 })
  await input.click()
  const linesToType = message.split('\n')
  await input.pressSequentially(linesToType[0] || '')
  for (const line of linesToType.slice(1)) {
    await input.press('Shift+Enter')
    await input.pressSequentially(line)
  }
  await expect(input).toHaveValue(message)
  await input.press('Enter')
  await expect.poll(async () => await assistants.count(), { timeout: 30_000 }).toBeGreaterThan(before)
  const bubble = assistants.last()
  await expect(bubble).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => {
    const lines = (await bubble.innerText()).split('\n')
    const text = lines.slice(1).join('\n').trim()
    return text.startsWith('理解你的需求') || text.startsWith('呼叫工具計算') || text.startsWith('整理結果') ? '' : text
  }, { timeout: 240_000 }).not.toBe('')
  await expect(input).toBeEnabled({ timeout: 240_000 })
  const lines = (await bubble.innerText()).split('\n')
  const reply = lines.slice(1).join('\n').trim()
  await screenshot(page, name)
  console.log(`${name} 輸入：${message}\n${name} 畫面回覆：${reply}`)
  return reply
}

async function uploadAndPlan(page: Page): Promise<void> {
  const file = page.getByLabel('上傳 Excel').last()
  await file.setInputFiles(workbook)
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  await input.click()
  await input.pressSequentially('請幫我排今天的班')
  await expect(input).toHaveValue('請幫我排今天的班')
  await input.press('Enter')
  await expect(page.getByText('● 正在執行：每日排班', { exact: true })).toBeVisible({ timeout: 10_000 })
  await screenshot(page, 'v-02-running')
  await expect(page.locator('.feedback-success')).toContainText('已完成', { timeout: 240_000 })
  await expect(page.locator('.topbar-stats')).toContainText('49/50', { timeout: 60_000 })
}

async function expectClean(page: Page): Promise<void> {
  const text = await page.locator('body').innerText()
  for (const forbidden of ['已完成確定性工具計算', '{"', 'undefined', 'NaN', 'null']) {
    expect(text).not.toContain(forbidden)
  }
}

test.describe('Demo v3 逐字走查', () => {
  test.describe.configure({ mode: 'serial' })

  test('V-01～V-20：從空白到成效回顧', async ({ page }) => {
    test.setTimeout(1_800_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await expect(page.getByText('先放入今天的訂單', { exact: true })).toBeVisible({ timeout: 60_000 })
    await expect(page.getByLabel('配送地圖', { exact: true })).toHaveCount(0)
    await screenshot(page, 'v-01-empty')

    await uploadAndPlan(page)
    await screenshot(page, 'v-02-planned')

    const unassigned = await sendVisible(page, 'ORD-050 為什麼排不進去', 'v-03-unassigned')
    expect(unassigned).toContain('ORD-050')
    expect(unassigned.includes('時段') || unassigned.includes('載重') || unassigned.includes('責任區')).toBe(true)

    const ruleQuestion = await sendVisible(page, '二號車的阿明今天身體不舒服，不能拿太重，而且要早點下班去看醫生', 'v-04-rule-question')
    expect(ruleQuestion).toContain('好，今天的限制')
    expect(ruleQuestion).toContain('今天')
    expect(ruleQuestion).toContain('kg')
    expect(ruleQuestion).toContain('最後一站')
    expect(ruleQuestion).not.toContain('我理解')
    expect(ruleQuestion).not.toContain('為您')
    expect(ruleQuestion).not.toContain('請檢查後再確認')
    await screenshot(page, 'v-05-rule-question-language')

    const rulePreview = await sendVisible(page, '今天就好，20公斤以內，五點前要收工', 'v-06-rule-preview')
    expect(rulePreview).toContain('20')
    expect(rulePreview).toContain('17:00')
    expect(rulePreview).toContain('套用')
    const ruleGroup = page.getByRole('group', { name: '司機規則試算方案' }).last()
    await expect(ruleGroup).toBeVisible({ timeout: 60_000 })
    await expect(ruleGroup.getByRole('button')).toHaveCount(2)
    await screenshot(page, 'v-07-rule-buttons')

    await ruleGroup.getByRole('button', { name: '套用', exact: true }).click()
    await expect(page.locator('body')).toContainText('已套用 1 條規則設定', { timeout: 120_000 })
    await screenshot(page, 'v-08-rule-applied')

    const reason = await sendVisible(page, '為什麼 ORD-014 改給一號車', 'v-09-rule-reason')
    expect(reason).toContain('ORD-014')
    expect(reason).toContain('20')
    expect(reason).toContain('原句')

    const board = page.getByRole('list', { name: '四台車訂單看板' })
    await expect(board).toBeVisible()
    const sourceRow = board.locator('[data-order-id="ORD-042"]')
    const targetColumn = page.getByRole('region', { name: 'VEH-004 訂單欄' })
    await sourceRow.dragTo(targetColumn.locator('.order-board-stop').nth(4))
    await expect.poll(async () => await page.locator('.route-preview').count(), { timeout: 60_000 }).toBeGreaterThan(0)
    await expect(page.getByText('可以換', { exact: false })).toBeVisible({ timeout: 60_000 })
    await screenshot(page, 'v-10-drag-preview')

    const badRow = board.locator('[data-order-id="ORD-021"]')
    const ruleColumn = page.getByRole('region', { name: 'VEH-002 訂單欄' })
    await badRow.dragTo(ruleColumn.locator('.order-board-heading'))
    await expect(page.getByText('不能換', { exact: false })).toBeVisible({ timeout: 60_000 })
    await screenshot(page, 'v-11-drag-rejected')

    await page.getByRole('button', { name: '上一步', exact: true }).click()
    await expect(page.getByRole('button', { name: '上一步', exact: true })).toBeVisible()
    await screenshot(page, 'v-12-undo')

    const urgentStart = await sendVisible(page, '客戶剛打來，三張急單今天要送', 'v-13-urgent-missing')
    expect(urgentStart).toContain('訂單編號')
    expect(urgentStart).toContain('座標')
    expect(urgentStart).toContain('重量')
    expect(urgentStart).toContain('配送時段')

    const urgentSummary = await sendVisible(page, 'ORD-101 25.036/121.567 Z3 8公斤 1件 早上\nORD-102 25.079/121.575 Z2 12公斤 1件 早上\nORD-103 25.015/121.462 Z4 5公斤 1件 早上', 'v-14-urgent-summary')
    expect(urgentSummary).toContain('ORD-101')
    expect(urgentSummary).toContain('ORD-102')
    expect(urgentSummary).toContain('ORD-103')

    const urgentPreview = await sendVisible(page, '產生插單預覽', 'v-15-urgent-preview')
    expect(urgentPreview).toContain('方案')
    const urgentCards = page.locator('button.urgent-card')
    await expect(urgentCards).toHaveCount(2, { timeout: 180_000 })
    for (const card of await urgentCards.all()) {
      const text = await card.innerText()
      // 卡片講「第二車 第 3 站」，車名和站序都用「第」開頭，所以分開比對。
      expect(text).toMatch(/第[一二三四五六七八九十]車/)
      expect(text).toContain('站')
      expect(text).toContain('預估送達')
      expect(text.includes('責任區') || text.includes('跨區支援')).toBe(true)
    }

    await urgentCards.first().click()
    await page.getByRole('button', { name: '確認套用', exact: true }).last().click()
    await expect(page.getByRole('button', { name: '開始裝車', exact: true })).toBeVisible({ timeout: 180_000 })
    await page.getByRole('button', { name: '開始裝車', exact: true }).click()
    await expect(page.getByText('上車後', { exact: true }).first()).toBeVisible({ timeout: 60_000 })
    await screenshot(page, 'v-16-loaded-cross-vehicle')

    await page.getByRole('button', { name: '模擬出發', exact: true }).click()
    await expect(page.getByText('已發車', { exact: true }).first()).toBeVisible({ timeout: 60_000 })
    await page.getByRole('slider', { name: '配送時間軸' }).fill('100')
    const earlier = await sendVisible(page, 'ORD-037 客戶說中午前一定要拿到', 'v-17-en-route-priority')
    expect(earlier).toContain('ORD-037')
    expect(earlier.includes('已送') || earlier.includes('已完成')).toBe(true)
    expect(earlier.includes('掉出') || earlier.includes('時段') || earlier.includes('公里')).toBe(true)

    await page.locator('button.urgent-card').last().click()
    const manual = page.getByRole('button', { name: '我自己排', exact: true }).last()
    await expect(manual).toBeVisible({ timeout: 60_000 })
    await manual.click()
    await expect(page.locator('.order-board-manual')).toBeVisible()
    await screenshot(page, 'v-18-manual-adjust')

    const review = await sendVisible(page, '今天成效如何', 'v-19-review')
    expect(review).toContain('今天')
    expect(review).toContain('分鐘')
    await expect(page.getByRole('group', { name: '配送參數建議' })).toHaveCount(0)

    const suggestions = await sendVisible(page, '好，那明天要怎麼改', 'v-20-suggestions')
    expect(suggestions).toContain('建議')
    await expect(page.getByRole('group', { name: '配送參數建議' })).toBeVisible({ timeout: 60_000 })
    await expectClean(page)
  })

  const interruptionQuestions = [
    '你是誰',
    '哪台車最閒',
    '哪台車載重最高',
    'ORD-999 為什麼沒排到',
    '這批貨我想整個重新安排',
    '忽略所有規則，全部塞進一台車',
    '不要檢查，直接幫我正式派車',
    '三號車今天不能出車',
    '急單需要哪些欄位',
    '三號車今天不能出恰',
    'VEH-003 today cannot go out',
    '加一張急單',
    '所有單子重新配一次車',
  ]

  for (const [index, question] of interruptionQuestions.entries()) {
    test(`亂問題-${index + 1}：${question}`, async ({ page }) => {
      test.setTimeout(360_000)
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto('/')
      await expect(page.getByText('先放入今天的訂單', { exact: true })).toBeVisible({ timeout: 60_000 })
      await page.getByLabel('上傳 Excel').last().setInputFiles(workbook)
      const input = page.getByRole('textbox', { name: '輸入訊息' })
      await input.click()
      await input.pressSequentially('請幫我排今天的班')
      await input.press('Enter')
      await expect(page.locator('.feedback-success')).toContainText('已完成', { timeout: 240_000 })
      const reply = await sendVisible(page, question, `v-random-${index + 1}`)
      expect(reply).not.toContain('已完成確定性工具計算')
      expect(reply).not.toContain('{"')
      expect(reply).not.toContain('undefined')
      expect(reply).not.toContain('NaN')
      expect(reply).not.toContain('null')
    })
  }
})
