import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

import { saveScreenshot } from './screenshot-helper'

const samplesDir = path.resolve('..', 'data', 'samples')
const relaxedWorkbook = path.join(samplesDir, 'demo-50-relaxed.xlsx')
const tightWorkbook = path.join(samplesDir, 'demo-50-tight.xlsx')
const screenshotDir = path.resolve('..', 'docs', 'screenshots')

type Evidence = { tool: string; data: Record<string, unknown> }
type AgentBody = { message?: string; evidence?: Evidence[]; error?: { code?: string; message?: string } }
type Option = {
  option_id: string
  title: string
  mode: string
  selectable: boolean
  feasible: boolean
  inserted_orders: Array<{ order_id: string; vehicle_id: string | null; sequence: number | null; eta: string | null; status: string }>
  cost: { distance_delta_m: number | null; duration_delta_s: number | null; vehicle_change_count: number; distance_delta_km: number | null; duration_delta_min: number | null }
  validator: { valid: boolean }
  reordered_order_count: number
}

function installSession(page: Page, sessionId: string) {
  page.route('**/api/v1/agent/chat', async (route) => {
    const payload = JSON.parse(route.request().postData() || '{}') as Record<string, unknown>
    payload.session_id = sessionId
    await route.continue({ postData: JSON.stringify(payload) })
  })
}

async function upload(page: Page, workbook: string, expected: string) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByLabel('上傳 Excel').setInputFiles(workbook)
  await expect(page.getByText(expected, { exact: false })).toBeVisible({ timeout: 180_000 })
  await expect(page.getByLabel('配送地圖', { exact: true })).toBeVisible({ timeout: 30_000 })
}

async function send(page: Page, inputText: string): Promise<AgentBody> {
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const responsePromise = page.waitForResponse((response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST', { timeout: 180_000 })
  await input.click()
  await input.pressSequentially(inputText)
  await expect(input).toHaveValue(inputText)
  await input.press('Enter')
  const response = await responsePromise
  const raw = await response.text()
  expect(response.ok(), `輸入：${inputText}\n系統實際回覆：${raw}`).toBeTruthy()
  return JSON.parse(raw) as AgentBody
}

function urgentData(body: AgentBody): Record<string, unknown> {
  const evidence = body.evidence?.find((item) => item.tool === 'urgent_insertion_workflow')
  expect(evidence, `系統實際回覆：${body.message || JSON.stringify(body)}`).toBeTruthy()
  return evidence?.data || {}
}

async function preview(page: Page): Promise<AgentBody> {
  const responsePromise = page.waitForResponse((response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST', { timeout: 180_000 })
  await page.getByRole('button', { name: '產生插單預覽' }).last().click()
  const response = await responsePromise
  const raw = await response.text()
  expect(response.ok(), `預覽系統實際回覆：${raw}`).toBeTruthy()
  return JSON.parse(raw) as AgentBody
}

function optionsFrom(body: AgentBody): Option[] {
  const data = urgentData(body)
  expect(Array.isArray(data.options), `系統實際回覆：${body.message || JSON.stringify(body)}`).toBeTruthy()
  return (data.options || []) as Option[]
}

function optionVector(option: Option): [number, number, number, number, number] {
  const inserted = option.inserted_orders.find((item) => item.status === 'ASSIGNED')
  expect(inserted?.eta).toBeTruthy()
  return [
    option.cost.distance_delta_m ?? Number.POSITIVE_INFINITY,
    option.cost.duration_delta_s ?? Number.POSITIVE_INFINITY,
    option.cost.vehicle_change_count,
    option.reordered_order_count,
    Date.parse(inserted?.eta || ''),
  ]
}

function assertNoDominated(options: Option[]) {
  const vectors = options.filter((option) => option.selectable).map(optionVector)
  for (const left of vectors) {
    for (const right of vectors) {
      if (left === right) continue
      const noWorse = right.every((value, index) => value <= left[index])
      const strictlyBetter = right.some((value, index) => value < left[index])
      expect(noWorse && strictlyBetter).toBe(false)
    }
  }
}

test('A 區塊：插單對話、缺欄契約與兩則訊息摘要', async ({ page }) => {
  test.setTimeout(900_000)
  installSession(page, `SCENARIO-A-${test.info().testId}`)
  await upload(page, relaxedWorkbook, '50/50 已安排')

  const complete = await send(page, '加一張急單 ORD-101，大安信義交界示範配送點 Z3-51，臺北市，行政區信義，座標 25.040 / 121.560，配送區域 Z3，1 件 15 公斤，早上時段')
  expect(complete.message || '').toContain('我記下來了，確認一下')
  expect(urgentData(complete).stage).toBe('REVIEW_READY')
  await expect(page.getByRole('button', { name: '產生插單預覽' }).last()).toBeVisible()
  await saveScreenshot(page, screenshotDir, 'A-01')

  await page.getByRole('button', { name: '重新開始' }).click()
  await expect(page.getByText('下載範例格式')).toBeVisible()
  await page.getByLabel('上傳 Excel').setInputFiles(relaxedWorkbook)
  await expect(page.locator('.topbar-stats')).toContainText('50/50 已安排', { timeout: 180_000 })
  const missing = await send(page, '客戶剛剛打電話來，信義區有一張急單要今天早上送到，15公斤')
  expect(missing.message || '').toContain('目前還不能計算')
  expect(missing.message || '').not.toContain('配送地點（地址或座標）')
  for (const label of ['訂單編號', '地點名稱', '城市', '緯度', '經度', '包裹件數']) await expect(page.getByText(label, { exact: false }).last()).toBeVisible()
  expect(missing.message || '').not.toContain('配送區域')
  expect(missing.message || '').not.toContain('優先')
  await saveScreenshot(page, screenshotDir, 'A-02')

  const completion = await send(page, 'ORD-101，大安信義交界示範配送點 Z3-51，臺北市，行政區信義，25.040，121.560，Z3，1 件')
  expect(completion.message || '').toContain('我記下來了，確認一下')
  expect(urgentData(completion).stage).toBe('REVIEW_READY')
  await saveScreenshot(page, screenshotDir, 'A-03')

  await page.getByRole('button', { name: '重新開始' }).click()
  await expect(page.getByText('下載範例格式')).toBeVisible()
  await page.getByLabel('上傳 Excel').setInputFiles(relaxedWorkbook)
  await expect(page.locator('.topbar-stats')).toContainText('50/50 已安排', { timeout: 180_000 })
  const districtOnly = await send(page, '信義區有一張急單')
  const districtData = urgentData(districtOnly)
  const missingByOrder = districtData.missing_by_order as Array<{ missing_fields: string[] }>
  expect(missingByOrder[0]?.missing_fields || []).not.toContain('zone_code')
  await saveScreenshot(page, screenshotDir, 'A-05')
})

test('A-08：同一句補齊訊息五次都進入摘要', async ({ page }) => {
  test.setTimeout(1_200_000)
  let sessionId = ''
  page.route('**/api/v1/agent/chat', async (route) => {
    const payload = JSON.parse(route.request().postData() || '{}') as Record<string, unknown>
    payload.session_id = sessionId
    await route.continue({ postData: JSON.stringify(payload) })
  })
  const replies: string[] = []
  for (let run = 1; run <= 5; run += 1) {
    sessionId = `SCENARIO-A08-${test.info().testId}-${run}`
    await upload(page, relaxedWorkbook, '50/50 已安排')
    await send(page, '客戶剛剛打電話來，信義區有一張急單要今天早上送到，15公斤')
    const completion = await send(page, 'ORD-101，大安信義交界示範配送點 Z3-51，臺北市，行政區信義，25.040，121.560，Z3，1 件')
    replies.push(completion.message || JSON.stringify(completion))
    expect(completion.message || '').toContain('我記下來了，確認一下')
    await page.getByRole('button', { name: '重新開始' }).click()
    await expect(page.getByText('下載範例格式')).toBeVisible()
  }
  console.log(`A-08 實際成功率：${replies.filter((reply) => reply.includes('我記下來了，確認一下')).length}/5`)
  await saveScreenshot(page, screenshotDir, 'A-08')
})

test('A-09：有完整座標時不追問地點名稱', async ({ page }) => {
  test.setTimeout(240_000)
  installSession(page, `SCENARIO-A09-${test.info().testId}`)
  await upload(page, relaxedWorkbook, '50/50 已安排')
  const completion = await send(page, '新增急單 ORD-A09，臺北市，行政區信義，配送區域 Z4，座標 25.033 / 121.565，1 件 15 公斤，早上時段')
  expect(completion.message || '').toContain('我記下來了，確認一下')
  expect(completion.message || '').not.toContain('地點名稱')
  expect(urgentData(completion).missing_by_order || []).toEqual([])
  await saveScreenshot(page, screenshotDir, 'A-09')
})

test('B 區塊：方案卡是局部插入、可行且沒有支配候選', async ({ page }) => {
  test.setTimeout(900_000)
  installSession(page, `SCENARIO-B-${test.info().testId}`)
  await upload(page, relaxedWorkbook, '50/50 已安排')
  const summary = await send(page, '加一張急單 ORD-101，大安信義交界示範配送點 Z3-51，臺北市，行政區信義，座標 25.040 / 121.560，配送區域 Z3，1 件 15 公斤，早上時段')
  expect(summary.message || '').toContain('我記下來了，確認一下')
  const response = await preview(page)
  const options = optionsFrom(response).filter((option) => option.selectable)
  expect(options.length).toBeGreaterThanOrEqual(2)
  expect(options.every((option) => option.feasible && option.validator.valid)).toBe(true)
  expect(options.every((option) => option.cost.distance_delta_m !== null && option.cost.distance_delta_m >= 0)).toBe(true)
  expect(options.every((option) => option.cost.duration_delta_s !== null && option.cost.duration_delta_s >= 0)).toBe(true)
  expect(options.every((option) => option.cost.vehicle_change_count <= 3)).toBe(true)
  expect(options.every((option) => !['FASTEST', 'BALANCED', 'STABLE', 'MINIMAL_CHANGE'].some((name) => option.title.includes(name)))).toBe(true)
  assertNoDominated(options)
  const cards = page.getByRole('group', { name: '臨時插單方案' }).last().locator('button.urgent-card')
  await expect(cards).toHaveCount(options.length)
  await cards.nth(1).focus()
  await page.keyboard.press('Enter')
  await expect(cards.nth(1)).toHaveAttribute('aria-pressed', 'true')
  await saveScreenshot(page, screenshotDir, 'B-01')
})

test('I 區塊：tight 的排不進去與三公里以上取捨', async ({ page }) => {
  test.setTimeout(900_000)
  installSession(page, `SCENARIO-I-${test.info().testId}`)
  await upload(page, tightWorkbook, '49/50 已安排')
  const bodyText = await page.locator('body').innerText()
  expect(bodyText).toContain('49/50 已安排')
  expect(bodyText).toContain('ORD-050')
  await saveScreenshot(page, screenshotDir, 'I-01')

  const summary = await send(page, '新增急單 ORD-101，配送區域 Z3，城市臺北市，行政區信義，地點名稱大安信義交界示範配送點 Z3-51，緯度 25.040，經度 121.560，包裹件數 1，每件重量 15 公斤，早上配送')
  expect(summary.message || '').toContain('我記下來了，確認一下')
  const response = await preview(page)
  const options = optionsFrom(response).filter((option) => option.selectable)
  expect(options.length).toBeGreaterThanOrEqual(2)
  const distances = options.map((option) => option.cost.distance_delta_km as number)
  expect(Math.max(...distances) - Math.min(...distances)).toBeGreaterThanOrEqual(3)
  assertNoDominated(options)
  await saveScreenshot(page, screenshotDir, 'I-02')

  await page.getByRole('button', { name: '重新開始' }).click()
  await expect(page.getByText('下載範例格式')).toBeVisible()
  await page.getByLabel('上傳 Excel').setInputFiles(tightWorkbook)
  await expect(page.locator('.topbar-stats')).toContainText('49/50 已安排', { timeout: 180_000 })
  const heavy = await send(page, '新增急單 ORD-I03，配送區域 Z5，城市臺北市，行政區內湖，地點名稱內湖超重示範站，緯度 25.083，經度 121.590，包裹件數 1，每件重量 200 公斤，早上配送')
  expect(heavy.message || '').toContain('我記下來了，確認一下')
  const heavyPreview = await preview(page)
  const heavyOptions = optionsFrom(heavyPreview)
  expect(heavyOptions.some((option) => option.title === '排不進去' && !option.selectable)).toBe(true)
  expect(JSON.stringify(urgentData(heavyPreview))).toContain('ORD-I03')
  await saveScreenshot(page, screenshotDir, 'I-03')
})
