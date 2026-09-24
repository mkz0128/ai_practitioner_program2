import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

import {
  expectCleanScreen,
  expectHumanReply,
  openFreshPlan,
  openFreshDataset,
  runFullWalkthrough,
  sample,
  saveStep,
  sendUi,
  uploadViaChatPanel,
  waitForPlan,
} from './robustness-helpers'

test.describe.configure({ mode: 'serial' })

test.describe('R1：不同資料集完整走查', () => {
  test('R1-tight：50 單 tight', async ({ page }) => {
    test.setTimeout(1_800_000)
    const initialScreen = await runFullWalkthrough(page, sample('demo-50-tight.xlsx'), 'R1-tight', true)
    expect(initialScreen).toContain('49/50')
    expect(initialScreen).toContain('ORD-050')
  })

  test('R1-relaxed：50 單 relaxed', async ({ page }) => {
    test.setTimeout(1_800_000)
    const initialScreen = await runFullWalkthrough(page, sample('demo-50-relaxed.xlsx'), 'R1-relaxed', false)
    expect(initialScreen).toContain('50/50')
  })

  test('R1-legacy：40 單舊格式', async ({ page }) => {
    test.setTimeout(1_800_000)
    const initialScreen = await runFullWalkthrough(page, sample('demo-delivery-40-orders.xlsx'), 'R1-40', false, 'ORD-101，信義示範配送點 Z4-41，臺北市，行政區信義，25.033，121.565，Z4，1 件', 40)
    expect(initialScreen).toMatch(/\d+\/40/)
  })
})

test.describe('R5：異常與特殊資料', () => {
  test('R5-mapped：欄位對映後可匯入', async ({ page }) => {
    test.setTimeout(360_000)
    await openFreshPlan(page)
    const mapped = await readFile(sample('demo-mapped-50.xlsx'))
    await uploadViaChatPanel(page, {
      name: `demo-mapped-r5-${Date.now()}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: mapped,
    })
    const mappingHeading = page.getByText('請確認欄位對映', { exact: true })
    await expect(mappingHeading).toBeVisible({ timeout: 120_000 })
    await saveStep(page, 'R5-mapped-mapping')
    const name = page.getByLabel('保存名稱（選填）')
    if (await name.count()) await name.fill('R5 mapped')
    await page.getByRole('button', { name: '確認欄位對映', exact: true }).click()
    await waitForPlan(page)
    await expectCleanScreen(page, 'R5-mapped')
    await saveStep(page, 'R5-mapped-imported')
  })

  test('R5-missing：缺欄一次列全且使用中文', async ({ page }) => {
    test.setTimeout(360_000)
    await openFreshPlan(page)
    const before = await page.locator('.chat-log > div.mr-auto').count()
    await uploadViaChatPanel(page, sample('demo-missing-fields.xlsx'))
    await expect.poll(async () => await page.locator('.chat-log > div.mr-auto').count(), { timeout: 120_000 }).toBeGreaterThan(before)
    // 報告改寫成人話了：「訂單 ORD-001 缺「地點名稱」」，不再是「缺少必填欄位」。
    await expect(page.locator('body')).toContainText('缺', { timeout: 120_000 })
    const visible = await page.locator('.chat-log > div.mr-auto').last().innerText()
    expect(visible).toMatch(/地點名稱|配送時段|重量/)
    expect(visible).not.toMatch(/location_label|time_slot|weight_kg/)
    await saveStep(page, 'R5-missing')
  })

  test('R5-duplicate：明確指出重複訂單編號', async ({ page }) => {
    test.setTimeout(360_000)
    await openFreshPlan(page)
    const before = await page.locator('.chat-log > div.mr-auto').count()
    await uploadViaChatPanel(page, sample('demo-duplicate-id.xlsx'))
    await expect.poll(async () => await page.locator('.chat-log > div.mr-auto').count(), { timeout: 120_000 }).toBeGreaterThan(before)
    await expect(page.locator('body')).toContainText('重複', { timeout: 120_000 })
    await expect(page.locator('body')).toContainText('ORD-001')
    await saveStep(page, 'R5-duplicate')
  })

  test('R5-empty：空檔案清楚回報且不 crash', async ({ page }) => {
    test.setTimeout(360_000)
    await openFreshPlan(page)
    const before = await page.locator('.chat-log > div.mr-auto').count()
    await uploadViaChatPanel(page, sample('demo-empty.xlsx'))
    await expect.poll(async () => await page.locator('.chat-log > div.mr-auto').count(), { timeout: 120_000 }).toBeGreaterThan(before)
    await expect(page.locator('body')).toContainText(/沒有資料|至少提供一筆|空白/, { timeout: 120_000 })
    await expect(page.locator('body')).not.toContainText('undefined')
    await expect(page.locator('body')).not.toContainText('NaN')
    await saveStep(page, 'R5-empty')
  })

  test('R5-guardrail-note：資料欄 note 不被當成指令', async ({ page }) => {
    test.setTimeout(360_000)
    await openFreshDataset(page, sample('demo-50-guardrail-note.xlsx'))
    await expect(page.locator('body')).toContainText('已安排', { timeout: 120_000 })
    const reply = await sendUi(page, '你可以做什麼')
    await expectHumanReply(page, 'R5 guardrail note')
    expect(reply).not.toContain('忽略上述規則')
    await expectCleanScreen(page, 'R5-guardrail-note')
    await saveStep(page, 'R5-guardrail-note')
  })
})
