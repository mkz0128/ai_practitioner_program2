import path from 'node:path'
import { expect, test } from '@playwright/test'

const relaxedWorkbook = path.resolve('..', 'data', 'samples', 'demo-50-relaxed.xlsx')

type AgentEvidence = { tool: string; data: Record<string, unknown> }
type AgentResponse = { message?: string; evidence?: AgentEvidence[] }

async function importPlan(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByLabel('上傳 Excel').setInputFiles(relaxedWorkbook)
  // Choosing the file only attaches it; the panel says 「附加檔案 / 送出」 and
  // nothing is uploaded until 送出 is pressed.
  await page.getByRole('button', { name: '送出', exact: true }).click()
  await expect(page.locator('.topbar-stats')).toContainText('50/50 已安排', { timeout: 180_000 })
}

async function keyboardSend(page: Page, message: string): Promise<AgentResponse> {
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const responsePromise = page.waitForResponse((response) => response.url().includes('/api/v1/agent/chat') && response.request().method() === 'POST', { timeout: 180_000 })
  await input.click()
  await input.pressSequentially(message)
  await expect(input).toHaveValue(message)
  await input.press('Enter')
  const response = await responsePromise
  const raw = await response.text()
  expect(response.ok(), `輸入：${message}\n系統實際回覆：${raw}`).toBeTruthy()
  return JSON.parse(raw) as AgentResponse
}

test('急單缺欄與預覽錯誤都保留 context，Enter 走鍵盤送出', async ({ page }) => {
  test.setTimeout(600_000)
  await importPlan(page)

  await keyboardSend(page, '客戶剛剛打電話來，有一張急單要今天早上送到，15公斤')
  const derived = await keyboardSend(page, 'ORD-101，信義示範配送點 Z4-51，臺北市，25.033，121.565，Z4，1 件')
  // 行政區沒講。應用程式用 Z4 區裡座標最近的既有訂單補上，
  // 但補了什麼一定要寫在確認卡上——看不到就等於沒有人工確認。
  const derivedData = derived.evidence?.find((item) => item.tool === 'urgent_insertion_workflow')?.data
  const derivedOrders = (derivedData?.orders as Array<{ derived_fields?: string[]; district?: string }> | undefined) || []
  expect(derivedOrders[0]?.derived_fields).toContain('district')
  expect(derived.message || '').toContain('是我依 Z4 區補的')
  await expect(page.getByText('是我依 Z4 區補的', { exact: false }).last()).toBeVisible()

  // 補錯了就直接講，卡片要跟著換掉，也不能再說那是我補的。
  const completed = await keyboardSend(page, '行政區是板橋')
  expect(completed.message || '').toContain('我記下來了，確認一下')
  expect(completed.message || '').not.toContain('是我依 Z4 區補的')
  await expect(page.getByRole('button', { name: '產生插單預覽' }).last()).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', { name: '重新開始' }).click()
  await importPlan(page)
  const invalidDistrict = await keyboardSend(page, '訂單編號 ORD-101，配送區域 Z4，城市臺北市，行政區內湖，地點名稱信義示範配送點 Z4-51，緯度 25.033，經度 121.565，包裹件數 1，每件重量 15 公斤，早上配送')
  expect(invalidDistrict.message || '').toContain('我記下來了，確認一下')
  await page.getByRole('button', { name: '產生插單預覽' }).last().click()
  await expect(page.getByText('插單資料未通過驗證。', { exact: false })).toBeVisible({ timeout: 60_000 })

  const correction = await keyboardSend(page, '行政區是信義')
  expect(correction.message || '').toContain('我記下來了，確認一下')
  await expect(page.getByRole('button', { name: '產生插單預覽' }).last()).toBeVisible({ timeout: 30_000 })

  await page.screenshot({ path: path.resolve('..', 'docs', 'screenshots', 'urgent-regressions.png'), fullPage: true })
})
