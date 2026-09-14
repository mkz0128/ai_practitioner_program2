import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

const workbook = path.resolve('..', 'data', 'samples', 'demo-50-relaxed.xlsx')
const screenshotDir = path.resolve('..', 'docs', 'screenshots')
type Evidence = { tool: string; data: Record<string, unknown> }
type Body = { message?: string; evidence?: Evidence[] }

async function send(page: Page, inputText: string): Promise<Body> {
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const responsePromise = page.waitForResponse((response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST', { timeout: 180_000 })
  await input.click()
  await input.pressSequentially(inputText)
  await expect(input).toHaveValue(inputText)
  await input.press('Enter')
  const response = await responsePromise
  const raw = await response.text()
  expect(response.ok(), `輸入：${inputText}\n系統實際回覆：${raw}`).toBeTruthy()
  return JSON.parse(raw) as Body
}

function tool(body: Body, name: string): Record<string, unknown> {
  const evidence = body.evidence?.find((item) => item.tool === name)
  expect(evidence, `系統實際回覆：${body.message || JSON.stringify(body)}`).toBeTruthy()
  return evidence?.data || {}
}

test('W3：鍵盤輸入急單、方案修改、拒絕全域重排與確認', async ({ page }) => {
  test.setTimeout(900_000)
  await page.route('**/api/v1/agent/chat', async (route) => {
    const payload = JSON.parse(route.request().postData() || '{}') as Record<string, unknown>
    payload.session_id = `SCENARIO-W3-${test.info().testId}`
    await route.continue({ postData: JSON.stringify(payload) })
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByLabel('上傳 Excel').setInputFiles(workbook)
  await expect(page.getByText('已完成 50／50 張訂單的排班')).toBeVisible({ timeout: 180_000 })

  const missing = await send(page, '客戶剛剛打電話來，信義區有一張急單要今天早上送到，15公斤')
  expect(missing.message || '').toContain('目前還不能計算')
  await page.screenshot({ path: path.join(screenshotDir, 'W-21.png'), fullPage: true })

  const complete = await send(page, '訂單編號 ORD-101，配送區域 Z3，城市臺北市，行政區信義，地點名稱大安信義交界示範配送點 Z3-51，緯度 25.040，經度 121.560，包裹件數 1，每件重量 15 公斤，早上配送')
  expect(complete.message || '').toContain('我理解的臨時訂單如下')
  await expect(page.getByRole('button', { name: '產生插單預覽' })).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, 'W-22.png'), fullPage: true })

  const userMessages = page.locator('.chat-log > div').filter({ hasText: '你' })
  expect(await userMessages.count()).toBe(2)

  const previewPromise = page.waitForResponse((response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST', { timeout: 180_000 })
  await page.getByRole('button', { name: '產生插單預覽' }).click()
  const preview = await previewPromise
  expect(preview.ok()).toBe(true)
  await expect(page.getByRole('group', { name: '臨時插單方案' }).last()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('group', { name: '臨時插單方案' }).last().locator('button.urgent-card')).toHaveCount(3)
  await page.screenshot({ path: path.join(screenshotDir, 'W-24.png'), fullPage: true })

  const modified = await send(page, '用 A，但這單先送')
  expect(tool(modified, 'prioritize_order_preview')).toBeTruthy()
  await expect(page.getByText('新方案卡尚未套用')).toBeVisible({ timeout: 60_000 })
  await page.screenshot({ path: path.join(screenshotDir, 'W-26.png'), fullPage: true })

  const refused = await send(page, '把所有單重新分配一遍')
  expect(refused.message || '').toContain('這個我不能改')
  await page.screenshot({ path: path.join(screenshotDir, 'W-27.png'), fullPage: true })

  await page.locator('button.urgent-card').last().click()
  await page.getByRole('button', { name: '取消', exact: true }).last().click()
  await expect(page.getByText('原方案版本沒有變更。').last()).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, 'W-28.png'), fullPage: true })

  await page.locator('button.urgent-card').last().click()
  const confirmPromise = page.waitForResponse((response) => response.url().includes('/confirm') && response.request().method() === 'POST', { timeout: 180_000 })
  await page.getByRole('button', { name: '確認套用' }).last().click()
  const confirmed = await confirmPromise
  expect(confirmed.ok()).toBe(true)
  await expect(page.getByText('建立新版本', { exact: false }).last()).toBeVisible({ timeout: 60_000 })
  await page.screenshot({ path: path.join(screenshotDir, 'W-29.png'), fullPage: true })
})

test('BUG-8：Demo 腳本兩句原文五次都進入訂單摘要', async ({ page }) => {
  test.setTimeout(1_200_000)
  let sessionId = ''
  await page.route('**/api/v1/agent/chat', async (route) => {
    const payload = JSON.parse(route.request().postData() || '{}') as Record<string, unknown>
    payload.session_id = sessionId
    await route.continue({ postData: JSON.stringify(payload) })
  })

  const firstSentence = '客戶剛剛打電話來，信義區有一張急單要今天早上送到，15公斤'
  const secondSentence = 'ORD-101，大安信義交界示範配送點 Z3-51，臺北市，行政區信義，25.040 / 121.560，Z3，1 件'
  const replies: string[] = []

  for (let run = 1; run <= 5; run += 1) {
    sessionId = `BUG-8-${test.info().testId}-${run}`
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await page.getByLabel('上傳 Excel').setInputFiles(workbook)
    await expect(page.getByText('已完成 50／50 張訂單的排班')).toBeVisible({ timeout: 180_000 })

    await send(page, firstSentence)
    const completion = await send(page, secondSentence)
    const message = completion.message || JSON.stringify(completion)
    replies.push(message)
    expect(message, `第 ${run} 次系統實際回覆：${message}`).toContain('我理解的臨時訂單如下')
    const workflow = completion.evidence?.find((item) => item.tool === 'urgent_insertion_workflow')
    expect(workflow?.data.stage, `第 ${run} 次系統實際回覆：${message}`).toBe('REVIEW_READY')
    expect(workflow?.data.orders, `第 ${run} 次系統實際回覆：${message}`).toEqual(expect.arrayContaining([expect.objectContaining({ order_id: 'ORD-101' })]))
    await page.screenshot({ path: path.join(screenshotDir, `BUG-8-${run}.png`), fullPage: true })
  }

  console.log(`BUG-8 實際成功率：${replies.filter((reply) => reply.includes('我理解的臨時訂單如下')).length}/5`)
})
