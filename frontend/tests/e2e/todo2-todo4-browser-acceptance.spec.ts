import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

import { saveScreenshot } from './screenshot-helper'

const relaxedWorkbook = path.resolve('..', 'data', 'samples', 'demo-50-relaxed.xlsx')
const tightWorkbook = path.resolve('..', 'data', 'samples', 'demo-50-tight.xlsx')
const screenshotDir = path.resolve('..', 'docs', 'screenshots')
type AgentEvidence = { tool: string; data: Record<string, unknown> }
type AgentResponse = { evidence: AgentEvidence[] }

async function importDemoPlan(page: Page, workbook = relaxedWorkbook) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByLabel('上傳 Excel').setInputFiles(workbook)
  await expect(page.locator('.topbar-stats')).toContainText('已安排', { timeout: 120_000 })
  await expect(page.getByLabel('配送地圖', { exact: true })).toBeVisible({ timeout: 30_000 })
}

function installBrowserGuards(page: Page) {
  const consoleErrors: string[] = []
  const dispatchRequests: string[] = []
  const googleRequests: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/plans/') && request.url().endsWith('/dispatch')) dispatchRequests.push(request.url())
    if (request.url().includes('googleapis.com')) googleRequests.push(request.url())
  })
  return { consoleErrors, dispatchRequests, googleRequests }
}

test('TODO 2：F3-01～F3-07 插入位置方案卡', async ({ page }) => {
  test.setTimeout(180_000)
  const guards = installBrowserGuards(page)
  await importDemoPlan(page)

  await page.getByRole('button', { name: '示範一張急單' }).click()
  const singleGroup = page.getByRole('group', { name: '臨時插單方案' }).last()
  await expect(singleGroup).toBeVisible({ timeout: 30_000 })
  const singleCards = singleGroup.locator('button.urgent-card')
  await expect(singleCards).toHaveCount(3)
  await saveScreenshot(page, screenshotDir, 'F3-01')

  await expect(singleGroup).toContainText(/最佳車輛最佳位置|次佳車輛最佳位置|只重排/)
  await expect(singleGroup).toContainText(/距離 .*km/)
  await expect(singleGroup).toContainText(/時間 .*分鐘/)
  await expect(singleGroup).toContainText(/換車 0 張/)
  await expect(singleGroup).toContainText(/第 \d+ 站/)
  await saveScreenshot(page, screenshotDir, 'F3-02')

  await singleCards.nth(0).click()
  await expect(singleCards.nth(0)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('status').filter({ hasText: '已選擇' })).toBeVisible()
  await saveScreenshot(page, screenshotDir, 'F3-03')

  await singleCards.nth(1).focus()
  await page.keyboard.press('Enter')
  await expect(singleCards.nth(1)).toHaveAttribute('aria-pressed', 'true')
  await saveScreenshot(page, screenshotDir, 'F3-04')

  await expect(singleGroup.locator('.urgent-card-unavailable')).toHaveCount(0)
  await expect(singleCards).toHaveCount(3)
  await saveScreenshot(page, screenshotDir, 'F3-05')

  await page.getByRole('button', { name: '示範三張急單' }).click()
  const batchGroup = page.getByRole('group', { name: '臨時插單方案' }).last()
  await expect(batchGroup).toContainText('URG-DEMO-041', { timeout: 30_000 })
  await expect(batchGroup).toContainText('URG-DEMO-052')
  await expect(batchGroup).toContainText('URG-DEMO-053')
  await saveScreenshot(page, screenshotDir, 'F3-06')

  await page.getByRole('button', { name: '示範不可安排' }).click()
  const unavailableGroup = page.getByRole('group', { name: '臨時插單方案' }).last()
  await expect(unavailableGroup.locator('.urgent-card-unavailable')).toHaveCount(1, { timeout: 30_000 })
  await expect(unavailableGroup).toContainText('URG-DEMO-053')
  await expect(unavailableGroup).toContainText('需人工處理')
  await saveScreenshot(page, screenshotDir, 'F3-07')

  expect(guards.consoleErrors).toEqual([])
  expect(guards.dispatchRequests).toEqual([])
  expect(guards.googleRequests).toEqual([])
})

test('TODO 4：F4 全部與 F5-01～F5-05 階段驗收', async ({ page }) => {
  test.setTimeout(360_000)
  const guards = installBrowserGuards(page)
  await importDemoPlan(page)
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const send = async (message: string): Promise<AgentResponse> => {
    const responsePromise = page.waitForResponse((response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST')
    await input.fill(message)
    await input.press('Enter')
    const response = await responsePromise
    expect(response.ok(), await response.text()).toBeTruthy()
    return await response.json() as AgentResponse
  }

  await page.getByRole('button', { name: '開始裝車' }).click()
  await expect(page.getByText('上車後').first()).toBeVisible({ timeout: 30_000 })
  await saveScreenshot(page, screenshotDir, 'F4-01')

  await page.getByRole('button', { name: '示範一張急單' }).click()
  const loadedGroup = page.getByRole('group', { name: '臨時插單方案' }).last()
  await expect(loadedGroup).toBeVisible({ timeout: 30_000 })
  await expect(loadedGroup.locator('button.urgent-card')).toHaveCount(1)
  await expect(loadedGroup).toContainText('換車 0 張')
  await saveScreenshot(page, screenshotDir, 'F4-02')

  const vehicleMove = await send('這單改派給四號車')
  expect(vehicleMove.evidence.some((item) => item.tool === 'reassign_order_preview' && item.data.status === 'VEHICLE_ASSIGNMENT_FROZEN')).toBeTruthy()
  await expect(page.locator('.chat-log > div').last()).toContainText(/卸貨重裝|上車後|車輛指派已凍結/, { timeout: 60_000 })
  await saveScreenshot(page, screenshotDir, 'F4-03')

  const rejectAll = await send('全部重排')
  expect(rejectAll.evidence.some((item) => item.tool === 'reject_unsupported_change' || (item.tool === 'plan_dispatch' && item.data.status === 'FULL_REPLAN_NOT_ALLOWED'))).toBeTruthy()
  await expect(page.locator('.chat-log > div').last()).toContainText(/不能改|不支援|拒絕|重排/, { timeout: 60_000 })
  await saveScreenshot(page, screenshotDir, 'F4-04')

  const timeChange = await send('這單改成下午送')
  expect(timeChange.evidence.some((item) => item.tool === 'change_order_constraint')).toBeTruthy()
  await saveScreenshot(page, screenshotDir, 'F4-05')

  const prioritize = await send('先送這單')
  expect(prioritize.evidence.some((item) => item.tool === 'prioritize_order_preview')).toBeTruthy()
  await saveScreenshot(page, screenshotDir, 'F4-06')

  await page.getByRole('button', { name: '退回上車前（需人工處理）' }).click()
  await expect(page.getByRole('alert')).toContainText(/卸貨重裝|人工處理/)
  await saveScreenshot(page, screenshotDir, 'F4-07')

  await page.getByRole('button', { name: '模擬出發' }).click()
  await expect(page.getByText('已發車').first()).toBeVisible({ timeout: 30_000 })
  const timeline = page.getByRole('slider', { name: '配送時間軸' })
  await timeline.fill('300')
  await expect(timeline).toHaveValue('300')
  await saveScreenshot(page, screenshotDir, 'F5-01')

  await expect(page.getByText('實心：已送')).toHaveCount(4)
  await expect(page.getByText('方塊：目前')).toHaveCount(4)
  await expect(page.getByText('空心：未送')).toHaveCount(4)
  await saveScreenshot(page, screenshotDir, 'F5-02')

  await expect(page.getByText('實心：已送').first()).toBeVisible()
  await expect(page.getByText('空心：未送').first()).toBeVisible()
  await saveScreenshot(page, screenshotDir, 'F5-03')

  const completedStops = page.locator('[aria-disabled="true"]')
  await expect(completedStops.first()).toBeVisible()
  await expect(completedStops.first()).toHaveAttribute('draggable', 'false')
  await saveScreenshot(page, screenshotDir, 'F5-04')

  await timeline.fill('0')
  await expect(timeline).toHaveValue('0')
  const dispatchedPrioritize = await send('ORD-019 要提前')
  expect(dispatchedPrioritize.evidence.some((item) => item.tool === 'prioritize_order_preview')).toBeTruthy()
  await saveScreenshot(page, screenshotDir, 'F5-05')

  expect(guards.consoleErrors).toEqual([])
  expect(guards.dispatchRequests).toEqual([])
  expect(guards.googleRequests).toEqual([])
})

test('TODO 2：tight 50 單的不可安排卡與距離代價差異', async ({ page }) => {
  test.setTimeout(360_000)
  const guards = installBrowserGuards(page)
  await importDemoPlan(page, tightWorkbook)

  await page.getByRole('button', { name: '示範不可安排' }).click()
  const unavailableGroup = page.getByRole('group', { name: '臨時插單方案' }).last()
  await expect(unavailableGroup).toBeVisible({ timeout: 30_000 })
  await expect(unavailableGroup.locator('.urgent-card-unavailable')).toHaveCount(1)
  await expect(unavailableGroup).toContainText(/排不進去|需人工處理/)
  await saveScreenshot(page, screenshotDir, 'tight-unassignable')

  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const responsePromise = page.waitForResponse((response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST', { timeout: 180_000 })
  await input.fill('新增急單 URG-TIGHT-001，配送區域 Z5，城市臺北市，行政區內湖，地點標示內湖緊急站，座標 25.083,121.590，上午配送，一件 2 公斤，高優先，請先預覽。')
  await input.press('Enter')
  const summaryResponse = await responsePromise
  expect(summaryResponse.ok(), await summaryResponse.text()).toBeTruthy()
  await expect(page.getByRole('button', { name: '產生插單預覽' })).toBeVisible({ timeout: 180_000 })

  const previewResponsePromise = page.waitForResponse((response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST', { timeout: 180_000 })
  await page.getByRole('button', { name: '產生插單預覽' }).click()
  const previewResponse = await previewResponsePromise
  const previewBody = await previewResponse.json() as AgentResponse
  expect(previewResponse.ok()).toBeTruthy()
  const workflow = previewBody.evidence.find((item) => item.tool === 'urgent_insertion_workflow')
  const options = Array.isArray(workflow?.data.options) ? workflow.data.options as Array<{ selectable?: boolean; cost?: { distance_delta_km?: number | null } }> : []
  const costs = options.filter((option) => option.selectable && typeof option.cost?.distance_delta_km === 'number').map((option) => option.cost?.distance_delta_km as number)
  expect(costs.length).toBeGreaterThanOrEqual(2)
  expect(Math.max(...costs) - Math.min(...costs)).toBeGreaterThan(3)
  const costGroup = page.getByRole('group', { name: '臨時插單方案' }).last()
  await expect(costGroup.locator('button.urgent-card')).toHaveCount(3)
  await expect(costGroup).toContainText(/距離 .*km/)
  await saveScreenshot(page, screenshotDir, 'tight-cost-gap')

  expect(guards.consoleErrors).toEqual([])
  expect(guards.dispatchRequests).toEqual([])
  expect(guards.googleRequests).toEqual([])
})
