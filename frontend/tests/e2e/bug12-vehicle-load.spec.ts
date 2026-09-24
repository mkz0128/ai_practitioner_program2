import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

import { saveScreenshot } from './screenshot-helper'

const relaxedWorkbook = path.resolve('..', 'data', 'samples', 'demo-50-relaxed.xlsx')
const screenshotDir = path.resolve('..', 'docs', 'screenshots')

type Evidence = { tool: string; data: Record<string, unknown> }
type AgentBody = { message?: string; evidence?: Evidence[]; usage?: { total_tokens?: number }; runner_result_type?: string }
type VehiclePlan = { vehicle_id: string; planned_load_kg: number; max_load_kg: number; load_utilization: number }
type PlanBody = { vehicles: VehiclePlan[] }

function installBrowserGuards(page: Page) {
  const consoleErrors: string[] = []
  const dispatchRequests: string[] = []
  const googleRequests: string[] = []
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    const expectedNetworkFailure = text.includes('Failed to load resource:') || text.includes('net::ERR_NETWORK_ACCESS_DENIED')
    if (!expectedNetworkFailure) consoleErrors.push(text)
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/plans/') && request.url().endsWith('/dispatch')) dispatchRequests.push(request.url())
    if (request.url().includes('googleapis.com')) googleRequests.push(request.url())
  })
  return { consoleErrors, dispatchRequests, googleRequests }
}

async function send(page: Page, message: string): Promise<AgentBody> {
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST',
    { timeout: 180_000 },
  )
  await input.fill(message)
  await input.press('Enter')
  const response = await responsePromise
  const raw = await response.text()
  expect(response.ok(), `輸入：${message}\n系統實際回覆：${raw}`).toBeTruthy()
  return JSON.parse(raw) as AgentBody
}

function formatWeight(value: number): string {
  return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 }).format(value)
}

test('BUG-12：點名四台車都用 vehicle_load 並回覆畫面上的數字', async ({ page }) => {
  test.setTimeout(1_200_000)
  const guards = installBrowserGuards(page)

  await page.goto('/')
  const planResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/plans') && response.request().method() === 'POST',
    { timeout: 180_000 },
  )
  await page.getByLabel('上傳 Excel').setInputFiles(relaxedWorkbook)
  // 選檔案只是附加，要按【送出】才會上傳排班。
  await page.getByRole('button', { name: '送出', exact: true }).click()
  const plan = JSON.parse(await (await planResponse).text()) as PlanBody
  // 排班完成的綠色提示拿掉了，改用上排統計列當完成訊號。
  await expect(page.locator('.topbar-stats')).toContainText('已安排', { timeout: 180_000 })

  const vehicleLabels = ['一號車', '二號車', '三號車', '四號車']
  for (const [index, label] of vehicleLabels.entries()) {
    const expected = plan.vehicles.find((vehicle) => vehicle.vehicle_id === `VEH-00${index + 1}`)
    expect(expected).toBeTruthy()
    const body = await send(page, `${label}載重多少`)
    const evidence = body.evidence?.find((item) => item.tool === 'vehicle_load')
    expect(evidence?.data.vehicle_id).toBe(expected?.vehicle_id)
    expect(evidence?.data.planned_load_kg).toBe(expected?.planned_load_kg)
    expect(typeof body.usage?.total_tokens).toBe('number')
    expect(body.usage?.total_tokens).toBeGreaterThan(0)
    expect(body.runner_result_type).not.toBe('NoneType')

    const assistantBubble = page.locator('.chat-log > div').last()
    await expect(assistantBubble).toContainText(`${expected?.vehicle_id} 目前計畫載重 ${formatWeight(expected?.planned_load_kg || 0)} kg`)
    // 「車輛概況」那張卡收掉了，載重改在訂單看板的欄頭。助理講的數字要跟
    // 畫面上的同一個。
    const columnIndex = ['VEH-001', 'VEH-002', 'VEH-003', 'VEH-004'].indexOf(expected?.vehicle_id || '')
    const column = page.locator('.order-board-column').nth(columnIndex)
    await expect(column.locator('.obh-meta')).toContainText(`${formatWeight(expected?.planned_load_kg || 0)} kg`)
  }

  await saveScreenshot(page, screenshotDir, 'BUG-12-vehicle-load')
  expect(guards.consoleErrors).toEqual([])
  expect(guards.dispatchRequests).toEqual([])
  expect(guards.googleRequests).toEqual([])
})
