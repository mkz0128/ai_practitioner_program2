import { expect, test } from '@playwright/test'

import {
  expectHumanReply,
  openFreshDataset,
  sample,
  saveStep,
  sendUi,
} from './robustness-helpers'

const boundarySummary =
  'ORD-101，大安信義交界示範配送點 Z3-51，臺北市，行政區信義，25.040，121.560，Z3，1 件'

for (const fixture of [
  { name: 'tight', file: 'demo-50-tight.xlsx' },
  { name: 'relaxed', file: 'demo-50-relaxed.xlsx' },
]) {
  test(`交界急單方案卡：${fixture.name}`, async ({ page }) => {
    test.setTimeout(240_000)
    await openFreshDataset(page, sample(fixture.file), 50)
    await saveStep(page, `cards-${fixture.name}-01-imported`)

    const missing = await sendUi(page, '客戶剛剛打電話來，有一張急單要今天早上送到，15公斤')
    expectHumanReply(page, `${fixture.name} 急單缺欄`)
    expect(missing).toContain('缺少')
    await saveStep(page, `cards-${fixture.name}-02-missing`)

    const summary = await sendUi(page, boundarySummary)
    expectHumanReply(page, `${fixture.name} 急單摘要`)
    expect(summary).toContain('我理解的臨時訂單如下')
    await saveStep(page, `cards-${fixture.name}-03-summary`)

    const preview = await sendUi(page, '產生插單預覽')
    expectHumanReply(page, `${fixture.name} 急單預覽`)
    expect(preview).toContain('方案')
    await saveStep(page, `cards-${fixture.name}-04-preview`)

    const cards = page.locator('button.urgent-card')
    await expect(cards.first()).toBeVisible({ timeout: 180_000 })
    const cardTexts = await cards.allInnerTexts()
    expect(cardTexts.length).toBeGreaterThanOrEqual(2)
    expect(new Set(cardTexts).size).toBe(cardTexts.length)

    const placements = cardTexts.map((text) => {
      const vehicle = text.match(/VEH-\d{3}/)?.[0]
      const stop = text.match(/第\s*\d+\s*站/)?.[0]
      expect(vehicle).toBeTruthy()
      expect(stop).toBeTruthy()
      return `${vehicle}/${stop}`
    })
    expect(new Set(placements).size).toBe(placements.length)

    for (const cardText of cardTexts) {
      expect(cardText).toMatch(/\d{1,2}:\d{2}/)
      expect(cardText).toMatch(/km|公里|分/)
      expect(cardText).not.toContain('不可行')
      expect(cardText).not.toContain('需人工處理')
    }
    await saveStep(page, `cards-${fixture.name}-05-options`)
  })
}
