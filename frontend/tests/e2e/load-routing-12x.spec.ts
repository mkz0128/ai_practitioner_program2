import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

const workbook = path.resolve('..', 'data', 'samples', 'demo-50-tight.xlsx')
const screenshots = path.resolve('..', 'docs', 'screenshots')
const logPath = path.resolve('..', 'artifacts', 'load-routing-12x.log')

const cases = [
  { id: 'L-01', text: '哪台車載重最高', expected: 'highest_load_vehicle' },
  { id: 'L-02', text: '誰的貨最重', expected: 'highest_load_vehicle' },
  { id: 'L-03', text: '哪台車裝最重', expected: 'highest_load_vehicle' },
  { id: 'L-04', text: '哪台車最滿', expected: 'highest_load_vehicle' },
  { id: 'L-05', text: '哪一台裝最多', expected: 'highest_load_vehicle' },
  { id: 'L-06', text: '哪台車最閒', expected: 'lowest_load_vehicle' },
  { id: 'L-07', text: '哪一台還有空間', expected: 'lowest_load_vehicle' },
  { id: 'L-08', text: '誰裝得最少', expected: 'lowest_load_vehicle' },
  { id: 'L-09', text: '哪台車還塞得下東西', expected: 'lowest_load_vehicle' },
] as const

type AgentPayload = { evidence?: Array<{ tool?: string }>; tool?: string }

async function send(page: Page, text: string, allowPlanFallback = false): Promise<{ reply: string; tool: string }> {
  const input = page.getByRole('textbox', { name: '輸入訊息' })
  const bubbles = page.locator('.chat-log > div.mr-auto')
  const before = await bubbles.count()
  const responses: AgentPayload[] = []
  const listener = async (response: import('@playwright/test').Response): Promise<void> => {
    if (!response.url().includes('/api/v1/agent/chat') || response.request().method() !== 'POST') return
    try { responses.push(await response.json() as AgentPayload) } catch { /* visible text is the proof */ }
  }
  page.on('response', listener)
  try {
    await expect(input).toBeEnabled({ timeout: 240_000 })
    await input.click()
    await input.pressSequentially(text)
    await expect(input).toHaveValue(text)
    await input.press('Enter')
    if (allowPlanFallback) {
      await expect(page.locator('.feedback-success:visible').filter({ hasText: '已完成' })).toBeVisible({ timeout: 240_000 })
      return { reply: (await page.locator('.feedback-success:visible').last().innerText()).trim(), tool: 'plan_dispatch' }
    }
    await expect.poll(async () => bubbles.count(), { timeout: 240_000 }).toBeGreaterThan(before)
    const bubble = bubbles.last()
    await expect(bubble).toBeVisible({ timeout: 240_000 })
    await expect.poll(async () => (await bubble.innerText()).split('\n').slice(1).join('\n').trim(), { timeout: 240_000 }).not.toBe('')
    await expect(input).toBeEnabled({ timeout: 240_000 })
    const reply = (await bubble.innerText()).split('\n').slice(1).join('\n').trim()
    const payload = responses.at(-1)
    return { reply: reply || '（助理泡泡存在，但沒有可見文字。）', tool: payload?.evidence?.at(-1)?.tool || payload?.tool || '未知' }
  } finally {
    page.off('response', listener)
  }
}

async function capture(page: Page, filename: string): Promise<void> {
  const target = path.join(screenshots, filename)
  try { await page.screenshot({ path: target, fullPage: true }) }
  catch { await page.screenshot({ path: target, fullPage: true }) }
}

test('九句載重問法各 12 次：瀏覽器畫面路由驗證', async ({ page }) => {
  test.setTimeout(3_600_000)
  await fs.mkdir(screenshots, { recursive: true })
  await fs.mkdir(path.dirname(logPath), { recursive: true })
  await fs.writeFile(logPath, '', 'utf8')
  const totals = new Map<string, number>()
  for (const item of cases) {
    let passed = 0
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      let tool = '—'
      let reply = ''
      let failure = ''
      try {
        await page.goto('/')
        await expect(page.getByText('先放入今天的訂單', { exact: true })).toBeVisible({ timeout: 60_000 })
        await page.getByLabel('上傳 Excel').last().setInputFiles(workbook)
        await send(page, '請幫我排今天的班', true)
        const result = await send(page, item.text)
        tool = result.tool
        reply = result.reply
        if (tool === item.expected && reply && !reply.includes('已完成確定性工具計算')) passed += 1
      } catch (error) {
        failure = String(error)
      }
      const filename = `load-routing-${item.id}-${String(attempt).padStart(2, '0')}.png`
      try { await capture(page, filename) } catch (error) { failure = `${failure}；截圖：${String(error)}` }
      const line = JSON.stringify({ id: item.id, question: item.text, attempt, expected: item.expected, tool, pass: tool === item.expected && Boolean(reply) && !reply.includes('已完成確定性工具計算'), reply, failure, screenshot: `docs/screenshots/${filename}` }, null, 0)
      console.log(line)
      await fs.appendFile(logPath, `${line}\n`, 'utf8')
    }
    totals.set(item.id, passed)
    const summary = `${item.id} ${passed}/12 expected=${item.expected}`
    console.log(summary)
    await fs.appendFile(logPath, `${summary}\n`, 'utf8')
  }
  console.log(`SUMMARY ${JSON.stringify(Object.fromEntries(totals))}`)
})
