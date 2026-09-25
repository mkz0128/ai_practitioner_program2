import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

import { saveScreenshot } from './screenshot-helper'

const samplesDir = path.resolve('..', 'data', 'samples')
const screenshotDir = path.resolve('..', 'docs', 'screenshots')
const mappedWorkbook = path.join(samplesDir, 'demo-mapped-50.xlsx')
const missingWorkbook = path.join(samplesDir, 'demo-missing-fields.xlsx')
const tightWorkbook = path.join(samplesDir, 'demo-50-tight.xlsx')

type Evidence = { tool: string; data: Record<string, unknown> }
type AgentBody = { message?: string; evidence?: Evidence[]; error?: { code?: string; message?: string } }
type PlanBody = {
  plan_id: string
  version: number
  stage?: string
  unassigned_orders?: string[]
  vehicles?: Array<{
    vehicle_id: string
    total_distance_m?: number
    stops?: Array<{ order_id: string; reason?: { summary?: string } }>
  }>
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

async function clearActiveRules(page: Page) {
  const response = await page.request.get('/api/v1/dispatch-rules')
  expect(response.ok(), await response.text()).toBeTruthy()
  const body = await response.json() as { rules: Array<{ rule_id: string; active_now: boolean }> }
  for (const rule of body.rules.filter((item) => item.active_now)) {
    const stopped = await page.request.post(`/api/v1/dispatch-rules/${encodeURIComponent(rule.rule_id)}/deactivate`)
    expect(stopped.ok(), await stopped.text()).toBeTruthy()
  }
}

async function typeAndSend(page: Page, message: string): Promise<AgentBody> {
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const responsePromise = page.waitForResponse((response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST', { timeout: 180_000 })
  await input.click()
  // 對話框的 Enter 就是送出，多行要用 Shift+Enter 換行，
  // 不然第一行就先送出去了。
  const lines = message.split('\n')
  await input.pressSequentially(lines[0] || '')
  for (const line of lines.slice(1)) {
    await input.press('Shift+Enter')
    await input.pressSequentially(line)
  }
  await input.press('Enter')
  const response = await responsePromise
  const raw = await response.text()
  let body: AgentBody
  try { body = JSON.parse(raw) as AgentBody } catch { throw new Error(`輸入：${message}\n系統實際回覆：${raw}`) }
  if (!response.ok()) throw new Error(`輸入：${message}\n系統實際回覆：${raw}`)
  return body
}

async function keyboardTypeAndSend(page: Page, message: string): Promise<AgentBody> {
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const responsePromise = page.waitForResponse((response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST', { timeout: 180_000 })
  await input.click()
  await input.pressSequentially(message)
  await expect(input).toHaveValue(message)
  await input.press('Enter')
  const response = await responsePromise
  const raw = await response.text()
  let body: AgentBody
  try { body = JSON.parse(raw) as AgentBody } catch { throw new Error(`輸入：${message}\n系統實際回覆：${raw}`) }
  if (!response.ok()) throw new Error(`輸入：${message}\n系統實際回覆：${raw}`)
  return body
}

/**
 * 責任區、城市、行政區與座標必須互相對得起來，否則後端會擋
 * ZONE_MEMBERSHIP_ERROR。這幾組是資料集 zones 分頁裡真的存在的搭配。
 */
const ZONES = {
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
 * 「示範三張急單／示範不可安排／示範一張急單」三顆按鈕收掉了：急單現在
 * 一律從對話講進去，講完畫面才給【產生插單預覽】——跟上台時一樣。
 */
async function urgentPreview(page: Page, sentence: string): Promise<void> {
  const groups = page.getByRole('group', { name: '臨時插單方案' })
  const groupsBefore = await groups.count()
  await typeAndSend(page, sentence)
  // 一張急單走「先確認、再按【產生插單預覽】」；一次講好幾張時系統會直接
  // 算完把方案卡給出來，那條路上沒有那顆按鈕。兩種都要接得住。
  const previewButton = page.getByRole('button', { name: '產生插單預覽' }).last()
  await expect
    .poll(async () => (await previewButton.count()) > 0 || (await groups.count()) > groupsBefore, { timeout: 180_000 })
    .toBe(true)
  if (await groups.count() > groupsBefore) return
  const previewResponse = page.waitForResponse((response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST', { timeout: 180_000 })
  await previewButton.click()
  const response = await previewResponse
  expect(response.ok(), await response.text()).toBeTruthy()
}

function evidence(body: AgentBody, tool: string): Record<string, unknown> {
  const item = body.evidence?.find((entry) => entry.tool === tool)
  expect(item, `找不到 evidence tool：${tool}；系統回覆：${body.message || JSON.stringify(body)}`).toBeTruthy()
  return item?.data || {}
}

async function mark(page: Page, id: string) {
  await saveScreenshot(page, screenshotDir, id)
}

async function reset(page: Page) {
  const resetButton = page.getByRole('button', { name: '重新開始' })
  if (await resetButton.count() > 0) {
    await resetButton.click()
    await expect(page.getByText('先放入今天的訂單', { exact: true })).toBeVisible({ timeout: 30_000 })
    return
  }
  // 匯入失敗時根本沒有方案, 上排那顆「重新開始」不存在; 而對話裡已經有訊息,
  // 開場的「先放入今天的訂單」也就收起來。確認輸入框還能用就好。
  await expect(page.getByRole('textbox', { name: '輸入訊息' })).toBeEnabled({ timeout: 30_000 })
}

async function uploadPlan(page: Page, workbook: string, notice: string): Promise<PlanBody> {
  const planResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/plans') && response.request().method() === 'POST', { timeout: 180_000 })
  await page.getByLabel('上傳 Excel').setInputFiles(workbook)
  // 選檔案只是附加，要按【送出】才會上傳排班。
  await page.getByRole('button', { name: '送出', exact: true }).click()
  const response = await planResponse
  const body = await response.json() as PlanBody
  expect(response.ok(), JSON.stringify(body)).toBeTruthy()
  await expect(page.locator('.topbar-stats')).toContainText(notice, { timeout: 180_000 })
  await expect(page.getByLabel('配送地圖', { exact: true })).toBeVisible({ timeout: 30_000 })
  return body
}

test('情境 Evals W-01～W-52：tight Demo 單一連續走查', async ({ page }) => {
  test.setTimeout(1_800_000)
  const guards = installBrowserGuards(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await clearActiveRules(page)
  const startedAt = Date.now()
  const stageStarted: Record<string, number> = {}
  const stageDurations: Record<string, number> = {}
  const beginStage = (name: string) => { stageStarted[name] = Date.now() }
  const endStage = (name: string) => { stageDurations[name] = Date.now() - (stageStarted[name] || Date.now()) }
  const step = async (id: string, check: () => Promise<void>) => { await check(); await mark(page, id) }
  let plan: PlanBody

  beginStage('W0')
  await page.goto('/')
  await step('W-01', async () => {
    await expect(page.getByRole('heading', { name: '配送調度控制塔' })).toBeVisible()
    await expect(page.getByLabel('上傳 Excel')).toBeVisible()
    const text = await page.locator('body').innerText()
    expect(text).not.toContain('— 張')
    expect(text).not.toContain('— 台')
  })
  await step('W-02', async () => {
    const text = await page.locator('body').innerText()
    expect(text).not.toContain('今日訂單')
    expect(text).not.toContain('尚未建立')
  })
  endStage('W0')

  beginStage('W1')
  await page.getByLabel('上傳 Excel').setInputFiles(mappedWorkbook)
  // 選檔案只是附加，要按【送出】才會送去看欄位對映。
  await page.getByRole('button', { name: '送出', exact: true }).click()
  await step('W-03', async () => {
    await expect(page.getByRole('heading', { name: '請確認欄位對映' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('信心度')).toBeVisible()
    await expect(page.locator('.mapping-table tbody tr')).toHaveCount(31)
  })
  await step('W-04', async () => {
    const mapping = page.getByLabel('欄位 orders 收件區')
    await mapping.selectOption('city')
    await expect(mapping).toHaveValue('city')
    await mapping.selectOption('location_label')
    await expect(mapping).toHaveValue('location_label')
  })
  const mappedPlanResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/plans') && response.request().method() === 'POST', { timeout: 180_000 })
  await page.getByRole('button', { name: '確認欄位對映' }).click()
  await mappedPlanResponse
  await step('W-05', async () => {
    // 排班完成的綠色提示拿掉了，上排的統計列一直都在，用它當完成訊號。
    await expect(page.locator('.topbar-stats')).toContainText('已安排', { timeout: 180_000 })
    await expect(page.locator('.topbar-stats')).toContainText('50 張訂單')
  })

  await reset(page)
  await page.getByLabel('上傳 Excel').setInputFiles(missingWorkbook)
  // 選檔案只是附加，要按【送出】才會驗欄位。
  await page.getByRole('button', { name: '送出', exact: true }).click()
  await step('W-06', async () => {
    // 從對話框丟進來的檔案，缺欄報告就回在對話裡；紅色警示框是右上角
    // 「換一份資料」那條路才會走到的。
    const alert = page.locator('.chat-log > div.mr-auto').last()
    await expect(alert).toBeVisible({ timeout: 30_000 })
    await expect(alert).toContainText('ORD-001')
    await expect(alert).toContainText('ORD-002')
    await expect(alert).toContainText('PKG-003-01')
    // 報告改寫成人話了：欄位名稱用中文，不再是 location_label 那種機器字。
    await expect(alert).toContainText('地點名稱')
    await expect(alert).toContainText('配送時段')
    await expect(alert).toContainText('重量')
  })

  await reset(page)
  plan = await uploadPlan(page, tightWorkbook, '49/50 已安排')
  // 排班完成的綠色提示拿掉了；上排統計列是同一個訊號。
  await step('W-07', async () => { await expect(page.locator('.topbar-stats')).toContainText('已安排') })
  await step('W-08', async () => {
    const stats = page.locator('.topbar-stats')
    await expect(stats).toContainText('50 張訂單')
    await expect(stats).toContainText('4 台車')
    await expect(stats).toContainText('49/50 已安排')
  })
  await step('W-09', async () => {
    // 「車輛概況」併進訂單看板的欄頭了：四欄、四條載重、每台車的里程與時間。
    const board = page.getByLabel('訂單看板', { exact: true })
    await expect(board.locator('.order-board-column')).toHaveCount(4)
    await expect(board.locator('.obh-bar')).toHaveCount(4)
    for (const text of ['kg', 'km', '分鐘', '站', '%']) await expect(board).toContainText(text)
    for (const vehicle of ['第一車', '第二車', '第三車', '第四車']) await expect(board).toContainText(vehicle)
  })
  await step('W-10', async () => {
    await expect(page.locator('.leaflet-tile').first()).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText('示意路線', { exact: true })).toBeVisible()
    // OSM 版權只留 Leaflet 自己那一份。
    await expect(page.locator('.map-overlay-attrib')).toHaveCount(0)
    await expect(page.locator('.leaflet-control-attribution')).toContainText('© OpenStreetMap contributors')
    expect(await page.locator('.leaflet-overlay-pane path').count()).toBeGreaterThan(4)
  })
  await page.locator('.map-route-filter').filter({ hasText: '第一車' }).click()
  await step('W-11', async () => {
    const opacities = await page.locator('.leaflet-overlay-pane path').evaluateAll((paths) => paths.map((path) => (path as SVGPathElement).style.opacity || path.getAttribute('stroke-opacity') || ''))
    expect(opacities.filter((opacity) => opacity === '0.18').length).toBeGreaterThanOrEqual(3)
  })
  // 訂單表格換成四欄看板了：每一列點開才看得到明細。
  const firstOrder = page.locator('[data-order-id="ORD-001"] .order-board-order').first()
  await firstOrder.click()
  await step('W-12', async () => {
    await expect(page.getByText('推薦理由：', { exact: false }).first()).toBeVisible()
    await expect(page.getByText('第 ', { exact: false }).last()).toBeVisible()
    await expect(page.getByText('預估到達', { exact: false }).first()).toBeVisible()
  })
  // 哪一張單是「為了避開載重上限才換車」由當天的解決定，不是固定 ORD-041。
  // 直接從方案裡找出那一張，再點它。
  const capacityOrderId = (plan.vehicles || [])
    .flatMap((vehicle) => vehicle.stops || [])
    .find((stop) => (stop.reason?.summary || '').includes('原本會超過'))?.order_id
  expect(capacityOrderId, '這份方案沒有任何一張單是為了避開載重上限才改派的').toBeTruthy()
  const reassignedOrder = page.locator(`[data-order-id="${capacityOrderId}"] .order-board-order`).first()
  await reassignedOrder.click()
  await step('W-13', async () => {
    await expect(page.getByText('原本會超過', { exact: false }).first()).toBeVisible()
    await expect(page.getByText('上限', { exact: false }).first()).toBeVisible()
    await expect(page.getByText('改派', { exact: false }).first()).toBeVisible()
  })
  await step('W-14', async () => {
    // 排不進去的單收在看板下方的「未安排」區塊。
    const unassigned = page.locator('.order-board-unassigned')
    await expect(unassigned).toBeVisible()
    await expect(unassigned).toContainText('ORD-050')
  })
  await step('W-15', async () => { await expect(page.locator('.topbar-stats')).toContainText('已安排') })
  endStage('W1')

  beginStage('W2')
  const vagueRule = await typeAndSend(page, '三號車的老王最近腰傷，比較重的單先不要給他')
  const vagueRuleData = evidence(vagueRule, 'preview_dispatch_rule')
  await step('W-16', async () => {
    expect(vagueRuleData.status).toBe('NEEDS_CLARIFICATION')
    expect(vagueRuleData.current_metrics).toBeTruthy()
    // 第三車身上最重的是哪一件、超過 20 kg 有幾張，是當天那個解算出來的，
    // 不是固定的 22／3。要守住的是：問句給的是這台車真的數字，而且這一幕
    // 演得起來（至少有一張超過 20 kg，套下去才會有單要改派）。
    const metrics = vagueRuleData.current_metrics as Record<string, number>
    expect(metrics.max_single_package_weight_kg).toBeGreaterThan(20)
    expect(metrics.orders_over_20kg).toBeGreaterThan(0)
    // 問句本身就講明在問哪兩個數字，並把這台車的現況一起給人看。
    await expect(page.getByText('單件最重可以到幾公斤', { exact: false }).last()).toBeVisible({ timeout: 30_000 })
    await expect(
      page.getByText(`超過 20 kg 的有 ${metrics.orders_over_20kg} 張`, { exact: false }).last(),
    ).toBeVisible({ timeout: 30_000 })
  })
  const trialRule = await typeAndSend(page, '20 公斤以上就不要')
  const trialData = evidence(trialRule, 'preview_dispatch_rule')
  await step('W-17', async () => {
    expect(trialData.status).toBe('FEASIBLE')
    expect(trialData.trial).toBeTruthy()
    // 「規則試算完成」是舊的系統腔，現在直接報結果。
    await expect(page.getByText('試算結果：')).toBeVisible({ timeout: 30_000 })
    const ruleGroup = page.getByRole('group', { name: '司機規則試算方案' }).last()
    await expect(ruleGroup).toContainText('影響')
    // 會被改派幾張是當天那個解算出來的，不是固定 3 張。要守住的是：這條規則
    // 真的動到了東西，不是套下去一張都沒變。
    expect(
      ((trialData.diff as Record<string, unknown>).reassigned_orders as unknown[]).length,
    ).toBeGreaterThan(0)
  })
  await page.getByRole('button', { name: '套用', exact: true }).last().click()
  await step('W-18', async () => { await expect(page.getByRole('heading', { name: '已套用 1 條規則' })).toBeVisible({ timeout: 30_000 }) })
  // 規則卡是套用之後才畫出來的。原本用 count() 立刻判斷，那一刻還沒畫好就
  // 當成沒有按鈕，清單就一直收著。等它出現再按，並確認真的展開了。
  const expandRules = page.getByRole('button', { name: /規則清單/ })
  await expect(expandRules).toBeVisible({ timeout: 30_000 })
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if ((await expandRules.getAttribute('aria-expanded')) === 'true') break
    await expandRules.click()
    await page.waitForTimeout(250)
  }
  await expect(expandRules).toHaveAttribute('aria-expanded', 'true', { timeout: 10_000 })
  await step('W-19', async () => {
    // 規則清單要交代這條規則是從哪句話來的。記到的是兩句裡的哪一句由對話當下
    // 決定（「老王腰傷」或「20 公斤以上就不要」），這裡守的是「有出處、而且
    // 講得出這條規則是什麼」。
    const ruleBoard = page.getByLabel('司機規則清單')
    await expect(ruleBoard).toContainText('第三車 單件重量 ≤ 20 kg')
    await expect(ruleBoard).toContainText('原句：')
    await expect(ruleBoard).toContainText(/腰傷|20 公斤以上/)
  })
  const replanResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/plans') && response.request().method() === 'POST', { timeout: 180_000 })
  await page.getByRole('button', { name: '重新排班' }).click()
  const replanned = await (await replanResponse).json() as PlanBody
  plan = replanned
  await step('W-20', async () => {
    const vehicle = replanned.vehicles?.find((item) => item.vehicle_id === 'VEH-003')
    expect(vehicle).toBeTruthy()
    expect(replanned.unassigned_orders || []).toEqual(['ORD-050'])
    const vehicleOrderIds = vehicle?.stops?.map((stop) => stop.order_id) || []
    expect(vehicleOrderIds).not.toContain('ORD-014')
    expect(vehicleOrderIds).not.toContain('ORD-015')
    expect(vehicleOrderIds).not.toContain('ORD-017')
  })
  endStage('W2')

  beginStage('W3')
  // W3 intentionally exercises the real keyboard path. The demo buttons are
  // covered separately; they must not stand in for natural-language intake.
  const urgentMissing = await keyboardTypeAndSend(page, '客戶剛剛打電話來，信義區有一張急單要今天早上送到，15公斤')
  const urgentConversationUserCount = await page.locator('.chat-log > div').filter({ hasText: '你' }).count()
  await step('W-21', async () => {
    expect(urgentMissing.message || '').toContain('還缺少幾個欄位才能算')
    const missingEvidence = urgentMissing.evidence?.find((item) => item.tool === 'urgent_insertion_workflow')?.data
    // 缺欄清單改成講人話的分組了：地點名稱／城市／行政區併成「配送地點」，
    // 經緯度併成「座標」。要守住的是：只問一次、只問真的還缺的，
    // 已經講過的重量不會再問一遍。
    const missingByOrder = missingEvidence?.missing_by_order as Array<{ missing_fields: string[] }>
    expect(missingByOrder).toBeTruthy()
    expect(missingByOrder.length).toBe(1)
    expect(missingByOrder[0].missing_fields).toContain('order_id')
    expect(missingByOrder[0].missing_fields).not.toContain('package_weight_kg')
    for (const label of ['訂單編號', '配送地點', '座標']) {
      expect(urgentMissing.message || '', `缺欄清單沒有列出${label}`).toContain(label)
    }
    expect(urgentMissing.message || '').not.toContain('重量')
  })
  const urgentComplete = await keyboardTypeAndSend(page, '訂單編號 ORD-101，配送區域 Z3，城市臺北市，行政區信義，地點名稱大安信義交界示範配送點 Z3-51，緯度 25.040，經度 121.560，包裹件數 1，每件重量 15 公斤，早上配送')
  await step('W-22', async () => {
    expect(urgentComplete.message || '').toContain('我記下來了，確認一下')
    await expect(page.getByRole('button', { name: '產生插單預覽' })).toBeVisible({ timeout: 30_000 })
  })
  await step('W-23', async () => {
    const userBubbles = page.locator('.chat-log > div').filter({ hasText: '你' })
    const newUserBubbleCount = (await userBubbles.count()) - urgentConversationUserCount
    expect(newUserBubbleCount).toBeLessThanOrEqual(2)
  })
  const previewResponsePromise = page.waitForResponse((response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST', { timeout: 180_000 })
  await page.getByRole('button', { name: '產生插單預覽' }).click()
  const previewResponse = await previewResponsePromise
  expect(previewResponse.ok(), await previewResponse.text()).toBeTruthy()
  await step('W-24', async () => {
    const group = page.getByRole('group', { name: '臨時插單方案' }).last()
    await expect(group).toBeVisible({ timeout: 30_000 })
    const cards = group.locator('button.urgent-card')
    expect(await cards.count()).toBeGreaterThanOrEqual(2)
    await expect(cards.first()).toContainText('ORD-101')
    const cardTexts = await cards.allTextContents()
    expect(new Set(cardTexts).size).toBeGreaterThanOrEqual(2)
  })
  await step('W-25', async () => {
    const group = page.getByRole('group', { name: '臨時插單方案' }).last()
    await expect(group).toContainText('距離')
    await expect(group).toContainText('時間')
    await expect(group).toContainText('換車')
    await expect(group).toContainText('第 ')
    await expect(group).toContainText('送達')
  })
  const groupsBeforeModification = await page.getByRole('group', { name: '臨時插單方案' }).count()
  const modified = await typeAndSend(page, '用 A，但這單先送')
  await step('W-26', async () => {
    expect(modified.evidence?.some((item) => item.tool === 'prioritize_order_preview')).toBeTruthy()
    await expect(page.getByRole('group', { name: '臨時插單方案' })).toHaveCount(groupsBeforeModification + 1)
    // 提前配送的回覆現在直接講理由與代價，句尾自己交代能不能套用，不再多加
    // 一句「新方案卡尚未套用」。沒有建立新版本才是這一步要守住的事。
    await expect(page.locator('body')).not.toContainText('已建立新版本')
  })
  const refused = await typeAndSend(page, '把所有單重新分配一遍')
  await step('W-27', async () => {
    expect(refused.message || '').toContain('這個我不能改')
    await expect(page.getByText('這個我不能改').last()).toBeVisible({ timeout: 30_000 })
  })
  const versionBeforeCancel = plan.version
  await page.locator('button.urgent-card').last().click()
  await page.getByRole('button', { name: '取消', exact: true }).last().click()
  await step('W-28', async () => {
    await expect(page.getByText('原方案版本沒有變更。').last()).toBeVisible()
    expect(plan.version).toBe(versionBeforeCancel)
  })
  const confirmedCard = page.locator('button.urgent-card').last()
  await confirmedCard.click()
  const confirmResponse = page.waitForResponse((response) => response.url().includes('/confirm') && response.request().method() === 'POST', { timeout: 180_000 })
  await page.getByRole('button', { name: '確認套用' }).last().click()
  const confirmedPlanResponse = await confirmResponse
  expect(confirmedPlanResponse.ok(), await confirmedPlanResponse.text()).toBeTruthy()
  const confirmedPlan = await confirmedPlanResponse.json() as PlanBody
  plan = confirmedPlan
  await step('W-29', async () => {
    expect(confirmedPlan.version).toBeGreaterThan(versionBeforeCancel)
    await expect(page.getByText('建立新版本', { exact: false }).last()).toBeVisible({ timeout: 30_000 })
  })
  endStage('W3')

  beginStage('W4')
  const groupsBeforeBatch = await page.getByRole('group', { name: '臨時插單方案' }).count()
  // 照 demo 現場那樣分兩句：先講「有三張急單」，再把三行資料貼進去。
  // 上一張急單剛剛才確認完、草稿已經清空，直接貼三行沒有前文，
  // 系統不會知道那是三張新的單。
  await typeAndSend(page, '客戶剛打來，三張急單今天要送')
  await urgentPreview(page, [
    'URG-W30-001 25.036/121.567 Z3 5公斤 1件 早上',
    'URG-W30-002 25.079/121.575 Z2 6公斤 1件 早上',
    'URG-W30-003 25.015/121.462 Z4 4公斤 1件 早上',
  ].join('\n'))
  await step('W-30', async () => {
    const group = page.getByRole('group', { name: '臨時插單方案' }).last()
    await expect(group).toContainText('URG-W30-001', { timeout: 30_000 })
    await expect(group).toContainText('URG-W30-002')
    await expect(group).toContainText('URG-W30-003')
    await expect(page.getByRole('group', { name: '臨時插單方案' })).toHaveCount(groupsBeforeBatch + 1)
  })
  // 200 公斤超過任何一台車的載重上限，這張一定排不進去。
  await urgentPreview(page, `再一張急單 ${urgentLine('URG-W31-001', ZONES.Z2, '200')}`)
  await step('W-31', async () => {
    const group = page.getByRole('group', { name: '臨時插單方案' }).last()
    await expect(group.locator('.urgent-card-unavailable').first()).toBeVisible({ timeout: 30_000 })
    await expect(group).toContainText('URG-W31-001')
    await expect(group).toContainText('需人工處理')
  })
  // 這兩批都是故意不確認的。草稿留著的話，後面每一次插單預覽都會把它們
  // 再算一遍，方案卡就永遠是這一堆舊單。講一句「算了不要了」清掉。
  await typeAndSend(page, '算了不要了')
  endStage('W4')

  beginStage('W5')
  await page.getByRole('button', { name: '開始裝車' }).click()
  await step('W-32', async () => { await expect(page.getByText('上車後').first()).toBeVisible({ timeout: 30_000 }) })
  await urgentPreview(page, `新增急單 ${urgentLine('URG-W33-001', ZONES.Z3, '3')}`)
  await step('W-33', async () => {
    const group = page.getByRole('group', { name: '臨時插單方案' }).last()
    await expect(group.locator('button.urgent-card')).toHaveCount(1, { timeout: 30_000 })
    await expect(group).not.toContainText('次佳車輛最佳位置')
  })
  // 同上：這張也不確認，清掉草稿再往下走。
  await typeAndSend(page, '算了不要了')
  // 點名一張今天本來就在跑的單。講「這單」的話指的是上面那張急單草稿，
  // 它還沒排進方案，回覆會是「找不到這張單」——那是對的，
  // 但測不到上車後不准跨車改派這件事。
  const loadedMove = await typeAndSend(page, 'ORD-014 改派給四號車')
  await step('W-34', async () => {
    const data = evidence(loadedMove, 'reassign_order_preview')
    expect(data.status).toBe('VEHICLE_ASSIGNMENT_FROZEN')
    expect(loadedMove.message || '').toContain('卸貨重裝')
    await expect(page.getByText('卸貨重裝', { exact: false }).last()).toBeVisible({ timeout: 30_000 })
  })
  const loadedReplan = await typeAndSend(page, '全部重新排一次')
  await step('W-35', async () => {
    expect(loadedReplan.evidence?.some((item) => item.tool === 'reject_unsupported_change' || (item.tool === 'plan_dispatch' && item.data.status === 'FULL_REPLAN_NOT_ALLOWED'))).toBeTruthy()
    await expect(page.getByText('不能改', { exact: false }).last()).toBeVisible({ timeout: 30_000 })
  })
  // 這句點名既有訂單。講「這單」的話，指的是上面那張還沒確認的急單草稿，
  // 系統會去改草稿的時段——那是對的行為，但測不到這裡要測的既有訂單改時段。
  const timeChange = await typeAndSend(page, 'ORD-019 改成下午送')
  await step('W-36', async () => {
    expect(timeChange.evidence?.some((item) => item.tool === 'change_order_constraint')).toBeTruthy()
  })
  endStage('W5')

  beginStage('W6')
  await page.getByRole('button', { name: '模擬出發' }).click()
  await step('W-37', async () => { await expect(page.getByText('已發車').first()).toBeVisible({ timeout: 30_000 }) })
  const timeline = page.getByRole('slider', { name: '配送時間軸' })
  await timeline.fill('300')
  await step('W-38', async () => {
    await expect(timeline).toHaveValue('300')
    await expect(page.getByLabel('VEH-001 進度線')).toBeVisible()
    await expect(page.getByLabel('VEH-002 進度線')).toBeVisible()
    await expect(page.getByLabel('VEH-003 進度線')).toBeVisible()
    await expect(page.getByLabel('VEH-004 進度線')).toBeVisible()
    await expect(page.getByText('實心：已送').first()).toBeVisible()
    await expect(page.getByText('方塊：目前').first()).toBeVisible()
    await expect(page.getByText('空心：未送').first()).toBeVisible()
  })
  await step('W-39', async () => {
    const dashArrays = await page.locator('.leaflet-overlay-pane path').evaluateAll((paths) => paths.map((path) => (path as SVGPathElement).style.strokeDasharray || path.getAttribute('stroke-dasharray') || ''))
    expect(dashArrays.some((value) => value !== '')).toBeTruthy()
    expect(dashArrays.some((value) => value === '')).toBeTruthy()
  })
  await step('W-40', async () => {
    const completed = page.locator('[aria-disabled="true"]')
    await expect(completed.first()).toBeVisible()
    await expect(completed.first()).toHaveAttribute('draggable', 'false')
  })
  // 要點名一張還沒送達的單。只說「客戶說中午前一定要拿到」沒有講是哪一張，
  // 工具會以缺少訂單編號安全返回，畫面上不會有方案卡可挑。
  const undelivered = page.locator('.timeline-stop[aria-disabled="false"]')
  await expect(undelivered.first()).toBeVisible({ timeout: 60_000 })
  const undeliveredLabels = await undelivered.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('aria-label') || ''),
  )
  const priorityOrderId = undeliveredLabels.map((label) => /ORD-\d{3}/.exec(label)?.[0]).find(Boolean)
  expect(priorityOrderId, '時間軸上沒有任何還沒送達的站').toBeTruthy()
  const priority = await typeAndSend(page, `${priorityOrderId} 客戶說中午前一定要拿到`)
  await step('W-41', async () => {
    expect(priority.evidence?.some((item) => item.tool === 'prioritize_order_preview')).toBeTruthy()
    await expect(page.getByText('剩餘', { exact: false }).last()).toBeVisible({ timeout: 30_000 })
  })
  await step('W-42', async () => {
    const group = page.getByRole('group', { name: '臨時插單方案' }).last()
    await expect(group).toBeVisible({ timeout: 30_000 })
    // 時間軸已經拉到下午，剩下的站沒有一個趕得上中午前，所以卡片會是誠實的
    // 「最快只能到 幾點」而不是「優先度提高」。兩種都要點名那張單、給出時刻，
    // 不能只說做不到。
    const card = group.locator('.urgent-card').first()
    await expect(card).toContainText(priorityOrderId as string)
    await expect(card).toContainText(/提高|最快只能到 \d{1,2}:\d{2}/)
  })
  await step('W-43', async () => {
    await expect(page.getByText('維持原順序', { exact: false }).last()).toBeVisible()
    await expect(page.getByText('送不到', { exact: false }).last()).toBeVisible()
  })
  endStage('W6')

  beginStage('W7')
  const deviations = await typeAndSend(page, '今天調度狀況如何')
  const deviationData = evidence(deviations, 'inspect_dispatch_deviations')
  await step('W-44', async () => {
    const vehicles = deviationData.vehicle_deviations as Array<{ vehicle_id: string; delay_minutes: number }>
    expect(vehicles.length).toBeGreaterThan(0)
    // 偏差說明講的是人話車名（第三車），不是資料庫鍵值。
    await expect(page.getByText('今天實際比預估慢', { exact: false }).last()).toBeVisible()
  })
  await step('W-45', async () => {
    const zones = deviationData.zone_deviations as Array<{ zone_code: string; extra_service_minutes_per_stop: number }>
    expect(zones.length).toBeGreaterThan(0)
    // 區域偏差改成人話了：「南區（Z5）每一站平均多停 N 分鐘」。
    await expect(page.getByText('每一站平均多停', { exact: false }).last()).toBeVisible()
  })
  await step('W-46', async () => {
    const suggestions = deviationData.suggestions as Array<{ from_service_minutes: number; to_service_minutes: number }>
    expect(suggestions.length).toBeGreaterThan(0)
    await expect(page.getByText('服務時間', { exact: false }).last()).toBeVisible()
  })
  // 「今天調度狀況如何」給的是回顧；要拿到可以按的參數建議，得再問一句
  // 「那明天要怎麼改」——這是 demo 第七幕本來就有的兩句。
  await typeAndSend(page, '那明天要怎麼改')
  const beforeParameters = await page.request.get('/api/v1/dispatch-parameters')
  const beforeParameterBody = await beforeParameters.json() as { service_minutes_by_zone: Record<string, number> }
  // 建議調哪一區、調到幾分鐘是當天的偏差算出來的，不是固定的 Z5 7 分鐘；
  // 畫面上那顆按鈕自己就帶著區碼與分鐘，直接照畫面抓。
  const suggestionButton = page.getByRole('button', { name: /^確認套用 Z\d+ \d+ 分鐘$/ }).last()
  await step('W-47', async () => {
    expect(beforeParameterBody.service_minutes_by_zone).toEqual({})
    await expect(suggestionButton).toBeVisible()
  })
  await suggestionButton.click()
  await step('W-48', async () => {
    await expect(page.getByRole('button', { name: '用新參數重排' })).toBeVisible({ timeout: 30_000 })
    const afterParameters = await (await page.request.get('/api/v1/dispatch-parameters')).json() as { service_minutes_by_zone: Record<string, number> }
    expect(Object.keys(afterParameters.service_minutes_by_zone).length).toBeGreaterThan(0)
    await page.getByRole('button', { name: '用新參數重排' }).click()
    await expect(page.getByText('已用新參數重新排班', { exact: false })).toBeVisible({ timeout: 180_000 })
  })
  endStage('W7')

  beginStage('W8')
  await page.getByRole('button', { name: '重新開始' }).click()
  await step('W-49', async () => { await expect(page.getByText('先放入今天的訂單', { exact: true })).toBeVisible({ timeout: 30_000 }) })
  await step('W-50', async () => {
    expect(guards.dispatchRequests).toEqual([])
    expect(guards.googleRequests).toEqual([])
  })
  await step('W-51', async () => { expect(guards.consoleErrors).toEqual([]) })
  endStage('W8')
  const totalMs = Date.now() - startedAt
  await step('W-52', async () => {
    expect(totalMs).toBeGreaterThan(0)
    console.log(`W timing: ${JSON.stringify({ total_seconds: Number((totalMs / 1000).toFixed(3)), stages_seconds: Object.fromEntries(Object.entries(stageDurations).map(([key, value]) => [key, Number((value / 1000).toFixed(3))])) })}`)
  })
})
