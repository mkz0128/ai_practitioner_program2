import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure' },
  webServer: [
    { command: 'cd .. && .venv\\Scripts\\python.exe -m uvicorn src.api.main:app --host 127.0.0.1 --port 8000', url: 'http://127.0.0.1:8000/health', reuseExistingServer: true },
    { command: 'pnpm run dev -- --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: true },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
