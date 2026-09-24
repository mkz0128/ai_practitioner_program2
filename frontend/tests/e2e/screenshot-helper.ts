import type { Page } from '@playwright/test'
import path from 'node:path'

// docs/screenshots 裡已經有近六百張、380 MB。Windows 偶爾會在 Playwright 寫入
// 的瞬間回 UNKNOWN（多半是掃描或索引短暫鎖住那個檔名），整支測試就被一張存檔
// 失敗弄掛，前面的判斷全都白跑。重試幾次就過得去；真的存不了才讓它失敗。
export async function saveScreenshot(page: Page, dir: string, name: string): Promise<void> {
  const file = path.join(dir, `${name}.png`)
  let lastError: unknown
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await page.screenshot({ path: file, fullPage: true })
      return
    } catch (error) {
      lastError = error
      await page.waitForTimeout(400 * (attempt + 1))
    }
  }
  throw lastError
}
