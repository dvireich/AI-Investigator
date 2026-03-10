# Stop-Dashboard.ps1
# Terminates Node.js processes to free up ports 3000 and 5173

Write-Host "Stopping Investigation Dashboard..." -ForegroundColor Yellow

# Find and kill the processes listening on port 3000 (Backend)
$backendPort = 3000
$backendProcess = Get-NetTCPConnection -LocalPort $backendPort -ErrorAction SilentlyContinue
if ($backendProcess) {
    Write-Host "Killing Backend on port $backendPort (PID: $($backendProcess.OwningProcess))..." -ForegroundColor Red
    Stop-Process -Id $backendProcess.OwningProcess -Force -ErrorAction SilentlyContinue
} else {
    Write-Host "Port $backendPort is free." -ForegroundColor Green
}

# Find and kill processes listening on port 5173 (Frontend default)
$frontendPort = 5173
$frontendProcess = Get-NetTCPConnection -LocalPort $frontendPort -ErrorAction SilentlyContinue
if ($frontendProcess) {
    Write-Host "Killing Frontend on port $frontendPort (PID: $($frontendProcess.OwningProcess))..." -ForegroundColor Red
    Stop-Process -Id $frontendProcess.OwningProcess -Force -ErrorAction SilentlyContinue
} else {
    Write-Host "Port $frontendPort is free." -ForegroundColor Green
}

# Also cleanup 5174, 5175 just in case
foreach ($p in 5174..5180) {
    $proc = Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue
    if ($proc) {
         Write-Host "Killing stray process on port $p (PID: $($proc.OwningProcess))..." -ForegroundColor Red
         Stop-Process -Id $proc.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}

# Cleanup Edge --app windows pointing to the dashboard
Write-Host "Checking for Edge app windows..." -ForegroundColor Yellow
try {
    $edgeAppProcs = Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq 'msedge.exe' -and $_.CommandLine -like '*--app=http://localhost:5173*'
    }
    foreach ($proc in $edgeAppProcs) {
        Write-Host "Killing Edge app window (PID: $($proc.ProcessId))..." -ForegroundColor Red
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    }
} catch {
    Write-Host "Could not query Edge app processes, skipping." -ForegroundColor DarkGray
}

# Cleanup MCP KQL Server Python processes
Write-Host "Checking for lingering MCP Python processes..." -ForegroundColor Yellow
try {
    $pythonProcs = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -like '*mcp_kql_server*' }
    foreach ($proc in $pythonProcs) {
        Write-Host "Killing auto-detected MCP Python process (PID: $($proc.ProcessId))..." -ForegroundColor Red
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    }
} catch {
    Write-Host "Could not query specific python command lines, skipping python cleanup." -ForegroundColor DarkGray
}

Write-Host "Cleanup complete. You can now run .\Run-Investigation-Dashboard.ps1" -ForegroundColor Cyan
