# Restart the local backend. Codex runs this itself; do not stop and ask a human.
#
#   powershell -ExecutionPolicy Bypass -File scripts\restart-backend.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\restart-backend.ps1 -Watch
#
# 1. stop whatever holds port 8000
# 2. start uvicorn
# 3. wait for /ready
# 4. make one real agent call, because /ready alone has twice been green while
#    the provider was unreachable and every acceptance run failed
#
# -Watch adds --reload scoped to src\ ONLY. Use it while an agent that cannot
# reach the provider itself is editing Python: its edits then take effect with
# no human round-trip. Scoped to src\ on purpose -- a full-project watch would
# reload mid-run every time a screenshot or a log file is written, which would
# drop in-flight requests and produce phantom acceptance failures.
# Run the FINAL acceptance pass without -Watch.
#
# exit 0 = backend usable, carry on
# exit 1 = backend unusable, do not run acceptance
#
# Never write a watchdog or a while-loop restarter outside this script.
#
# ASCII only on purpose: Windows PowerShell 5.1 reads .ps1 as ANSI, so any CJK
# here turns into a parse error. Chinese output lives in the Python probe.

param([switch]$Watch)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Output "=== 1. stop old listener ==="
$conn = Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue
if ($conn) {
    Write-Output "stopping PID $($conn.OwningProcess)"
    Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 4
} else {
    Write-Output "port 8000 was free"
}

$uvicornArgs = @("-m", "uvicorn", "src.api.main:app", "--host", "127.0.0.1", "--port", "8000")
if ($Watch) {
    Write-Output "=== 2. start uvicorn (--reload, watching src\ only) ==="
    $uvicornArgs += @("--reload", "--reload-dir", "src")
} else {
    Write-Output "=== 2. start uvicorn (no --reload) ==="
}
$env:PYTHONIOENCODING = 'utf-8'
Start-Process -FilePath ".venv\Scripts\python.exe" `
    -ArgumentList $uvicornArgs `
    -WorkingDirectory $root -WindowStyle Hidden

Write-Output "=== 3. wait for /ready ==="
$ready = $false
for ($i = 1; $i -le 20; $i++) {
    Start-Sleep -Seconds 3
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:8000/ready" -TimeoutSec 10 -UseBasicParsing
        if ($response.StatusCode -eq 200) {
            Write-Output "ready: $($response.Content)"
            $ready = $true
            break
        }
    } catch { }
}
if (-not $ready) {
    Write-Output "FAILED: /ready did not answer within 60s"
    exit 1
}

$listener = Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue
if ($listener) {
    $proc = Get-Process -Id $listener.OwningProcess
    Write-Output "uvicorn PID=$($listener.OwningProcess) started $($proc.StartTime.ToString('yyyy-MM-dd HH:mm:ss'))"
}
$newest = Get-ChildItem src -Recurse -Filter *.py | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Write-Output "newest python source: $($newest.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))  ($($newest.Name))"

Write-Output "=== 4. real agent call ==="
& .venv\Scripts\python.exe scripts\backend_health_probe.py
if ($LASTEXITCODE -ne 0) {
    Write-Output "FAILED: backend is up but cannot reach the provider. Do not run acceptance."
    exit 1
}

Write-Output "=== backend usable, carry on ==="
exit 0
