import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

import { saveScreenshot } from './screenshot-helper'

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
  // 選檔案只是附加，要按【送出】才會上傳排班。
  await page.getByRole('button', { name: '送出', exact: true }).click()
  // 數字被 <strong> 拆成兩段，getByText 抓不到整串，用容器比對。
  await expect(page.locator('.topbar-stats')).toContainText(completionNotice, { timeout: 180_000 })
  await expect(page.getByLabel('配送地圖', { exact: true })).toBeVisible({ timeout: 30_000 })
}

async function importRelaxedPlan(page: Page) {
  await importPlan(page, relaxedWorkbook, '50/50 已安排')
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
  await saveScreenshot(page, screenshotDir, 'E-01')

  const ready = await request.get('http://127.0.0.1:8000/ready')
  expect(ready.status()).toBe(200)
  const readyBody = await ready.json()
  expect(readyBody.components.google_routes).toBe('disabled')
  await saveScreenshot(page, screenshotDir, 'E-02')

  await expect(page.getByRole('heading', { name: '配送調度控制塔' })).toBeVisible()
  await expect(page.getByLabel('上傳 Excel')).toBeVisible()
  await saveScreenshot(page, screenshotDir, 'E-03')

  const emptyText = await page.locator('body').innerText()
  expect(emptyText).not.toContain('— 張')
  expect(emptyText).not.toContain('— 台')
  expect(emptyText).not.toContain('尚未建立')
  await saveScreenshot(page, screenshotDir, 'E-04')

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
  await saveScreenshot(page, screenshotDir, 'E-05')

  // OSM 版權只留 Leaflet 自己那一份；原本額外畫的那行被對話框蓋住，是多餘的。
  await expect(page.locator('.map-overlay-attrib')).toHaveCount(0)
  await expect(page.locator('.leaflet-control-attribution')).toContainText('© OpenStreetMap contributors')
  await expect(page.getByText('示意路線', { exact: true })).toBeVisible()
  await saveScreenshot(page, screenshotDir, 'E-07')

  const wideMetrics = await pageWidthMetrics(page)
  expect(wideMetrics.documentWidth).toBeLessThanOrEqual(wideMetrics.viewportWidth)
  expect(wideMetrics.bodyWidth).toBeLessThanOrEqual(wideMetrics.viewportWidth)
  await page.setViewportSize({ width: 1280, height: 900 })
  const narrowMetrics = await pageWidthMetrics(page)
  expect(narrowMetrics.documentWidth).toBeLessThanOrEqual(narrowMetrics.viewportWidth)
  expect(narrowMetrics.bodyWidth).toBeLessThanOrEqual(narrowMetrics.viewportWidth)
  await saveScreenshot(page, screenshotDir, 'E-08')

  const pageText = await page.locator('body').innerText()
  for (const icon of ['✦', '▣', '⌖']) expect(pageText).not.toContain(icon)
  await saveScreenshot(page, screenshotDir, 'E-09')

  expect(guards.googleRequests).toEqual([])
  expect(guards.dispatchRequests).toEqual([])
  expect(guards.consoleErrors).toEqual([])
})

test('新版版面：1440×900 完整頁面與實際高度', async ({ page }) => {
  test.setTimeout(180_000)
  const guards = installBrowserGuards(page)
  await importRelaxedPlan(page)
  await waitForMapTiles(page)
  // 面板標題是「調度對話」；下一行的「先放入今天的訂單」不存在才是「已有方案」的判斷。
  await expect(page.getByRole('heading', { name: '調度對話' })).toBeVisible()
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
  // 車輛進度線與「車輛概況」都收掉了，那些數字進了訂單看板的欄頭。
  const boardBox = await page.getByLabel('訂單看板', { exact: true }).boundingBox()
  const leafletAttribution = await page.locator('.leaflet-control-attribution').boundingBox()
  await expect(page.getByRole('heading', { name: '配送地圖' })).toHaveCount(0)
  const stageBox = await page.locator('.stage').boundingBox()
  const mapBox = await mapShell.boundingBox()
  // 站點數與車輛篩選移到頂列，不再浮在地圖上。
  const topbarBox = await page.locator('.topbar').boundingBox()
  const mapSummary = await page.getByText('50 個站點', { exact: true }).boundingBox()
  if (!chatCard || !sendBox || !boardBox || !leafletAttribution || !stageBox || !mapBox || !mapSummary || !topbarBox) throw new Error('新版版面必要元素沒有可測量的位置')
  expect(sendBox.y + sendBox.height).toBeLessThanOrEqual(chatCard.y + chatCard.height + 1)
  // 底下的進度線拿掉之後，對話框要用到舞台底部，不是停在半空中。
  const chatToStageBottom = stageBox.y + stageBox.height - (chatCard.y + chatCard.height)
  expect(chatToStageBottom).toBeGreaterThanOrEqual(0)
  expect(chatToStageBottom).toBeLessThan(60)
  // 看板在舞台下方的明細區，不會蓋到對話框。
  expect(boardBox.y).toBeGreaterThan(chatCard.y)
  const attributionVisible = await page.locator('.leaflet-control-attribution').evaluate((node) => {
    const rect = node.getBoundingClientRect()
    const point = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return Boolean(point && node.contains(point))
  })
  expect(attributionVisible).toBeTruthy()
  expect(mapBox.width).toBeGreaterThan(stageBox.width - 60)
  expect(mapBox.height).toBeGreaterThan(stageBox.height - 40)
  // 站點數現在排在頂列的統計列旁邊，整塊要落在頂列裡面。
  expect(mapSummary.y).toBeGreaterThanOrEqual(topbarBox.y)
  expect(mapSummary.y + mapSummary.height).toBeLessThanOrEqual(topbarBox.y + topbarBox.height)
  const metrics = await pageWidthMetrics(page)
  expect(metrics.viewportWidth).toBe(1440)
  expect(metrics.pageHeight).toBeLessThanOrEqual(2000)
  await saveScreenshot(page, screenshotDir, 'layout-v2')
  console.log(`layout-v2 metrics: ${JSON.stringify(metrics)}`)
  expect(guards.consoleErrors).toEqual([])
  expect(guards.dispatchRequests).toEqual([])
  expect(guards.googleRequests).toEqual([])
})

test('F1-01、F1-11～F1-15：50 單排班、四車明細與方案狀態', async ({ page }) => {
  test.setTimeout(180_000)
  const guards = installBrowserGuards(page)
  await importRelaxedPlan(page)
  // 面板標題是「調度對話」；下一行的「先放入今天的訂單」不存在才是「已有方案」的判斷。
  await expect(page.getByRole('heading', { name: '調度對話' })).toBeVisible()
  await expect(page.getByText('先放入今天的訂單', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '選擇 Excel 檔案', exact: true })).toHaveCount(0)

  const stats = page.locator('.topbar-stats')
  await expect(stats).toContainText('50 張訂單')
  await expect(stats).toContainText('4 台車')
  await expect(stats).toContainText('50/50 已安排')
  // 每台車的載重、站數、里程、時間、責任區現在都在訂單看板的欄頭。
  const board = page.getByLabel('訂單看板', { exact: true })
  await expect(board.locator('.order-board-column')).toHaveCount(4)
  await expect(board.locator('.obh-bar')).toHaveCount(4)
  await saveScreenshot(page, screenshotDir, 'F1-01')

  await expect(stats).toContainText('50/50 已安排')
  await saveScreenshot(page, screenshotDir, 'F1-11')

  const firstColumn = board.locator('.order-board-column').first()
  await expect(firstColumn).toContainText('站')
  await expect(firstColumn).toContainText('kg')
  await expect(firstColumn).toContainText('km')
  await expect(firstColumn).toContainText('分鐘')
  await expect(firstColumn).toContainText('區')
  // 每一列都要有重量與預估到達，不是只有一串訂單編號。
  await expect(firstColumn.locator('.obs-kg').first()).toBeVisible()
  await expect(firstColumn.locator('.obs-eta').first()).toBeVisible()
  await saveScreenshot(page, screenshotDir, 'F1-12')

  // 訂單明細改成點看板那一列展開（舊的 .data-table 已經不存在）。
  await page.locator('[data-order-id="ORD-001"] .order-board-order').first().click()
  await expect(page.getByLabel('ORD-001 配送明細')).toBeVisible()
  await expect(page.locator('body')).toContainText('推薦理由：')
  await saveScreenshot(page, screenshotDir, 'F1-13')

  await page.getByRole('button', { name: '重新開始' }).click()
  await expect(page.getByRole('heading', { name: '配送調度控制塔' })).toBeVisible()
  await importPlan(page, tightWorkbook, '49/50 已安排')
  await page.locator('[data-order-id="ORD-041"] .order-board-order').first().click()
  await expect(page.getByLabel('ORD-041 配送明細')).toBeVisible()
  await saveScreenshot(page, screenshotDir, 'F1-14')

  // tight 這份有一張排不進去，看板下方要把原因寫出來。
  await expect(page.locator('.order-board-unassigned')).toBeVisible()
  await saveScreenshot(page, screenshotDir, 'F1-15')

  expect(guards.consoleErrors).toEqual([])
  expect(guards.dispatchRequests).toEqual([])
  expect(guards.googleRequests).toEqual([])
})
