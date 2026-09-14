import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

const relaxedWorkbook = path.resolve('..', 'data', 'samples', 'demo-50-relaxed.xlsx')
const tightWorkbook = path.resolve('..', 'data', 'samples', 'demo-50-tight.xlsx')
const screenshotDir = path.resolve('..', 'docs', 'screenshots')

function installBrowserGuards(page: Page) {
  const consoleErrors: string[] = []
  const dispatchRequests: string[] = []
  const googleRequests: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/plans/') && request.url().endsWith('/dispatch')) dispatchRequests.push(request.url())
    if (request.url().includes('googleapis.com')) googleRequests.push(request.url())
  })
  return { consoleErrors, dispatchRequests, googleRequests }
}

async function importPlan(page: Page, workbook: string, completionNotice: string) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByLabel('上傳 Excel').setInputFiles(workbook)
  await expect(page.getByText(completionNotice)).toBeVisible({ timeout: 180_000 })
  await expect(page.getByLabel('配送地圖', { exact: true })).toBeVisible({ timeout: 30_000 })
}

async function importRelaxedPlan(page: Page) {
  await importPlan(page, relaxedWorkbook, '已完成 50／50 張訂單的排班，方案待人工確認。')
}

async function pageWidthMetrics(page: Page) {
  return await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    pageHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
  }))
}

async function waitForMapTiles(page: Page) {
  await expect.poll(async () => await page.locator('.leaflet-tile').evaluateAll((images) => images.length > 0 && images.every((image) => {
    const tile = image as HTMLImageElement
    return tile.complete && tile.naturalWidth > 0
  })), { timeout: 60_000 }).toBeTruthy()
}

test('E-01～E-04：服務狀態、首頁載入與空狀態', async ({ page, request }) => {
  test.setTimeout(60_000)
  const guards = installBrowserGuards(page)
  await page.setViewportSize({ width: 1440, height: 900 })

  const health = await request.get('http://127.0.0.1:8000/health')
  expect(health.status()).toBe(200)
  expect((await health.json()).status).toBe('ok')
  await page.goto('/')
  await page.screenshot({ path: path.join(screenshotDir, 'E-01.png'), fullPage: true })

  const ready = await request.get('http://127.0.0.1:8000/ready')
  expect(ready.status()).toBe(200)
  const readyBody = await ready.json()
  expect(readyBody.components.google_routes).toBe('disabled')
  await page.screenshot({ path: path.join(screenshotDir, 'E-02.png'), fullPage: true })

  await expect(page.getByRole('heading', { name: '配送調度控制塔' })).toBeVisible()
  await expect(page.getByLabel('上傳 Excel')).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, 'E-03.png'), fullPage: true })

  const emptyText = await page.locator('body').innerText()
  expect(emptyText).not.toContain('— 張')
  expect(emptyText).not.toContain('— 台')
  expect(emptyText).not.toContain('尚未建立')
  await page.screenshot({ path: path.join(screenshotDir, 'E-04.png'), fullPage: true })

  expect(guards.consoleErrors).toEqual([])
  expect(guards.dispatchRequests).toEqual([])
  expect(guards.googleRequests).toEqual([])
})

test('E-05～E-09：OSM 地圖、外連護欄與新版寬度', async ({ page }) => {
  test.setTimeout(180_000)
  const guards = installBrowserGuards(page)
  await importRelaxedPlan(page)

  await expect(page.locator('.leaflet-map')).toBeVisible()
  await expect(page.locator('.leaflet-tile').first()).toBeVisible({ timeout: 60_000 })
  await waitForMapTiles(page)
  await page.screenshot({ path: path.join(screenshotDir, 'E-05.png'), fullPage: true })

  await expect(page.locator('.map-overlay-attrib')).toHaveText('© OpenStreetMap contributors')
  await expect(page.locator('.leaflet-control-attribution')).toContainText('© OpenStreetMap contributors')
  await expect(page.getByText('示意路線', { exact: true })).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, 'E-07.png'), fullPage: true })

  const wideMetrics = await pageWidthMetrics(page)
  expect(wideMetrics.documentWidth).toBeLessThanOrEqual(wideMetrics.viewportWidth)
  expect(wideMetrics.bodyWidth).toBeLessThanOrEqual(wideMetrics.viewportWidth)
  await page.setViewportSize({ width: 1280, height: 900 })
  const narrowMetrics = await pageWidthMetrics(page)
  expect(narrowMetrics.documentWidth).toBeLessThanOrEqual(narrowMetrics.viewportWidth)
  expect(narrowMetrics.bodyWidth).toBeLessThanOrEqual(narrowMetrics.viewportWidth)
  await page.screenshot({ path: path.join(screenshotDir, 'E-08.png'), fullPage: true })

  const pageText = await page.locator('body').innerText()
  for (const icon of ['✦', '▣', '⌖']) expect(pageText).not.toContain(icon)
  await page.screenshot({ path: path.join(screenshotDir, 'E-09.png'), fullPage: true })

  expect(guards.googleRequests).toEqual([])
  expect(guards.dispatchRequests).toEqual([])
  expect(guards.consoleErrors).toEqual([])
})

test('新版版面：1440×900 完整頁面與實際高度', async ({ page }) => {
  test.setTimeout(180_000)
  const guards = installBrowserGuards(page)
  await importRelaxedPlan(page)
  await waitForMapTiles(page)
  await expect(page.getByRole('heading', { name: '方案已建立，有什麼要調整的？' })).toBeVisible()
  await expect(page.getByText('先放入今天的訂單', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '選擇 Excel 檔案', exact: true })).toHaveCount(0)
  for (const label of ['LIVE BOARD', 'DISPATCH COPILOT', 'CAPACITY', 'DISPATCH RULES', 'ROUTE DETAIL', 'Dispatch rules', 'Control tower']) {
    await expect(page.getByText(label, { exact: true })).toHaveCount(0)
  }

  const chatCard = await page.locator('.stage-chat > *').boundingBox()
  const sendButton = page.getByRole('button', { name: '送出', exact: true })
  const attachButton = page.getByRole('button', { name: '附加檔案', exact: true })
  await expect(sendButton).toBeVisible()
  await expect(attachButton).toBeVisible()
  const sendBox = await sendButton.boundingBox()
  const mapShell = page.getByLabel('配送地圖', { exact: true })
  const fleetRail = await page.getByLabel('車輛進度', { exact: true }).boundingBox()
  const leafletAttribution = await page.locator('.leaflet-control-attribution').boundingBox()
  await expect(page.getByRole('heading', { name: '配送地圖' })).toHaveCount(0)
  const stageBox = await page.locator('.stage').boundingBox()
  const mapBox = await mapShell.boundingBox()
  const mapSummary = await page.getByText('50 個站點', { exact: true }).boundingBox()
  if (!chatCard || !sendBox || !fleetRail || !leafletAttribution || !stageBox || !mapBox || !mapSummary) throw new Error('新版版面必要元素沒有可測量的位置')
  expect(sendBox.y + sendBox.height).toBeLessThanOrEqual(chatCard.y + chatCard.height + 1)
  const chatToFleetGap = fleetRail.y - (chatCard.y + chatCard.height)
  expect(chatToFleetGap).toBeGreaterThan(0)
  const attributionVisibleAboveFleet = await page.locator('.leaflet-control-attribution').evaluate((node) => {
    const rect = node.getBoundingClientRect()
    const point = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return Boolean(point && node.contains(point))
  })
  expect(attributionVisibleAboveFleet).toBeTruthy()
  console.log(`layout-v2 spacing: ${JSON.stringify({ chatToFleetGap, fleetRail, leafletAttribution, attributionVisibleAboveFleet })}`)
  expect(mapBox.width).toBeGreaterThan(stageBox.width - 60)
  expect(mapBox.height).toBeGreaterThan(stageBox.height - 40)
  expect(mapSummary.x).toBeGreaterThanOrEqual(mapBox.x)
  expect(mapSummary.x + mapSummary.width).toBeLessThanOrEqual(mapBox.x + mapBox.width)
  const metrics = await pageWidthMetrics(page)
  expect(metrics.viewportWidth).toBe(1440)
  expect(metrics.pageHeight).toBeLessThanOrEqual(2000)
  await page.screenshot({ path: path.join(screenshotDir, 'layout-v2.png'), fullPage: true })
  console.log(`layout-v2 metrics: ${JSON.stringify(metrics)}`)
  expect(guards.consoleErrors).toEqual([])
  expect(guards.dispatchRequests).toEqual([])
  expect(guards.googleRequests).toEqual([])
})

test('F1-01、F1-11～F1-15：50 單排班、四車明細與方案狀態', async ({ page }) => {
  test.setTimeout(180_000)
  const guards = installBrowserGuards(page)
  await importRelaxedPlan(page)
  await expect(page.getByRole('heading', { name: '方案已建立，有什麼要調整的？' })).toBeVisible()
  await expect(page.getByText('先放入今天的訂單', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '選擇 Excel 檔案', exact: true })).toHaveCount(0)

  const stats = page.locator('.topbar-stats')
  await expect(stats).toContainText('50 張訂單')
  await expect(stats).toContainText('4 台車')
  await expect(stats).toContainText('50/50 已安排')
  await expect(page.getByLabel('車輛概況')).toContainText('載重')
  await page.screenshot({ path: path.join(screenshotDir, 'F1-01.png'), fullPage: true })

  await expect(stats).toContainText('50/50 已安排')
  await expect(page.locator('.fleet-row')).toHaveCount(4)
  await page.screenshot({ path: path.join(screenshotDir, 'F1-11.png'), fullPage: true })

  const vehicleBoard = page.getByLabel('車輛概況')
  await expect(vehicleBoard).toContainText('載重')
  await expect(vehicleBoard).toContainText('上限')
  await expect(vehicleBoard).toContainText('服務區域')
  await expect(vehicleBoard).toContainText('km')
  await expect(vehicleBoard).toContainText('分鐘')
  await expect(vehicleBoard.locator('button')).toHaveCount(4)
  await page.screenshot({ path: path.join(screenshotDir, 'F1-12.png'), fullPage: true })

  const firstOrder = page.locator('.data-table tbody tr').filter({ hasText: 'ORD-001' }).first()
  await firstOrder.click()
  await expect(page.getByText('方案檢查通過')).toBeVisible()
  await expect(page.locator('body')).toContainText('推薦理由：')
  await expect(page.locator('body')).toContainText('第 ')
  await page.screenshot({ path: path.join(screenshotDir, 'F1-13.png'), fullPage: true })

  await page.getByRole('button', { name: '重新開始' }).click()
  await expect(page.getByRole('heading', { name: '配送調度控制塔' })).toBeVisible()
  await importPlan(page, tightWorkbook, '已完成 49／50 張訂單的排班，方案待人工確認。')
  const reassignedOrder = page.locator('.data-table tbody tr').filter({ hasText: 'ORD-041' }).first()
  await reassignedOrder.click()
  await expect(page.getByText('原本會超過', { exact: false }).first()).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, 'F1-14.png'), fullPage: true })

  await expect(page.getByText('方案待人工確認。', { exact: false }).first()).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, 'F1-15.png'), fullPage: true })

  expect(guards.consoleErrors).toEqual([])
  expect(guards.dispatchRequests).toEqual([])
  expect(guards.googleRequests).toEqual([])
})
