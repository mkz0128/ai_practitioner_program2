import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

import { saveScreenshot } from './screenshot-helper'

const relaxedWorkbook = path.resolve('..', 'data', 'samples', 'demo-50-relaxed.xlsx')
const screenshotDir = path.resolve('..', 'docs', 'screenshots')

type Evidence = { tool: string; data: Record<string, unknown> }
type AgentResponse = {
  message?: string
  evidence?: Evidence[]
  error?: { code?: string; message?: string }
}
type SentResponse = { status: number; raw: string; body: AgentResponse }
type BrowserGuards = { consoleErrors: string[]; dispatchRequests: number; googleApis: number; expectedHttpErrorMessages: number }

test.describe.configure({ mode: 'serial' })

const browserGuards = new WeakMap<Page, BrowserGuards>()

test.beforeEach(async ({ page }) => {
  const guards: BrowserGuards = { consoleErrors: [], dispatchRequests: 0, googleApis: 0, expectedHttpErrorMessages: 0 }
  browserGuards.set(page, guards)
  page.on('console', (message) => {
    if (message.type() === 'error') guards.consoleErrors.push(message.text())
  })
  page.on('request', (request) => {
    const url = request.url()
    if (url.includes('/api/v1/plans/') && url.includes('/dispatch')) guards.dispatchRequests += 1
    if (url.includes('googleapis')) guards.googleApis += 1
  })
})

test.afterEach(async ({ page }) => {
  const guards = browserGuards.get(page)
  expect(guards).toBeTruthy()
  const expectedResourceErrors = guards?.consoleErrors.filter((message) => message === 'Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)') ?? []
  const unexpectedConsoleErrors = guards?.consoleErrors.filter((message) => message !== 'Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)') ?? []
  expect(expectedResourceErrors).toHaveLength(guards?.expectedHttpErrorMessages ?? 0)
  expect(unexpectedConsoleErrors, `Console errors: ${JSON.stringify(unexpectedConsoleErrors)}`).toEqual([])
  expect(guards?.dispatchRequests).toBe(0)
  expect(guards?.googleApis).toBe(0)
})

async function clearActiveRules(page: Page) {
  const response = await page.request.get('/api/v1/dispatch-rules')
  expect(response.ok(), await response.text()).toBeTruthy()
  const body = await response.json() as { rules: Array<{ rule_id: string; active_now: boolean }> }
  for (const rule of body.rules.filter((item) => item.active_now)) {
    const stopped = await page.request.post(`/api/v1/dispatch-rules/${encodeURIComponent(rule.rule_id)}/deactivate`)
    expect(stopped.ok(), await stopped.text()).toBeTruthy()
  }
}

async function startPlan(page: Page) {
  const sessionId = `DEMO-QA-${test.info().testId}`
  await page.route('**/api/v1/agent/chat', async (route) => {
    const request = route.request()
    const payload = JSON.parse(request.postData() || '{}') as Record<string, unknown>
    payload.session_id = sessionId
    await route.continue({ postData: JSON.stringify(payload) })
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await clearActiveRules(page)
  await page.reload()
  await page.getByLabel('上傳 Excel').setInputFiles(relaxedWorkbook)
  // 選檔案只是附加，要按【送出】才會上傳排班。
  await page.getByRole('button', { name: '送出', exact: true }).click()
  // 排班完成的綠色提示拿掉了，改用上排的統計列當完成訊號。
  await expect(page.locator('.topbar-stats')).toContainText('已安排', { timeout: 180_000 })
  await expect(page.getByLabel('配送地圖', { exact: true })).toBeVisible({ timeout: 30_000 })
}

function replyText(body: AgentResponse, raw: string): string {
  if (typeof body.message === 'string') return body.message
  if (typeof body.error?.message === 'string') return body.error.message
  return raw
}

function logReply(id: string, input: string, result: SentResponse) {
  console.log(`${id} 實際輸入：${input}`)
  console.log(`${id} 系統實際回覆逐字：${replyText(result.body, result.raw)}`)
}

function findEvidence(body: AgentResponse, tool: string): Record<string, unknown> | undefined {
  return body.evidence?.find((item) => item.tool === tool)?.data
}

async function keyboardSend(page: Page, id: string, inputText: string, allowError = false): Promise<SentResponse> {
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const responsePromise = page.waitForResponse((response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST', { timeout: 180_000 })
  await input.click()
  await input.pressSequentially(inputText)
  await expect(input).toHaveValue(inputText)
  await input.press('Enter')
  const response = await responsePromise
  const raw = await response.text()
  const body = JSON.parse(raw) as AgentResponse
  logReply(id, inputText, { status: response.status(), raw, body })
  if (!allowError) expect(response.ok(), `${id} 輸入：${inputText}\n系統實際回覆：${raw}`).toBeTruthy()
  await expect(page.locator('.processing-bubble')).toHaveCount(0, { timeout: 180_000 })
  return { status: response.status(), raw, body }
}

async function clickPreview(page: Page, id: string, allowError = false): Promise<SentResponse> {
  if (allowError) {
    const guards = browserGuards.get(page)
    if (guards) guards.expectedHttpErrorMessages += 1
  }
  const button = page.getByRole('button', { name: '產生插單預覽' }).last()
  await expect(button).toBeVisible({ timeout: 180_000 })
  const responsePromise = page.waitForResponse((response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST', { timeout: 180_000 })
  await button.click()
  const response = await responsePromise
  const raw = await response.text()
  const body = JSON.parse(raw) as AgentResponse
  logReply(id, '按下「產生插單預覽」', { status: response.status(), raw, body })
  if (!allowError) expect(response.ok(), `${id} 系統實際回覆：${raw}`).toBeTruthy()
  await expect(page.locator('.processing-bubble')).toHaveCount(0, { timeout: 180_000 })
  return { status: response.status(), raw, body }
}

async function shot(page: Page, id: string) {
  await saveScreenshot(page, screenshotDir, id)
}

test('Q-01 司機請假', async ({ page }) => {
  test.setTimeout(600_000)
  await startPlan(page)
  const result = await keyboardSend(page, 'Q-01', '三號車今天不能出車')
  const data = findEvidence(result.body, 'change_vehicle_availability')
  expect(data?.status).toBe('PREVIEWED')
  expect(data?.affected_vehicle_id).toBe('VEH-003')
  expect(data?.plan).toBeTruthy()
  await shot(page, 'Q-01')
})

test('Q-02 客戶取消', async ({ page }) => {
  test.setTimeout(600_000)
  await startPlan(page)
  const result = await keyboardSend(page, 'Q-02', 'ORD-019 今天不用送了')
  const data = findEvidence(result.body, 'remove_order_preview')
  expect(data?.status).toBe('PREVIEWED')
  expect(data?.order_id).toBe('ORD-019')
  expect(result.body.message || '').toContain('今天不配送')
  await shot(page, 'Q-02')
})

test('Q-03 十張急單', async ({ page }) => {
  test.setTimeout(1_200_000)
  await startPlan(page)
  const orders = Array.from({ length: 10 }, (_, index) => {
    const orderId = `Q03-${String(index + 1).padStart(3, '0')}`
    return `訂單編號 ${orderId}，配送區域 Z3，城市臺北市，行政區信義，地點標示信義示範站 ${orderId}，緯度 25.033，經度 121.565，包裹件數 1，每件重量 1 公斤，早上配送`
  }).join('；')
  const summary = await keyboardSend(page, 'Q-03', `請一次新增十張急單：${orders}。`)
  // 張數多的時候系統會直接一次算完（preview_multiple_urgent_insert），
  // 沒有【產生插單預覽】那一步。十張都收到、而且沒有出錯，才是這題要看的。
  const batch = findEvidence(summary.body, 'preview_multiple_urgent_insert')
  if (batch) {
    expect(batch.status, `系統實際回覆：${summary.body.message}`).toBe('PREVIEWED')
    expect((batch.order_ids as string[] | undefined)?.length).toBe(10)
    await shot(page, 'Q-03')
    return
  }
  const data = findEvidence(summary.body, 'urgent_insertion_workflow')
  expect(data, `系統實際回覆：${summary.body.message}`).toBeTruthy()
  const draftOrders = Array.isArray(data?.orders) ? data.orders : []
  expect(draftOrders.length).toBe(10)
  const preview = await clickPreview(page, 'Q-03-preview')
  expect(preview.body.error).toBeUndefined()
  const previewData = findEvidence(preview.body, 'urgent_insertion_workflow')
  const options = Array.isArray(previewData?.options) ? previewData.options : []
  expect(options.length).toBeGreaterThan(0)
  await expect(page.getByRole('group', { name: '臨時插單方案' }).last()).toBeVisible({ timeout: 180_000 })
  await shot(page, 'Q-03')
})

test('Q-04 同客戶兩張同座標急單', async ({ page }) => {
  test.setTimeout(900_000)
  await startPlan(page)
  const inputText = '請新增兩張急單：訂單編號 Q04-001，配送區域 Z3，城市臺北市，行政區信義，地點標示同客戶信義站，緯度 25.033，經度 121.565，包裹件數 1，每件重量 1 公斤，早上配送；訂單編號 Q04-002，配送區域 Z3，城市臺北市，行政區信義，地點標示同客戶信義站，緯度 25.033，經度 121.565，包裹件數 1，每件重量 1 公斤，早上配送。'
  const summary = await keyboardSend(page, 'Q-04', inputText)
  // 兩張同座標的單也可能走一次算完那條路，那條路沒有【產生插單預覽】。
  const batch = findEvidence(summary.body, 'preview_multiple_urgent_insert')
  if (batch) {
    expect(batch.status, `系統實際回覆：${summary.body.message}`).toBe('PREVIEWED')
    expect((batch.order_ids as string[] | undefined)?.length).toBe(2)
    await shot(page, 'Q-04')
    return
  }
  const data = findEvidence(summary.body, 'urgent_insertion_workflow')
  expect(data, `系統實際回覆：${summary.body.message}`).toBeTruthy()
  const draftOrders = Array.isArray(data?.orders) ? data.orders : []
  expect(draftOrders.length).toBe(2)
  const preview = await clickPreview(page, 'Q-04-preview')
  expect(preview.body.error).toBeUndefined()
  const previewData = findEvidence(preview.body, 'urgent_insertion_workflow')
  expect(previewData).toBeTruthy()
  await expect(page.getByRole('group', { name: '臨時插單方案' }).last()).toBeVisible({ timeout: 180_000 })
  await shot(page, 'Q-04')
})

test('Q-05 評審自創說法', async ({ page }) => {
  test.setTimeout(600_000)
  await startPlan(page)
  const result = await keyboardSend(page, 'Q-05', '這批貨我想重新安排一下')
  expect(result.body.error).toBeUndefined()
  expect((result.body.message || '').length).toBeGreaterThan(0)
  await shot(page, 'Q-05')
})

test('Q-06 打錯字', async ({ page }) => {
  test.setTimeout(600_000)
  await startPlan(page)
  const result = await keyboardSend(page, 'Q-06', '三號車今天不能出恰')
  expect(result.body.error).toBeUndefined()
  expect((result.body.message || '').length).toBeGreaterThan(0)
  await shot(page, 'Q-06')
})

test('Q-07 中英混雜', async ({ page }) => {
  test.setTimeout(600_000)
  await startPlan(page)
  const result = await keyboardSend(page, 'Q-07', 'VEH-003 today cannot go out')
  expect(result.body.error).toBeUndefined()
  expect(findEvidence(result.body, 'change_vehicle_availability')).toBeTruthy()
  await shot(page, 'Q-07')
})

test('Q-08 只講一半的急單', async ({ page }) => {
  test.setTimeout(600_000)
  await startPlan(page)
  const result = await keyboardSend(page, 'Q-08', '加一張急單')
  const data = findEvidence(result.body, 'urgent_insertion_workflow')
  expect(data?.stage).toBe('COLLECTING')
  const missingByOrder = Array.isArray(data?.missing_by_order) ? data.missing_by_order : []
  expect(missingByOrder.length).toBeGreaterThan(0)
  expect(result.body.message || '').toContain('還缺少幾個欄位才能算')
  await expect(page.getByText('還缺少幾個欄位才能算', { exact: false }).last()).toBeVisible({ timeout: 30_000 })
  await shot(page, 'Q-08')
})

test('Q-09 插單、改規則、插單、改時段不重整', async ({ page }) => {
  test.setTimeout(1_200_000)
  await startPlan(page)
  let navigationCount = 0
  page.on('framenavigated', () => { navigationCount += 1 })

  const firstInsert = await keyboardSend(page, 'Q-09-1', '新增急單 Q09-001，配送區域 Z3，城市臺北市，行政區信義，地點標示信義連續測試站，緯度 25.033，經度 121.565，包裹件數 1，每件重量 2 公斤，早上配送，請先預覽。')
  expect(findEvidence(firstInsert.body, 'urgent_insertion_workflow')).toBeTruthy()
  await clickPreview(page, 'Q-09-1-preview')

  // 放掉第一張的草稿再往下走。草稿留著的話，第二張會被讀成「又多了幾張」而
  // 走到批次求解那條路——那條路一次算完，沒有【產生插單預覽】可以按，
  // 也就測不到這一題要測的「驗證失敗之後草稿還在、可以改一個欄位」。
  await keyboardSend(page, 'Q-09-1-cancel', '算了不要了')

  const rule = await keyboardSend(page, 'Q-09-2', '三號車單趟距離上限 30 公里')
  expect(findEvidence(rule.body, 'preview_dispatch_rule')).toBeTruthy()

  const secondInsert = await keyboardSend(page, 'Q-09-3', '新增急單 Q09-002，配送區域 Z4，城市臺北市，行政區內湖，地點標示內湖連續測試站，緯度 25.083，經度 121.590，包裹件數 1，每件重量 2 公斤，早上配送，請先預覽。')
  expect(findEvidence(secondInsert.body, 'urgent_insertion_workflow')).toBeTruthy()
  const failedPreview = await clickPreview(page, 'Q-09-3-preview-invalid', true)
  expect(failedPreview.status).toBe(422)
  expect(failedPreview.body.error?.message || failedPreview.raw).toContain('插單資料未通過驗證')
  const correction = await keyboardSend(page, 'Q-09-3-correction', '行政區是信義')
  const correctionData = findEvidence(correction.body, 'urgent_insertion_workflow')
  expect(correctionData).toBeTruthy()
  const correctedOrders = Array.isArray(correctionData?.orders) ? correctionData.orders : []
  const correctedOrder = correctedOrders.find((item) => item !== null && typeof item === 'object' && (item as Record<string, unknown>).order_id === 'Q09-002')
  expect((correctedOrder as Record<string, unknown> | undefined)?.district).toBe('信義')

  const timeChange = await keyboardSend(page, 'Q-09-4', 'ORD-019 改成下午送')
  expect(findEvidence(timeChange.body, 'change_order_constraint')).toBeTruthy()
  expect(navigationCount).toBe(0)
  await shot(page, 'Q-09')
})

test('Q-10 冷啟動匯入計時', async ({ page }) => {
  test.setTimeout(600_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const startedAt = performance.now()
  await page.getByLabel('上傳 Excel').setInputFiles(relaxedWorkbook)
  // 選檔案只是附加，要按【送出】才會上傳排班。
  await page.getByRole('button', { name: '送出', exact: true }).click()
  // 排班完成的綠色提示拿掉了，改用上排的統計列當完成訊號。
  await expect(page.locator('.topbar-stats')).toContainText('已安排', { timeout: 180_000 })
  const elapsedSeconds = (performance.now() - startedAt) / 1000
  const reply = await page.locator('.topbar-stats').innerText()
  console.log(`Q-10 實際輸入：上傳 ${path.basename(relaxedWorkbook)}`)
  console.log(`Q-10 系統實際回覆逐字：${reply}`)
  console.log(`Q-10 冷啟動匯入實際秒數：${elapsedSeconds.toFixed(3)}`)
  expect(elapsedSeconds).toBeGreaterThan(0)
  await shot(page, 'Q-10')
})
