# Run-Dashboard.ps1
# Launches the Investigation Dashboard (Backend + Frontend)
#
# Usage:
#   .\Run-Dashboard.ps1            # Launches as a standalone desktop app (hidden consoles, Edge app window)
#   .\Run-Dashboard.ps1 -Classic   # Opens backend & frontend in separate console windows

param(
    [switch]$Classic
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendPort = 3000
$FrontendPort = 5173
$FrontendUrl = "http://localhost:$FrontendPort"

# Auto-cleanup previous instances
Write-Host "Cleaning up previous instances..." -ForegroundColor Yellow
& "$ScriptDir\Stop-Dashboard.ps1"

Write-Host "Starting Investigation Dashboard..." -ForegroundColor Cyan

if (-not $Classic) {
    # ----- App Mode (default): hidden consoles + standalone Edge window -----

    Write-Host "Starting in App mode (hidden consoles)..." -ForegroundColor Magenta

    # Start Backend (hidden window)
    $backendProc = Start-Process -FilePath "powershell" -ArgumentList "-WindowStyle", "Hidden", "-Command", "cd '$ScriptDir\backend'; npm.cmd run dev" -WindowStyle Hidden -PassThru
    Write-Host "  Backend started (PID: $($backendProc.Id))" -ForegroundColor DarkGray

    # Start Frontend (hidden window)
    $frontendProc = Start-Process -FilePath "powershell" -ArgumentList "-WindowStyle", "Hidden", "-Command", "cd '$ScriptDir\frontend'; npm.cmd run dev" -WindowStyle Hidden -PassThru
    Write-Host "  Frontend started (PID: $($frontendProc.Id))" -ForegroundColor DarkGray

    # Wait for frontend to become reachable
    Write-Host "Waiting for frontend to be ready..." -ForegroundColor Yellow
    $maxAttempts = 30
    $attempt = 0
    $ready = $false
    while ($attempt -lt $maxAttempts) {
        $attempt++
        try {
            $response = Invoke-WebRequest -Uri $FrontendUrl -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                $ready = $true
                break
            }
        } catch {
            # Not ready yet
        }
        Start-Sleep -Seconds 1
    }

    if (-not $ready) {
        Write-Host "Frontend did not become ready within $maxAttempts seconds." -ForegroundColor Red
        Write-Host "Check logs or run without -App flag to see console output." -ForegroundColor Yellow
        exit 1
    }

    Write-Host "Frontend is ready. Launching app window..." -ForegroundColor Green

    # Launch Edge in --app mode (chromeless standalone window)
    $edgeArgs = @(
        "--app=$FrontendUrl"
        "--window-size=1400,900"
        "--disable-extensions"
        "--no-first-run"
        "--disable-default-apps"
    )

    # Try to find Edge
    $edgePath = (Get-Command "msedge.exe" -ErrorAction SilentlyContinue).Source
    if (-not $edgePath) {
        $edgePath = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
    }
    if (-not $edgePath -or -not (Test-Path $edgePath)) {
        $edgePath = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
    }

    if (Test-Path $edgePath) {
        Start-Process -FilePath $edgePath -ArgumentList $edgeArgs
        Write-Host ""
        Write-Host "Investigation Dashboard is running as a standalone app." -ForegroundColor Cyan
        Write-Host "Close the app window or run Stop-Dashboard.ps1 to shut down." -ForegroundColor DarkGray
    } else {
        Write-Host "Microsoft Edge not found. Opening in default browser instead..." -ForegroundColor Yellow
        Start-Process $FrontendUrl
    }
} else {
    # ----- Classic Mode: visible console windows -----

    # Start Backend
    Write-Host "Starting Backend..." -ForegroundColor Green
    Start-Process -FilePath "powershell" -ArgumentList "-NoExit", "-Command", "cd '$ScriptDir\backend'; npm.cmd run dev"

    # Wait a moment for backend to initialize
    Start-Sleep -Seconds 3

    # Start Frontend
    Write-Host "Starting Frontend..." -ForegroundColor Green
    Start-Process -FilePath "powershell" -ArgumentList "-NoExit", "-Command", "cd '$ScriptDir\frontend'; npm.cmd run dev"

    Write-Host "Dashboard launched in separate windows." -ForegroundColor Cyan
    Write-Host "If you see 'EADDRINUSE' in the Backend window, run 'Stop-Dashboard.ps1' and try again." -ForegroundColor Yellow
}
