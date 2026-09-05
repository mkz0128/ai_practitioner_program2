import { test, expect } from '@playwright/test'
import path from 'node:path'

test('控制塔 local simulated flow 可展示主要交付畫面', async ({ page }) => {
  test.setTimeout(180_000)
  const screenshotDir = path.resolve('..', 'docs', 'screenshots')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '今日配送規劃' })).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, '01-empty-control-tower.png') })

  // 讓截圖測試保持 keyless、可重現；正式 UI 預設仍送 AUTO 以啟用 Google strict path。
  await page.route('**/api/v1/plans', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const payload = JSON.parse(route.request().postData() || '{}') as Record<string, unknown>
    await route.continue({ postData: JSON.stringify({ ...payload, route_provider_preference: 'SIMULATED', traffic_mode: 'SIMULATED' }) })
  })
  // This regression test is intentionally keyless.  Keep the UI flow
  // deterministic by replacing only the Agent transport with a response
  // shaped like the real ChatResponse; the plan itself is still produced by
  // the actual REST planner and loaded through the normal UI code path.
  let simulatedPlan: Record<string, unknown> | null = null
  await page.route('**/api/v1/agent/chat', async (route) => {
    const request = route.request()
    if (request.method() !== 'POST') return route.continue()
    const payload = JSON.parse(request.postData() || '{}') as { message?: string; context?: { dataset_id?: string } }
    const datasetId = payload.context?.dataset_id || (simulatedPlan?.dataset_id as string | undefined)
    if (!datasetId) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'DATASET_REQUIRED', message: '需要資料集' } }) })
    if (!simulatedPlan) {
      const response = await page.request.post('http://127.0.0.1:8000/api/v1/plans', {
        data: { dataset_id: datasetId, algorithm: 'ORTOOLS', route_provider_preference: 'SIMULATED', traffic_mode: 'SIMULATED' },
      })
      simulatedPlan = await response.json() as Record<string, unknown>
      if (!response.ok()) return route.fulfill({ status: response.status(), contentType: 'application/json', body: JSON.stringify(simulatedPlan) })
    }
    const summary = (simulatedPlan.summary || {}) as Record<string, unknown>
    const validation = (simulatedPlan.validation || {}) as Record<string, unknown>
    const message = payload.message || ''
    const planDispatch = {
      assigned_order_count: summary.assigned_order_count,
      unassigned_orders: simulatedPlan.unassigned_orders || [],
      total_distance_m: summary.total_distance_m,
      total_driving_time_s: summary.total_duration_s,
      vehicle_count: Array.isArray(simulatedPlan.vehicles) ? simulatedPlan.vehicles.length : 4,
      validator: validation,
      complete: simulatedPlan.is_fully_feasible,
      provider_mode: 'SIMULATED',
    }
    let evidence: Array<{ tool: string; data: Record<string, unknown> }> = [{ tool: 'plan_dispatch', data: planDispatch }]
    let text = '已完成配送規劃，請查看方案與驗證結果。'
    if (message.includes('載重最高')) {
      evidence = [{ tool: 'highest_load_vehicle', data: { vehicle_id: 'VEH-003', planned_load_kg: 152, max_load_kg: 160, load_utilization: 0.95 } }]
      text = '已從驗證方案找出載重最高的車輛。'
    } else if (message.includes('ORD-041')) {
      evidence = [{ tool: 'preview_urgent_insert', data: {
        status: 'PREVIEWED',
        affected_vehicle_count: 1,
        structured_order: { order_id: 'ORD-041', zone_code: 'Z4', city: '臺北市', district: '信義', location_label: '示範臨時站點', latitude: 25.033, longitude: 121.565, time_slot: 'PM', declared_package_count: 1, priority: 'HIGH', note: 'preview only' },
        structured_packages: [{ package_id: 'PKG-041-01', order_id: 'ORD-041', weight_kg: 2 }],
      } }]
      text = '已預覽 ORD-041 插單，差異待人工確認。'
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      session_id: payload.context?.dataset_id || 'E2E', agent_run_id: 'RUN-SIMULATED', message: text,
      evidence, requires_human_confirmation: Boolean(simulatedPlan), plan_id: simulatedPlan.plan_id, plan_version: simulatedPlan.version, provider_mode: 'SIMULATED',
    }) })
  })
  await page.getByLabel('上傳 Excel').setInputFiles(path.resolve('..', 'data', 'samples', 'demo-delivery-40-orders.xlsx'))
  await expect(page.getByRole('status')).toContainText('demo-delivery-40-orders.xlsx')
  await page.getByRole('textbox', { name: '輸入訊息' }).fill('請用這份資料建立今天的配送方案')
  await page.getByRole('textbox', { name: '輸入訊息' }).press('Enter')
  await expect(page.getByText(/已匯入 40 張訂單/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('方案檢查通過').first()).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: path.join(screenshotDir, '02-imported-plan.png') })
  await page.screenshot({ path: path.join(screenshotDir, '03-map-and-vehicles.png') })

  const currentPlan = simulatedPlan as unknown as {
    plan_id: string
    version: number
    vehicles: Array<{ vehicle_id: string; stops: Array<{ order_id: string }> }>
  }
  let dragOrderId = ''
  let dragTargetId = ''
  for (const source of currentPlan.vehicles) {
    for (const stop of source.stops.slice(0, 6)) {
      for (const target of currentPlan.vehicles) {
        if (target.vehicle_id === source.vehicle_id) continue
        const candidate = await page.request.post(
          `http://127.0.0.1:8000/api/v1/plans/${currentPlan.plan_id}/reassign/preview`,
          { data: { base_plan_version: currentPlan.version, order_id: stop.order_id, target_vehicle_id: target.vehicle_id } },
        )
        if (candidate.ok()) {
          dragOrderId = stop.order_id
          dragTargetId = target.vehicle_id
          break
        }
      }
      if (dragOrderId) break
    }
    if (dragOrderId) break
  }
  expect(dragOrderId, '至少應有一組可合法預覽的換車組合').not.toBe('')
  const sourceOrder = page.locator('.order-move-row').filter({ hasText: dragOrderId }).first()
  const targetVehicleIndex = currentPlan.vehicles.findIndex((vehicle) => vehicle.vehicle_id === dragTargetId)
  const targetVehicle = page.locator('.vehicle-card').nth(targetVehicleIndex)
  const reassignResponsePromise = page.waitForResponse((response) => response.url().includes('/reassign/preview'))
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
  await sourceOrder.dispatchEvent('dragstart', { dataTransfer })
  await targetVehicle.dispatchEvent('dragover', { dataTransfer })
  await targetVehicle.dispatchEvent('drop', { dataTransfer })
  const reassignResponse = await reassignResponsePromise
  expect(reassignResponse.ok(), await reassignResponse.text()).toBeTruthy()
  await expect(page.getByText(/局部變更預覽/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: '取消變更' })).toBeVisible()
  await page.getByRole('button', { name: '取消變更' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(screenshotDir, '04-reassignment-preview.png') })
  await page.getByRole('button', { name: '取消變更' }).click()

  await page.getByRole('textbox', { name: '輸入訊息' }).fill('哪台車的載重最高？')
  await page.getByRole('textbox', { name: '輸入訊息' }).press('Enter')
  await expect(page.locator('.chat-bubble.agent').last()).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: path.join(screenshotDir, '05-agent-answer.png') })

  await page.getByRole('textbox', { name: '輸入訊息' }).fill('預覽 ORD-041 插單')
  await page.getByRole('textbox', { name: '輸入訊息' }).press('Enter')
  await expect(page.getByText(/變更差異/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/局部變更預覽|完整重新安排/)).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '套用變更' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(screenshotDir, '06-urgent-preview.png') })
  await expect(page.getByRole('button', { name: '套用變更' })).toBeVisible()
  await page.screenshot({ path: path.join(screenshotDir, '07-human-confirmation.png') })
})
