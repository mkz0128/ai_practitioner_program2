import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

const relaxedWorkbook = path.resolve('..', 'data', 'samples', 'demo-50-relaxed.xlsx')
const tightWorkbook = path.resolve('..', 'data', 'samples', 'demo-50-tight.xlsx')
const screenshotDir = path.resolve('..', 'docs', 'screenshots')

type Evidence = { tool: string; data: Record<string, unknown> }
type AgentBody = { message?: string; evidence?: Evidence[]; error?: { code?: string } }

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
  expect(response.ok()).toBeTruthy()
  const body = await response.json() as { rules: Array<{ rule_id: string; active_now: boolean }> }
  for (const rule of body.rules.filter((item) => item.active_now)) {
    const stopped = await page.request.post(`/api/v1/dispatch-rules/${encodeURIComponent(rule.rule_id)}/deactivate`)
    expect(stopped.ok()).toBeTruthy()
  }
}

async function importDemoPlan(page: Page, workbook: string) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await clearActiveRules(page)
  await page.reload()
  await page.getByLabel('上傳 Excel').setInputFiles(workbook)
  await expect(page.getByText(/已完成 \d+／\d+ 張訂單的排班/)).toBeVisible({ timeout: 180_000 })
  await expect(page.getByLabel('配送地圖', { exact: true })).toBeVisible({ timeout: 30_000 })
}

async function expandRuleList(page: Page) {
  const expanded = page.getByRole('button', { name: '收合規則清單' })
  if (await expanded.isVisible()) return
  await page.getByRole('button', { name: '展開規則清單' }).click()
}

async function send(page: Page, message: string): Promise<AgentBody> {
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const responsePromise = page.waitForResponse((response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST', { timeout: 180_000 })
  await input.fill(message)
  await input.press('Enter')
  const response = await responsePromise
  const body = await response.json() as AgentBody
  expect(response.ok(), body.error?.code ?? body.message ?? 'agent request failed').toBeTruthy()
  return body
}

function evidence(body: AgentBody, tool: string): Record<string, unknown> {
  const item = body.evidence?.find((entry) => entry.tool === tool)
  expect(item, `missing evidence tool ${tool}`).toBeTruthy()
  return item?.data || {}
}

test('TODO 6：F2-01～F2-05 司機規則反問、試算、套用與重排', async ({ page }) => {
  test.setTimeout(600_000)
  const guards = installBrowserGuards(page)
  await importDemoPlan(page, relaxedWorkbook)

  const vague = await send(page, '三號車的司機只能開比較短的路線')
  const vagueData = evidence(vague, 'preview_dispatch_rule')
  expect(vagueData.status).toBe('NEEDS_CLARIFICATION')
  expect(vagueData.current_metrics).toBeTruthy()
  await expect(page.getByText('單趟總距離上限')).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: path.join(screenshotDir, 'F2-01.png'), fullPage: true })

  const trial = await send(page, 'VEH-003 單趟距離，30 公里')
  const trialData = evidence(trial, 'preview_dispatch_rule')
  expect(trialData.status).toBe('FEASIBLE')
  expect(trialData.trial).toBeTruthy()
  await expect(page.getByText('規則試算完成')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/影響 \d+ 張/)).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, 'F2-02.png'), fullPage: true })

  const confirmResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/dispatch-rules/confirm') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '套用', exact: true }).click()
  expect((await confirmResponse).ok()).toBeTruthy()
  await expect(page.getByRole('heading', { name: '已套用 1 條規則' })).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: path.join(screenshotDir, 'F2-03.png'), fullPage: true })

  await expandRuleList(page)
  await expect(page.getByText('原句：三號車的司機只能開比較短的路線').first()).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, 'F2-04.png'), fullPage: true })

  const replanResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/plans') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '重新排班' }).click()
  const replan = await replanResponse
  expect(replan.ok()).toBeTruthy()
  const replanned = await replan.json() as { vehicles: Array<{ vehicle_id: string; total_distance_m: number }> }
  const vehicleThree = replanned.vehicles.find((vehicle) => vehicle.vehicle_id === 'VEH-003')
  expect(vehicleThree).toBeTruthy()
  expect(vehicleThree?.total_distance_m || 0).toBeLessThanOrEqual(30_000)
  await expect(page.getByText('已重新排班')).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: path.join(screenshotDir, 'F2-05.png'), fullPage: true })

  expect(guards.consoleErrors).toEqual([])
  expect(guards.dispatchRequests).toEqual([])
  expect(guards.googleRequests).toEqual([])
})

test('TODO 6：F2-06～F2-08 規則衝突與禁止型邊界', async ({ page }) => {
  test.setTimeout(600_000)
  const guards = installBrowserGuards(page)
  await importDemoPlan(page, tightWorkbook)

  const conflict = await send(page, 'VEH-003 單件不超過 5 公斤')
  const conflictData = evidence(conflict, 'preview_dispatch_rule')
  expect(conflictData.status).toBe('CONFLICT')
  const conflicts = conflictData.conflicts as Array<{ rule_id: string; order_ids: string[]; reason: string }>
  expect(conflicts.length).toBeGreaterThan(0)
  expect(conflicts[0]?.rule_id).toBe('RULE-CANDIDATE')
  expect(conflicts[0]?.order_ids.length).toBeGreaterThan(0)
  await expect(page.getByText('這條規則造成衝突')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: '這次破例' })).toBeVisible()
  await expect(page.getByRole('button', { name: '改成較寬數值' })).toBeVisible()
  await expect(page.getByRole('button', { name: '取消規則' })).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, 'F2-06.png'), fullPage: true })

  const preference = await send(page, '這單一定要給老王送')
  expect(preference.evidence?.some((item) => item.tool === 'reject_unsupported_change')).toBeTruthy()
  await expect(page.getByText('這個我不能改').last()).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: path.join(screenshotDir, 'F2-07.png'), fullPage: true })

  const speed = await send(page, '老王開車要開快一點')
  expect(speed.evidence?.some((item) => item.tool === 'reject_unsupported_change')).toBeTruthy()
  await expect(page.getByText('這個我不能改').last()).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: path.join(screenshotDir, 'F2-08.png'), fullPage: true })

  expect(guards.consoleErrors).toEqual([])
  expect(guards.dispatchRequests).toEqual([])
  expect(guards.googleRequests).toEqual([])
})

test('TODO 6：F2-09～F2-10 停用規則與暫時有效期', async ({ page }) => {
  test.setTimeout(600_000)
  const guards = installBrowserGuards(page)
  await importDemoPlan(page, relaxedWorkbook)
  await send(page, '三號車單趟距離上限 30 公里')
  await expect(page.getByRole('button', { name: '套用', exact: true })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '套用', exact: true }).click()
  await expect(page.getByRole('heading', { name: '已套用 1 條規則' })).toBeVisible({ timeout: 30_000 })
  await expandRuleList(page)

  const deactivateResponse = page.waitForResponse((response) => response.url().includes('/api/v1/dispatch-rules/') && response.url().endsWith('/deactivate') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '停用' }).click()
  expect((await deactivateResponse).ok()).toBeTruthy()
  await expect(page.getByText('目前已套用 0 條規則')).toBeVisible({ timeout: 30_000 })
  const replanResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/plans') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '重新排班' }).click()
  expect((await replanResponse).ok()).toBeTruthy()
  await expect(page.getByText('已重新排班')).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: path.join(screenshotDir, 'F2-09.png'), fullPage: true })

  const temporary = await send(page, '四號車單件重量不超過 20 公斤，這週有效')
  const temporaryData = evidence(temporary, 'preview_dispatch_rule')
  expect(temporaryData.status).toBe('FEASIBLE')
  const temporaryRule = temporaryData.rule as { duration: string }
  expect(temporaryRule.duration).toBe('THIS_WEEK')
  await page.getByRole('button', { name: '套用', exact: true }).last().click()
  await expect(page.getByText('到期：').first()).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: path.join(screenshotDir, 'F2-10.png'), fullPage: true })

  expect(guards.consoleErrors).toEqual([])
  expect(guards.dispatchRequests).toEqual([])
  expect(guards.googleRequests).toEqual([])
})

test('TODO 6：R-05 六種司機規則說法都進入規則流程', async ({ page }) => {
  test.setTimeout(900_000)
  const guards = installBrowserGuards(page)
  await importDemoPlan(page, relaxedWorkbook)
  const variants = [
    '三號車不要載太重的',
    '老王腰傷，重的別給他',
    'VEH-003 限重 20 公斤',
    '三號那台，二十公斤以上不要',
    '幫我限制三號車的單件重量',
    '三車重物 pass',
  ]
  for (const message of variants) {
    const body = await send(page, message)
    expect(body.error).toBeUndefined()
    expect(body.evidence?.some((item) => item.tool === 'preview_dispatch_rule')).toBeTruthy()
  }
  await page.screenshot({ path: path.join(screenshotDir, 'R-05.png'), fullPage: true })
  expect(guards.consoleErrors).toEqual([])
  expect(guards.dispatchRequests).toEqual([])
  expect(guards.googleRequests).toEqual([])
})
