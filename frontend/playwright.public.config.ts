import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/public-e2e',
  fullyParallel: false,
  timeout: 900_000,
  reporter: 'list',
  use: {
    baseURL: process.env.PUBLIC_DEMO_URL || 'https://ai-dispatch-control-tower.onrender.com',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
