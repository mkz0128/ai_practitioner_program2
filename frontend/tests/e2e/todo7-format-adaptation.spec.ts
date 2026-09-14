import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const samplesDir = path.resolve('..', 'data', 'samples')
const screenshotDir = path.resolve('..', 'docs', 'screenshots')
const mappedWorkbook = path.join(samplesDir, 'demo-mapped-50.xlsx')
const missingWorkbook = path.join(samplesDir, 'demo-missing-fields.xlsx')
const emptyWorkbook = path.join(samplesDir, 'demo-empty.xlsx')
const duplicateWorkbook = path.join(samplesDir, 'demo-duplicate-id.xlsx')
const relaxedWorkbook = path.join(samplesDir, 'demo-50-relaxed.xlsx')

function installBrowserGuards(page: Page) {
  const consoleErrors: string[] = []
  const dispatchRequests: string[] = []
  const googleRequests: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('request', (request) => {
    if (request.url().endsWith('/dispatch')) dispatchRequests.push(request.url())
    if (request.url().includes('googleapis.com')) googleRequests.push(request.url())
  })
  return { consoleErrors, dispatchRequests, googleRequests }
}

async function waitForPlan(page: Page) {
  await expect(page.getByText('已完成 50／50 張訂單的排班，方案待人工確認。')).toBeVisible({ timeout: 180_000 })
  await expect(page.getByLabel('配送地圖', { exact: true })).toBeVisible({ timeout: 30_000 })
}

async function resetToEmpty(page: Page) {
  const reset = page.getByRole('button', { name: '重新開始' })
  if (await reset.isVisible()) await reset.click()
  await expect(page.getByText('下載範例格式')).toBeVisible({ timeout: 30_000 })
}

async function upload(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  await page.getByLabel('上傳 Excel').setInputFiles(file)
}

test('TODO 7：F1-02～F1-07 欄位對映、人工確認、保存與修正後匯入', async ({ page }, testInfo) => {
  test.setTimeout(600_000)
  const guards = installBrowserGuards(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')

  const mappedBuffer = await readFile(mappedWorkbook)
  const mappedFile = {
    name: `demo-mapped-browser-${testInfo.workerIndex}-${Date.now()}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: mappedBuffer,
  }

  const inspectResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/datasets/inspect-excel') && response.request().method() === 'POST')
  await upload(page, mappedFile)
  const inspected = await inspectResponse
  expect(inspected.ok()).toBeTruthy()
  const inspectedBody = await inspected.json() as { status: string; requires_confirmation: boolean }
  expect(inspectedBody.status).toBe('NEEDS_CONFIRMATION')
  expect(inspectedBody.requires_confirmation).toBeTruthy()
  await expect(page.getByRole('heading', { name: '請確認欄位對映' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('信心度')).toBeVisible()
  await expect(page.locator('.mapping-table tbody tr')).toHaveCount(31)
  await expect(page.locator('.mapping-table td').filter({ hasText: '%' }).first()).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, 'F1-02.png'), fullPage: true })

  const locationMapping = page.getByLabel('欄位 orders 收件區')
  await locationMapping.selectOption('city')
  await expect(locationMapping).toHaveValue('city')
  await page.screenshot({ path: path.join(screenshotDir, 'F1-03.png'), fullPage: true })
  await locationMapping.selectOption('location_label')

  await page.getByLabel('保存名稱（選填）').fill('供應商格式 Demo')
  await page.getByRole('button', { name: '確認欄位對映' }).click()
  await waitForPlan(page)
  await page.screenshot({ path: path.join(screenshotDir, 'F1-04.png'), fullPage: true })

  await resetToEmpty(page)
  const savedInspectResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/datasets/inspect-excel') && response.request().method() === 'POST')
  await upload(page, mappedFile)
  const savedInspect = await savedInspectResponse
  expect(savedInspect.ok()).toBeTruthy()
  const savedBody = await savedInspect.json() as { status: string; requires_confirmation: boolean }
  expect(savedBody.status).toBe('AUTO_APPLIED')
  expect(savedBody.requires_confirmation).toBeFalsy()
  await expect(page.getByRole('heading', { name: '請確認欄位對映' })).toHaveCount(0)
  await waitForPlan(page)
  await page.screenshot({ path: path.join(screenshotDir, 'F1-05.png'), fullPage: true })

  await resetToEmpty(page)
  await upload(page, missingWorkbook)
  const missingAlert = page.getByRole('alert')
  await expect(missingAlert).toContainText('ORD-001')
  await expect(missingAlert).toContainText('ORD-002')
  await expect(missingAlert).toContainText('PKG-003-01')
  await expect(missingAlert).toContainText('缺少必填欄位')
  await expect(missingAlert).toContainText('地點名稱')
  await expect(missingAlert).toContainText('配送時段')
  await expect(missingAlert).toContainText('重量')
  for (const machineField of ['location_label', 'time_slot', 'weight_kg']) {
    await expect(missingAlert).not.toContainText(machineField)
  }
  await page.screenshot({ path: path.join(screenshotDir, 'F1-06.png'), fullPage: true })

  await upload(page, relaxedWorkbook)
  await waitForPlan(page)
  await page.screenshot({ path: path.join(screenshotDir, 'F1-07.png'), fullPage: true })

  expect(guards.consoleErrors).toEqual([])
  expect(guards.dispatchRequests).toEqual([])
  expect(guards.googleRequests).toEqual([])
})

test('TODO 7：F1-08～F1-10 檔案錯誤、空資料與重複訂單', async ({ page }) => {
  test.setTimeout(300_000)
  const guards = installBrowserGuards(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')

  await upload(page, {
    name: 'not-an-excel.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from('this is not an xlsx workbook'),
  })
  await expect(page.getByRole('alert')).toContainText('不是可讀取的 Excel', { timeout: 30_000 })
  await page.screenshot({ path: path.join(screenshotDir, 'F1-08.png'), fullPage: true })

  await resetToEmpty(page)
  await upload(page, emptyWorkbook)
  await expect(page.getByRole('alert')).toContainText('至少提供一筆訂單', { timeout: 30_000 })
  await page.screenshot({ path: path.join(screenshotDir, 'F1-09.png'), fullPage: true })

  await resetToEmpty(page)
  await upload(page, duplicateWorkbook)
  const duplicateAlert = page.getByRole('alert')
  await expect(duplicateAlert).toContainText('ORD-001', { timeout: 30_000 })
  await expect(duplicateAlert).toContainText('重複')
  await page.screenshot({ path: path.join(screenshotDir, 'F1-10.png'), fullPage: true })

  expect(guards.consoleErrors).toEqual([])
  expect(guards.dispatchRequests).toEqual([])
  expect(guards.googleRequests).toEqual([])
})
