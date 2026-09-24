import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

import { saveScreenshot } from './screenshot-helper'

const samplesDir = path.resolve('..', 'data', 'samples')
const screenshotDir = path.resolve('..', 'docs', 'screenshots')
const workbook = path.join(samplesDir, 'demo-50-tight.xlsx')

async function screenshot(page: Page, name: string): Promise<void> {
  await saveScreenshot(page, screenshotDir, name)
}

async function sendTyped(page: Page, message: string): Promise<string> {
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const assistants = page.locator('.chat-log > div.mr-auto')
  const before = await assistants.count()
  await expect(input).toBeEnabled({ timeout: 240_000 })
  await input.click()
  await input.pressSequentially(message)
  await expect(input).toHaveValue(message)
  await input.press('Enter')
  await expect.poll(async () => assistants.count(), { timeout: 30_000 }).toBeGreaterThan(before)
  const bubble = assistants.last()
  await expect(bubble).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => {
    const text = await bubble.innerText()
    const pending = ['正在理解', '正在執行', '正在整理']
    return pending.some((phase) => text.includes(phase)) ? '' : text
  }, { timeout: 240_000 }).not.toBe('')
  const lines = (await bubble.innerText()).split('\n')
  return lines.slice(1).join('\n').trim()
}

async function loadPlan(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByText('先放入今天的訂單', { exact: true })).toBeVisible({ timeout: 60_000 })
  await page.getByLabel('上傳 Excel').last().setInputFiles(workbook)
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  await expect(input).toBeEnabled({ timeout: 60_000 })
  await input.click()
  await input.pressSequentially('請幫我排今天的班')
  await expect(input).toHaveValue('請幫我排今天的班')
  await input.press('Enter')
  await expect(page.locator('.topbar-map .map-route-filter').first()).toBeVisible({ timeout: 240_000 })
  await expect(page.getByLabel('配送地圖', { exact: true })).toBeVisible({ timeout: 60_000 })
}

test.describe('前端 polish 驗收', () => {
  test('PL-01～PL-14：對話、按鈕、時間軸與訊息精簡', async ({ page }) => {
    test.setTimeout(1_800_000)
    await loadPlan(page)

    const firstOrder = page.locator('.order-board-order').first()
    await firstOrder.click()
    await expect(firstOrder).toHaveAttribute('aria-expanded', 'true')
    await screenshot(page, 'PL-01-expanded')
    await firstOrder.click()
    await expect(firstOrder).toHaveAttribute('aria-expanded', 'false')
    await screenshot(page, 'PL-01-collapsed')

    const ruleQuestion = await sendTyped(page, '三號車的老王最近腰傷，比較重的單先不要給他')
    await expect(page.getByRole('group', { name: '司機規則試算方案' })).toHaveCount(0)
    expect(ruleQuestion).toContain('好，今天的限制')
    await screenshot(page, 'PL-08-rule-clarification')

    const rulePreview = await sendTyped(page, '20 公斤以上就不要，永久')
    const ruleGroup = page.getByRole('group', { name: '司機規則試算方案' }).last()
    await expect(ruleGroup).toBeVisible({ timeout: 60_000 })
    const apply = ruleGroup.getByRole('button', { name: '套用', exact: true })
    const buttonBox = await apply.boundingBox()
    expect(buttonBox).not.toBeNull()
    expect(buttonBox!.width).toBeGreaterThan(buttonBox!.height)
    await screenshot(page, 'PL-02-horizontal-button')
    expect(rulePreview).not.toContain('原句')
    await screenshot(page, 'PL-03-no-source-utterance')
    expect(rulePreview).toContain('張要改派')
    const orderIds = ['ORD-001', 'ORD-002', 'ORD-003', 'ORD-004', 'ORD-005', 'ORD-006', 'ORD-007', 'ORD-008', 'ORD-009', 'ORD-010', 'ORD-011', 'ORD-012', 'ORD-013', 'ORD-014', 'ORD-015', 'ORD-016', 'ORD-017', 'ORD-018', 'ORD-019', 'ORD-020', 'ORD-021', 'ORD-022', 'ORD-023', 'ORD-024', 'ORD-025', 'ORD-026', 'ORD-027', 'ORD-028', 'ORD-029', 'ORD-030', 'ORD-031', 'ORD-032', 'ORD-033', 'ORD-034', 'ORD-035', 'ORD-036', 'ORD-037', 'ORD-038', 'ORD-039', 'ORD-040', 'ORD-041', 'ORD-042', 'ORD-043', 'ORD-044', 'ORD-045', 'ORD-046', 'ORD-047', 'ORD-048', 'ORD-049', 'ORD-050']
    expect(orderIds.filter((id) => rulePreview.includes(id)).length).toBeLessThan(4)
    await screenshot(page, 'PL-04-rule-summary')

    const who = await sendTyped(page, '你是誰')
    expect(who).not.toContain('呼叫工具計算')
    expect(who).not.toContain('這題比較久')
    await screenshot(page, 'PL-05-waiting-language')

    const highest = await sendTyped(page, '哪台車載重最高')
    expect(highest).toContain('每日排班 · 車輛資料查詢')
    await screenshot(page, 'PL-06-tool-label')

    const identity = await sendTyped(page, '你是誰')
    expect(identity).not.toContain('每日排班')
    const identityBubble = page.locator('.chat-log > div.mr-auto').last()
    await expect(identityBubble.locator('.chat-activity-skill')).toHaveCount(0)
    await screenshot(page, 'PL-07-no-tool-label')

    await apply.click()
    await expect(page.locator('body')).toContainText('因為這條規則', { timeout: 180_000 })
    await expect(page.locator('body')).toContainText('接手')
    await expect(page.locator('body')).toContainText('%')
    await screenshot(page, 'PL-09-rule-load-balance')

    const missing = await sendTyped(page, '客戶剛打來，三張急單今天要送')
    expect(missing).not.toContain('第 1 張')
    expect(missing).toContain('訂單編號')
    expect(missing).toContain('座標')
    expect(missing).toContain('重量')
    expect(missing).toContain('配送時段')
    await screenshot(page, 'PL-10-batch-missing-fields')

    await page.getByRole('button', { name: '開始裝車', exact: true }).click()
    await expect(page.getByText('上車後', { exact: true }).first()).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: '模擬出發', exact: true }).click()
    await expect(page.getByText('已發車', { exact: true }).first()).toBeVisible({ timeout: 60_000 })
    const review = await sendTyped(page, '今天成效如何')
    expect(review).toContain('今天送達')
    expect(review).toContain('總里程')
    expect(review).toContain('平均載重')
    expect(review).not.toContain('已記錄')
    await expect(page.getByRole('group', { name: '配送參數建議' })).toHaveCount(0)
    await screenshot(page, 'PL-11-review-text')

    const suggestions = await sendTyped(page, '那明天要怎麼改')
    expect(suggestions).toContain('建議')
    await expect(page.getByRole('group', { name: '配送參數建議' })).toBeVisible({ timeout: 60_000 })
    await expect(page.getByRole('button', { name: '套用建議', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '先不要', exact: true })).toBeVisible()
    await screenshot(page, 'PL-12-review-suggestions')

    const slider = page.getByRole('slider', { name: '配送時間軸' })
    const maximum = await slider.getAttribute('max')
    expect(maximum).not.toBeNull()
    await slider.fill(maximum!)
    await expect(page.locator('.timeline-stop[aria-disabled="false"]')).toHaveCount(0, { timeout: 60_000 })
    await screenshot(page, 'PL-13-timeline-complete')
    await expect(page.locator('body')).toContainText('目前模擬時刻')
    await screenshot(page, 'PL-14-timeline-clock')

    const body = await page.locator('body').innerText()
    for (const forbidden of ['已完成確定性工具計算', '{"', 'undefined', 'NaN', 'null']) {
      expect(body).not.toContain(forbidden)
    }
  })
})
