import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

import { saveScreenshot } from './screenshot-helper'

const workbook = path.resolve('..', 'data', 'samples', 'demo-50-tight.xlsx')
const screenshotDir = path.resolve('..', 'docs', 'screenshots')

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
    const lines = (await bubble.innerText()).split('\n')
    const text = lines.slice(1).join('\n').trim()
    return ['正在理解', '正在執行', '正在整理'].some((phase) => text.startsWith(phase)) ? '' : text
  }, { timeout: 240_000 }).not.toBe('')
  return (await bubble.innerText()).split('\n').slice(1).join('\n').trim()
}

async function routeSignature(page: Page): Promise<string> {
  return page.locator('.leaflet-overlay-pane path').evaluateAll((paths) =>
    paths.map((pathElement) => pathElement.getAttribute('d') || '').join('|'),
  )
}

async function loadAndDispatch(page: Page): Promise<void> {
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
  await page.getByRole('button', { name: '開始裝車', exact: true }).click()
  await expect(page.getByText('上車後', { exact: true }).first()).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: '模擬出發', exact: true }).click()
  await expect(page.getByText('已發車', { exact: true }).first()).toBeVisible({ timeout: 60_000 })
}

test('F5：發車後提前配送可套用且只重排未送站點', async ({ page }) => {
  test.setTimeout(900_000)
  await loadAndDispatch(page)

  const slider = page.getByRole('slider', { name: '配送時間軸' })
  await slider.fill('100')
  await page.waitForTimeout(1_500)

  const completedBefore = await page.locator('.timeline-stop[aria-disabled="true"]').evaluateAll((nodes) =>
    nodes.map((node) => node.parentElement?.textContent?.trim() || ''),
  )

  // Read each still-undelivered order's visible ETA from the order board and
  // choose one whose existing ETA is genuinely after noon.
  const candidates = page.locator('.order-board-stop').filter({ has: page.locator('.order-board-order') })
  let target = ''
  let targetVehicle = ''
  let targetEta = ''
  for (let index = 0; index < await candidates.count(); index += 1) {
    const row = candidates.nth(index)
    const locked = await row.locator('.order-board-order').getByText('已送達', { exact: true }).count()
    if (locked > 0) continue
    const orderId = await row.getAttribute('data-order-id')
    if (!orderId) continue
    await row.locator('.order-board-order').click()
    const details = row.locator(`[aria-label="${orderId} 配送明細"]`)
    const detailsText = await details.innerText()
    await row.locator('.order-board-order').click()
    const etaMarker = '預估到達：'
    const etaStart = detailsText.indexOf(etaMarker)
    const eta = etaStart >= 0 ? detailsText.slice(etaStart + etaMarker.length).trim().slice(0, 5) : ''
    if (eta.length === 5 && eta >= '12:01') {
      target = orderId
      targetEta = eta
      targetVehicle = (await row.locator('xpath=ancestor::section[1]').getAttribute('aria-label')) || ''
      break
    }
  }
  expect(target, '必須找到尚未送達且原本晚於中午的訂單').not.toBe('')
  console.log(`=== 選定目標 === ${target} ${targetVehicle} 原預估 ${targetEta}`)

  const completedBeforeText = completedBefore.join(' | ')
  const routeBefore = await routeSignature(page)
  const reply = await sendTyped(page, `${target} 客戶說中午前一定要拿到`)
  console.log('=== 提前配送畫面完整回覆 ===\n' + reply)
  await saveScreenshot(page, screenshotDir, 'F5-priority-before-confirm')

  const card = page.locator('button.urgent-card').filter({ hasText: '先送這單' }).first()
  if (await card.count() === 0) {
    const unavailable = page.locator('.urgent-card-unavailable').filter({ hasText: '最快只能到' }).first()
    await expect(unavailable).toBeVisible({ timeout: 60_000 })
    await expect(unavailable).toContainText('不能套用')
    console.log('=== 無法在中午前送達，畫面明確標為需人工處理 ===')
    await saveScreenshot(page, screenshotDir, 'F5-priority-deadline-unmet')
    return
  }
  await expect(card).toBeVisible({ timeout: 60_000 })
  await expect(card).toBeEnabled()
  await card.click()
  const confirm = page.getByRole('button', { name: '確認套用', exact: true }).last()
  await expect(confirm).toBeVisible({ timeout: 60_000 })
  await confirm.click()
  await expect(page.locator('body')).not.toContainText('已出發的規劃不可再次確認', { timeout: 60_000 })
  await expect(page.locator('body')).not.toContainText('已出發的規劃只能確認保留已送站點與車輛指派的途中調整。', { timeout: 60_000 })
  await page.waitForTimeout(2_000)

  const routeAfter = await routeSignature(page)
  const completedAfter = await page.locator('.timeline-stop[aria-disabled="true"]').evaluateAll((nodes) =>
    nodes.map((node) => node.parentElement?.textContent?.trim() || ''),
  )
  const afterText = await page.locator('.chat-log > div.mr-auto').last().innerText()
  console.log('=== 套用後最後一則畫面回覆 ===\n' + afterText.trim())
  console.log(`=== 證據 === routeChanged=${routeBefore !== routeAfter}; completedUnchanged=${completedBeforeText === completedAfter.join(' | ')}`)
  expect(routeAfter).not.toBe(routeBefore)
  expect(completedAfter).toEqual(completedBefore)
  expect(afterText).not.toContain('409')
  await saveScreenshot(page, screenshotDir, 'F5-priority-after-confirm')
})

test('F5：可行的途中提前調整確認後重畫剩餘路線', async ({ page }) => {
  test.setTimeout(900_000)
  await loadAndDispatch(page)
  await page.getByRole('slider', { name: '配送時間軸' }).fill('20')
  await page.waitForTimeout(1_500)

  const completedBefore = await page.locator('.timeline-stop[aria-disabled="true"]').evaluateAll((nodes) =>
    nodes.map((node) => node.parentElement?.textContent?.trim() || ''),
  )
  const row = page.locator('.order-board-stop[data-order-id="ORD-011"]')
  await expect(row).toBeVisible()
  await expect(row).not.toHaveClass(/order-board-stop-locked/)
  const routeBefore = await routeSignature(page)
  const reply = await sendTyped(page, 'ORD-011 客戶說要早點送')
  console.log('=== 可行提前配送畫面完整回覆 ===\n' + reply)
  await saveScreenshot(page, screenshotDir, 'F5-priority-feasible-before')

  const card = page.locator('button.urgent-card').filter({ hasText: '先送這單' }).first()
  await expect(card).toBeVisible({ timeout: 60_000 })
  await card.click()
  await page.getByRole('button', { name: '確認套用', exact: true }).last().click()
  await expect(page.locator('body')).toContainText('已建立新版本', { timeout: 60_000 })
  await expect(page.locator('body')).not.toContainText('已出發的規劃不可再次確認')
  await expect(page.locator('body')).not.toContainText('已出發的規劃只能確認保留已送站點與車輛指派的途中調整。')
  await page.waitForTimeout(2_000)

  const routeAfter = await routeSignature(page)
  const completedAfter = await page.locator('.timeline-stop[aria-disabled="true"]').evaluateAll((nodes) =>
    nodes.map((node) => node.parentElement?.textContent?.trim() || ''),
  )
  const afterText = await page.locator('.chat-log > div.mr-auto').last().innerText()
  console.log('=== 可行提前配送套用後畫面回覆 ===\n' + afterText.trim())
  console.log(`=== 證據 === routeChanged=${routeBefore !== routeAfter}; completedUnchanged=${completedBefore.join(' | ') === completedAfter.join(' | ')}`)
  expect(routeAfter).not.toBe(routeBefore)
  expect(completedAfter).toEqual(completedBefore)
  await saveScreenshot(page, screenshotDir, 'F5-priority-feasible-after')
})
