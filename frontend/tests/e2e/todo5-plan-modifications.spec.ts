import { test, expect } from '@playwright/test'
import path from 'node:path'

type Evidence = { tool?: string; data?: Record<string, unknown> }
type AgentBody = { message?: string; evidence?: Evidence[]; error?: { code?: string } }

test('TODO 5 方案卡修改與對話同義句驗收', async ({ page }) => {
  test.skip(!process.env.RUN_LIVE_FRONTEND_E2E, 'Set RUN_LIVE_FRONTEND_E2E=1 for the real provider gate')
  // 這一支要打二十幾次真的模型；15 分鐘在這台機器上不夠跑完。
  test.setTimeout(2_400_000)
  await page.setViewportSize({ width: 1440, height: 900 })

  const screenshotDir = path.resolve('..', 'docs', 'screenshots')
  const workbook = path.resolve('..', 'data', 'samples', 'demo-50-relaxed.xlsx')
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const consoleErrors: string[] = []
  let dispatchRequests = 0
  let googleRequests = 0
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/plans/') && request.url().endsWith('/dispatch')) dispatchRequests += 1
    if (request.url().includes('googleapis')) googleRequests += 1
  })

  async function send(message: string): Promise<AgentBody> {
    const responsePromise = page.waitForResponse((response) => response.url().includes('/api/v1/agent/chat'), { timeout: 180_000 })
    await input.fill(message)
    await input.press('Enter')
    const response = await responsePromise
    const body = await response.json() as AgentBody
    expect(response.status(), body.error?.code ?? body.message ?? 'agent request failed').toBe(200)
    await expect(page.locator('.processing-bubble')).toHaveCount(0, { timeout: 180_000 })
    return body
  }

  await page.goto('/', { waitUntil: 'commit', timeout: 30_000 })
  await page.getByLabel('上傳 Excel').setInputFiles(workbook)
  // 選檔案只是附加，要按【送出】才會上傳排班。
  await page.getByRole('button', { name: '送出', exact: true }).click()
  // 匯入完成的綠色提示拿掉了；上排的統計列是同一個訊號。
  await expect(page.locator('.topbar-stats')).toContainText('50 張訂單', { timeout: 180_000 })
  await expect(page.locator('.topbar-stats')).toContainText('50/50 已安排', { timeout: 180_000 })
  await expect(input).toBeEnabled({ timeout: 180_000 })

  const missing = await send('加一張到信義區')
  expect(missing.evidence?.some((item) => item.tool === 'urgent_insertion_workflow')).toBeTruthy()
  await expect(page.getByText('訂單編號').last()).toBeVisible()
  await expect(page.getByText('配送時段').last()).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, 'F3-08.png') })

  const urgentSummary = await send('新增急單 URG-TODO5-041，配送區域 Z3，城市臺北市，行政區信義，地點標示信義測試站，座標 25.033,121.565，上午配送，一件 2 公斤，高優先，請先預覽。')
  expect(urgentSummary.evidence?.some((item) => item.tool === 'urgent_insertion_workflow')).toBeTruthy()
  await expect(page.getByRole('button', { name: '產生插單預覽' })).toBeVisible({ timeout: 180_000 })
  const previewResponsePromise = page.waitForResponse((response) => response.url().includes('/api/v1/agent/chat'), { timeout: 180_000 })
  await page.getByRole('button', { name: '產生插單預覽' }).click()
  const previewResponse = await previewResponsePromise
  expect(previewResponse.status()).toBe(200)
  await expect(page.locator('.processing-bubble')).toHaveCount(0, { timeout: 180_000 })
  await expect(page.locator('[aria-label="臨時插單方案"]')).toHaveCount(1)

  const beforeModificationGroups = await page.locator('[aria-label="臨時插單方案"]').count()
  const prioritize = await send('用 A，但這單先送')
  expect(prioritize.evidence?.some((item) => item.tool === 'prioritize_order_preview')).toBeTruthy()
  await expect(page.locator('[aria-label="臨時插單方案"]')).toHaveCount(beforeModificationGroups + 1)
  // 提前配送的回覆現在直接講理由與代價，句尾自己交代能不能套用，不再多加
  // 一句「新方案卡尚未套用」。沒有建立新版本才是這一步要守住的事。
  await expect(page.locator('body')).not.toContainText('已建立新版本')
  await page.screenshot({ path: path.join(screenshotDir, 'F3-09.png') })

  const refused = await send('把所有單重新分配一遍')
  expect(refused.message).toContain('這個我不能改')
  await expect(page.getByText('這個我不能改').last()).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, 'F3-10.png') })

  await page.locator('button.urgent-card').last().click()
  await page.getByRole('button', { name: '取消', exact: true }).last().click()
  await expect(page.getByText('原方案版本沒有變更。').last()).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, 'F3-11.png') })

  // 剛剛按了取消，畫面上的方案卡收掉了，但後端那張急單草稿還在：再講一次
  // URG-TODO5-041 只會把草稿摘要再唸一遍。改點名一張今天本來就在跑的單，
  // 要一組新的提前配送方案來確認套用。
  const secondPrioritize = await send('ORD-019 要提前送')
  expect(secondPrioritize.evidence?.some((item) => item.tool === 'prioritize_order_preview')).toBeTruthy()
  // 「需人工處理」的卡按下去只會給「我自己排／取消」，沒有【確認套用】。
  // 要建立新版本就得挑一張可選的。
  const selectable = page.locator('button.urgent-card:not(.urgent-card-unavailable)').last()
  await expect(selectable).toBeVisible({ timeout: 60_000 })
  await selectable.click()
  await page.getByRole('button', { name: '確認套用' }).last().click()
  await expect(page.getByText('已建立新版本。').last()).toBeVisible({ timeout: 180_000 })
  await expect(page.getByRole('status').filter({ hasText: '建立新版本' }).last()).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, 'F3-12.png') })

  const urgentVariants = [
    '加一張急單',
    '臨時多一張要送',
    '客戶剛剛下單，今天要到',
    '幫我插 ORD-041',
    '有張單漏掉了要補進去',
    '這張單忘記排',
    '來了一筆新的',
    'insert one more order',
  ]
  for (const message of urgentVariants) {
    const body = await send(message)
    expect(body.error).toBeUndefined()
    // 「一張」與「好幾張」是兩個入口工具，但畫面上的結果是同一件事：
    // 進到臨時插單流程，把缺的欄位一次列出來。兩個都算數。
    // 「幫我插 ORD-041」比較特別：ORD-041 今天本來就在單子裡，這句話可以讀成
    // 「插一張新的」也可以讀成「把它換到別台車」。回頭問「要換到哪一台車」
    // 一樣是誠實的答案，重點是不要自己挑一台車來湊。
    const urgentTools = ['urgent_insertion_workflow', 'preview_multiple_urgent_insert', 'reassign_order_preview']
    expect(
      body.evidence?.some((item) => urgentTools.includes(item.tool || '')),
      `輸入：${message}\n系統實際回覆：${body.message}`,
    ).toBeTruthy()
    for (const invented of ['第一車', '第二車', '第三車', '第四車']) {
      expect(body.message ?? '', `輸入：${message}：回覆點了沒人提過的車`).not.toContain(invented)
    }
    // 每一種說法都要從乾淨的狀態測。不放掉草稿的話，第一句就把草稿開著，
    // 後面七句全部撞在同一張還沒填完的單上。
    await send('算了不要了')
  }
  await page.screenshot({ path: path.join(screenshotDir, 'R-04.png') })

  const earlyDeliveryVariants = ['ORD-019 要提前', '客戶說中午前一定要拿到', '這單能不能早點送', '先送 ORD-019']
  for (const message of earlyDeliveryVariants) {
    const body = await send(message)
    expect(body.error).toBeUndefined()
    expect(body.message ?? '').not.toContain('AGENT_RUN_FAILED')
  }
  await page.screenshot({ path: path.join(screenshotDir, 'R-06.png') })

  const unknownChange = await send('這批貨的順序我想動一下')
  expect(unknownChange.error).toBeUndefined()
  expect(unknownChange.message ?? '').not.toContain('AGENT_RUN_FAILED')
  await expect(page.getByText('AGENT_RUN_FAILED')).toHaveCount(0)
  await page.screenshot({ path: path.join(screenshotDir, 'R-07.png') })

  expect(dispatchRequests).toBe(0)
  expect(googleRequests).toBe(0)
  expect(consoleErrors).toEqual([])
})
