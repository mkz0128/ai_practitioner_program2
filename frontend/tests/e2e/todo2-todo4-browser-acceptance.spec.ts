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
  // 選檔案只是附加，要按【送出】才會上傳排班。
  await page.getByRole('button', { name: '送出', exact: true }).click()
  await expect(page.locator('.topbar-stats')).toContainText('已安排', { timeout: 120_000 })
  await expect(page.getByLabel('配送地圖', { exact: true })).toBeVisible({ timeout: 30_000 })
}

/**
 * 責任區、城市、行政區與座標必須互相對得起來，否則後端會擋
 * ZONE_MEMBERSHIP_ERROR。這四組是資料集 zones 分頁裡真的存在的搭配。
 */
const ZONES = {
  Z1: { zone: 'Z1', city: '臺北市', district: '中山', latitude: '25.085', longitude: '121.525' },
  Z2: { zone: 'Z2', city: '臺北市', district: '內湖', latitude: '25.083', longitude: '121.590' },
  Z3: { zone: 'Z3', city: '臺北市', district: '信義', latitude: '25.040', longitude: '121.560' },
  Z4: { zone: 'Z4', city: '新北市', district: '板橋', latitude: '25.015', longitude: '121.462' },
} as const

/**
 * 一張資料齊全的急單寫成一行；欄位順序照畫面上要的那份清單。
 * 單號不要用 URG-DEMO-041／ORD-041——那兩個是後端寫死的示範樣本，
 * 無論講什麼欄位都會被樣本蓋掉。
 */
function urgentLine(orderId: string, place: typeof ZONES[keyof typeof ZONES], weightKg: string): string {
  return `${orderId}，配送區域 ${place.zone}，城市${place.city}，行政區${place.district}，`
    + `地點名稱${place.district}示範配送點，緯度 ${place.latitude}，經度 ${place.longitude}，`
    + `包裹件數 1，每件重量 ${weightKg} 公斤，早上配送`
}

/**
 * 「示範一張急單／示範三張急單／示範不可安排」三顆按鈕收掉了：急單現在
 * 一律從對話講進去，講完畫面才給【產生插單預覽】。這個流程跟上台時
 * 調度員做的事一模一樣。
 */
async function urgentPreview(page: Page, sentence: string): Promise<void> {
  const groups = page.getByRole('group', { name: '臨時插單方案' })
  const groupsBefore = await groups.count()
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const summaryPromise = page.waitForResponse((response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST', { timeout: 180_000 })
  await input.fill(sentence)
  await input.press('Enter')
  const summary = await summaryPromise
  const summaryText = await summary.text()
  expect(summary.ok(), summaryText).toBeTruthy()
  // 一張急單走「先確認、再按【產生插單預覽】」；一次講好幾張時系統會直接
  // 算完把方案卡給出來，那條路上沒有那顆按鈕。兩種都要接得住。
  const previewButton = page.getByRole('button', { name: '產生插單預覽' }).last()
  await expect
    .poll(async () => (await previewButton.count()) > 0 || (await groups.count()) > groupsBefore, { timeout: 180_000 })
    .toBe(true)
  if (await groups.count() > groupsBefore) return
  const previewPromise = page.waitForResponse((response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST', { timeout: 180_000 })
  await previewButton.click()
  const preview = await previewPromise
  expect(preview.ok(), await preview.text()).toBeTruthy()
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
  test.setTimeout(900_000)
  const guards = installBrowserGuards(page)
  await importDemoPlan(page)

  await urgentPreview(page, `新增急單 ${urgentLine('URG-F3-001', ZONES.Z3, '5')}`)
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

  // 每一段都重開一次：同一個對話裡連著講第二批急單，上一批的草稿還在，
  // 方案卡會混到前一批的單號，看不出這一批到底排進去沒有。
  await importDemoPlan(page)
  // 照 demo 現場那樣，直接把三行資料貼進去。前面再加一句「三張急單今天要送」
  // 會被當成「使用者在描述多張急單」而走到 preview_multiple_urgent_insert，
  // 那條路回的是整體方案差異，不是可以挑的方案卡。
  await urgentPreview(page, [
    'URG-F3-011 25.036/121.567 Z3 5公斤 1件 早上',
    'URG-F3-012 25.079/121.575 Z2 6公斤 1件 早上',
    'URG-F3-013 25.015/121.462 Z4 4公斤 1件 早上',
  ].join('\n'))
  const batchGroup = page.getByRole('group', { name: '臨時插單方案' }).last()
  await expect(batchGroup).toContainText('URG-F3-011', { timeout: 30_000 })
  await expect(batchGroup).toContainText('URG-F3-012')
  await expect(batchGroup).toContainText('URG-F3-013')
  await saveScreenshot(page, screenshotDir, 'F3-06')

  await importDemoPlan(page)
  // 200 公斤超過任何一台車的載重上限，這張一定排不進去。
  await urgentPreview(page, `新增急單 ${urgentLine('URG-F3-021', ZONES.Z2, '200')}`)
  const unavailableGroup = page.getByRole('group', { name: '臨時插單方案' }).last()
  await expect(unavailableGroup.locator('.urgent-card-unavailable')).toHaveCount(1, { timeout: 30_000 })
  await expect(unavailableGroup).toContainText('URG-F3-021')
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

  await urgentPreview(page, `新增急單 ${urgentLine('URG-F4-001', ZONES.Z3, '5')}`)
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

  // 這兩句點名既有訂單。講「這單」的話，指的是上面那張還沒確認的急單草稿，
  // 系統會去改草稿的時段——那是對的行為，但測不到這裡要測的既有訂單改時段。
  const timeChange = await send('ORD-019 改成下午送')
  expect(timeChange.evidence.some((item) => item.tool === 'change_order_constraint')).toBeTruthy()
  await saveScreenshot(page, screenshotDir, 'F4-05')

  const prioritize = await send('ORD-019 要提前送')
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

  // 200 公斤超過任何一台車的載重上限，這張一定排不進去。
  await urgentPreview(page, `新增急單 ${urgentLine('URG-TIGHT-000', ZONES.Z2, '200')}`)
  const unavailableGroup = page.getByRole('group', { name: '臨時插單方案' }).last()
  await expect(unavailableGroup).toBeVisible({ timeout: 30_000 })
  await expect(unavailableGroup.locator('.urgent-card-unavailable')).toHaveCount(1)
  await expect(unavailableGroup).toContainText(/排不進去|需人工處理/)
  await saveScreenshot(page, screenshotDir, 'tight-unassignable')

  // 重開一次再講第二張，免得上一張 200 公斤的草稿混進這一批方案卡。
  await importDemoPlan(page, tightWorkbook)
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const responsePromise = page.waitForResponse((response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST', { timeout: 180_000 })
  // 內湖屬於 Z2，不是 Z5；責任區對不上後端會擋 ZONE_MEMBERSHIP_ERROR。
  await input.fill('新增急單 URG-TIGHT-001，配送區域 Z2，城市臺北市，行政區內湖，地點標示內湖緊急站，座標 25.083,121.590，上午配送，一件 2 公斤，高優先，請先預覽。')
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
