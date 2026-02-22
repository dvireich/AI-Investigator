# Run-Dashboard.ps1
# Launches the Investigation Dashboard (Backend + Frontend)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Auto-cleanup previous instances
Write-Host "Cleaning up previous instances..." -ForegroundColor Yellow
& "$ScriptDir\Stop-Dashboard.ps1"

Write-Host "Starting Investigation Dashboard..." -ForegroundColor Cyan

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
