import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

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
  vehicles?: Array<{ vehicle_id: string; total_distance_m?: number; stops?: Array<{ order_id: string }> }>
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
  await input.pressSequentially(message)
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

function evidence(body: AgentBody, tool: string): Record<string, unknown> {
  const item = body.evidence?.find((entry) => entry.tool === tool)
  expect(item, `找不到 evidence tool：${tool}；系統回覆：${body.message || JSON.stringify(body)}`).toBeTruthy()
  return item?.data || {}
}

async function mark(page: Page, id: string) {
  await page.screenshot({ path: path.join(screenshotDir, `${id}.png`), fullPage: true })
}

async function reset(page: Page) {
  const resetButton = page.getByRole('button', { name: '重新開始' })
  if (await resetButton.count() > 0) await resetButton.click()
  await expect(page.getByText('下載範例格式')).toBeVisible({ timeout: 30_000 })
}

async function uploadPlan(page: Page, workbook: string, notice: string): Promise<PlanBody> {
  const planResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/plans') && response.request().method() === 'POST', { timeout: 180_000 })
  await page.getByLabel('上傳 Excel').setInputFiles(workbook)
  const response = await planResponse
  const body = await response.json() as PlanBody
  expect(response.ok(), JSON.stringify(body)).toBeTruthy()
  await expect(page.getByText(notice)).toBeVisible({ timeout: 180_000 })
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
    await expect(page.getByText('已完成', { exact: false })).toBeVisible({ timeout: 180_000 })
    await expect(page.getByText('張訂單的排班', { exact: false })).toBeVisible()
    await expect(page.locator('.topbar-stats')).toContainText('50 張訂單')
  })

  await reset(page)
  await page.getByLabel('上傳 Excel').setInputFiles(missingWorkbook)
  await step('W-06', async () => {
    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible({ timeout: 30_000 })
    await expect(alert).toContainText('ORD-001')
    await expect(alert).toContainText('ORD-002')
    await expect(alert).toContainText('PKG-003-01')
    await expect(alert).toContainText('缺少必填欄位')
  })

  await reset(page)
  plan = await uploadPlan(page, tightWorkbook, '已完成 49／50 張訂單的排班，方案待人工確認。')
  await step('W-07', async () => { await expect(page.getByText('方案待人工確認。')).toBeVisible() })
  await step('W-08', async () => {
    const stats = page.locator('.topbar-stats')
    await expect(stats).toContainText('50 張訂單')
    await expect(stats).toContainText('4 台車')
    await expect(stats).toContainText('49/50 已安排')
  })
  await step('W-09', async () => {
    const board = page.getByLabel('車輛概況')
    await expect(board.locator('button')).toHaveCount(4)
    for (const text of ['載重', '上限', '服務區域', 'km', '分鐘']) await expect(board).toContainText(text)
    for (const vehicle of ['VEH-001', 'VEH-002', 'VEH-003', 'VEH-004']) await expect(board).toContainText(vehicle)
    await expect(board).toContainText('%')
  })
  await step('W-10', async () => {
    await expect(page.locator('.leaflet-tile').first()).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText('示意路線', { exact: true })).toBeVisible()
    await expect(page.locator('.map-overlay-attrib')).toHaveText('© OpenStreetMap contributors')
    await expect(page.locator('.leaflet-control-attribution')).toContainText('© OpenStreetMap contributors')
    expect(await page.locator('.leaflet-overlay-pane path').count()).toBeGreaterThan(4)
  })
  await page.locator('.map-route-filter').filter({ hasText: 'VEH-001' }).click()
  await step('W-11', async () => {
    const opacities = await page.locator('.leaflet-overlay-pane path').evaluateAll((paths) => paths.map((path) => (path as SVGPathElement).style.opacity || path.getAttribute('stroke-opacity') || ''))
    expect(opacities.filter((opacity) => opacity === '0.18').length).toBeGreaterThanOrEqual(3)
  })
  const firstOrder = page.locator('.data-table tbody tr').filter({ hasText: 'ORD-001' }).first()
  await firstOrder.click()
  await step('W-12', async () => {
    await expect(page.getByText('推薦理由：')).toBeVisible()
    await expect(page.getByText('第 ', { exact: false }).last()).toBeVisible()
    await expect(page.getByText('預估到達', { exact: true }).first()).toBeVisible()
  })
  const reassignedOrder = page.locator('.data-table tbody tr').filter({ hasText: 'ORD-041' }).first()
  await reassignedOrder.click()
  await step('W-13', async () => {
    await expect(page.getByText('原本會超過', { exact: false }).first()).toBeVisible()
    await expect(page.getByText('上限', { exact: false }).first()).toBeVisible()
    await expect(page.getByText('改派', { exact: false }).first()).toBeVisible()
  })
  await step('W-14', async () => {
    const unassigned = page.locator('.data-table tbody tr').filter({ hasText: 'ORD-050' }).first()
    await expect(unassigned).toBeVisible()
    await expect(unassigned).toContainText('CAPACITY_LIMIT')
  })
  await step('W-15', async () => { await expect(page.getByText('方案待人工確認。', { exact: false }).first()).toBeVisible() })
  endStage('W1')

  beginStage('W2')
  const vagueRule = await typeAndSend(page, '三號車的老王最近腰傷，比較重的單先不要給他')
  const vagueRuleData = evidence(vagueRule, 'preview_dispatch_rule')
  await step('W-16', async () => {
    expect(vagueRuleData.status).toBe('NEEDS_CLARIFICATION')
    expect(vagueRuleData.current_metrics).toBeTruthy()
    expect((vagueRuleData.current_metrics as Record<string, unknown>).max_single_package_weight_kg).toBe(22)
    expect((vagueRuleData.current_metrics as Record<string, unknown>).orders_over_20kg).toBe(3)
    await expect(page.getByText('單件重量上限')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('超過 20 kg 有 3 張')).toBeVisible({ timeout: 30_000 })
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
    expect(((trialData.diff as Record<string, unknown>).reassigned_orders as unknown[]).length).toBe(3)
  })
  await page.getByRole('button', { name: '套用', exact: true }).last().click()
  await step('W-18', async () => { await expect(page.getByRole('heading', { name: '已套用 1 條規則' })).toBeVisible({ timeout: 30_000 }) })
  const expandRules = page.getByRole('button', { name: '展開規則清單' })
  if (await expandRules.count() > 0) await expandRules.click()
  await step('W-19', async () => {
    await expect(page.getByLabel('司機規則清單').getByText('原句：三號車的老王最近腰傷，比較重的單先不要給他', { exact: false }).first()).toBeVisible()
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
    expect(urgentMissing.message || '').toContain('目前還不能計算')
    const missingEvidence = urgentMissing.evidence?.find((item) => item.tool === 'urgent_insertion_workflow')?.data
    expect(missingEvidence?.missing_by_order).toBeTruthy()
    expect(missingEvidence?.missing_by_order).toEqual([{
      order_ref: '第 1 張急單',
      missing_fields: ['order_id', 'location_label', 'city', 'latitude', 'longitude', 'declared_package_count'],
    }])
    for (const label of ['訂單編號', '地點名稱', '城市', '緯度', '經度', '包裹件數']) await expect(page.getByText(label, { exact: false }).last()).toBeVisible()
    expect(urgentMissing.message || '').not.toContain('配送地點（地址或座標）')
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
    await expect(page.getByText('新方案卡尚未套用')).toBeVisible({ timeout: 30_000 })
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
  await page.getByRole('button', { name: '示範三張急單' }).click()
  await step('W-30', async () => {
    const group = page.getByRole('group', { name: '臨時插單方案' }).last()
    await expect(group).toContainText('URG-DEMO-041', { timeout: 30_000 })
    await expect(group).toContainText('URG-DEMO-052')
    await expect(group).toContainText('URG-DEMO-053')
    await expect(page.getByRole('group', { name: '臨時插單方案' })).toHaveCount(groupsBeforeBatch + 1)
  })
  await page.getByRole('button', { name: '示範不可安排' }).click()
  await step('W-31', async () => {
    const group = page.getByRole('group', { name: '臨時插單方案' }).last()
    await expect(group.locator('.urgent-card-unavailable')).toHaveCount(1, { timeout: 30_000 })
    await expect(group).toContainText('URG-DEMO-053')
    await expect(group).toContainText('需人工處理')
  })
  endStage('W4')

  beginStage('W5')
  await page.getByRole('button', { name: '開始裝車' }).click()
  await step('W-32', async () => { await expect(page.getByText('上車後').first()).toBeVisible({ timeout: 30_000 }) })
  await page.getByRole('button', { name: '示範一張急單' }).click()
  await step('W-33', async () => {
    const group = page.getByRole('group', { name: '臨時插單方案' }).last()
    await expect(group.locator('button.urgent-card')).toHaveCount(1, { timeout: 30_000 })
    await expect(group).not.toContainText('次佳車輛最佳位置')
  })
  const loadedMove = await typeAndSend(page, '這單改派給四號車')
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
  const timeChange = await typeAndSend(page, '這單改成下午送')
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
  const priority = await typeAndSend(page, '客戶說中午前一定要拿到')
  await step('W-41', async () => {
    expect(priority.evidence?.some((item) => item.tool === 'prioritize_order_preview')).toBeTruthy()
    await expect(page.getByText('剩餘', { exact: false }).last()).toBeVisible({ timeout: 30_000 })
  })
  await step('W-42', async () => {
    const group = page.getByRole('group', { name: '臨時插單方案' }).last()
    await expect(group).toBeVisible({ timeout: 30_000 })
    await expect(group.locator('.urgent-card').first()).toContainText('提高')
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
    await expect(page.getByText('VEH-003 今天實際比預估慢', { exact: false }).last()).toBeVisible()
  })
  await step('W-45', async () => {
    const zones = deviationData.zone_deviations as Array<{ zone_code: string; extra_service_minutes_per_stop: number }>
    expect(zones.length).toBeGreaterThan(0)
    await expect(page.getByText('Z5 區每站停留時間', { exact: false }).last()).toBeVisible()
  })
  await step('W-46', async () => {
    const suggestions = deviationData.suggestions as Array<{ from_service_minutes: number; to_service_minutes: number }>
    expect(suggestions.length).toBeGreaterThan(0)
    await expect(page.getByText('服務時間', { exact: false }).last()).toBeVisible()
  })
  const beforeParameters = await page.request.get('/api/v1/dispatch-parameters')
  const beforeParameterBody = await beforeParameters.json() as { service_minutes_by_zone: Record<string, number> }
  await step('W-47', async () => {
    expect(beforeParameterBody.service_minutes_by_zone).toEqual({})
    await expect(page.getByRole('button', { name: '確認套用 Z5 7 分鐘', exact: true })).toBeVisible()
  })
  const suggestionButton = page.getByRole('button', { name: '確認套用 Z5 7 分鐘', exact: true })
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
  await step('W-49', async () => { await expect(page.getByText('下載範例格式')).toBeVisible({ timeout: 30_000 }) })
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
