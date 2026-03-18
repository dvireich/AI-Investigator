# Run-Dashboard.ps1
# Launches the Investigation Dashboard (Backend + Frontend + Dev Tunnel)
#
# Usage:
#   .\Run-Dashboard.ps1                    # App mode + dev tunnel (authenticated access, default)
#   .\Run-Dashboard.ps1 -Anonymous         # App mode + dev tunnel (anyone with link)
#   .\Run-Dashboard.ps1 -NoTunnel          # App mode without dev tunnel (local only)
#   .\Run-Dashboard.ps1 -Classic           # Classic mode (separate console windows) + dev tunnel
#   .\Run-Dashboard.ps1 -Classic -NoTunnel # Classic mode without dev tunnel
#   .\Run-Dashboard.ps1 -ConfigFile C:\Repos\MyProject\investigator-config.json

param(
    [switch]$Classic,
    [switch]$NoTunnel,
    [switch]$Anonymous,
    [string]$ConfigFile
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendPort = 3000
$FrontendPort = 5173
$FrontendUrl = "http://localhost:$FrontendPort"

# Build backend extra args for --config passthrough
$backendExtra = ""
if ($ConfigFile) {
    $resolvedConfig = (Resolve-Path $ConfigFile -ErrorAction Stop).Path
    $backendExtra = " -- --config `"$resolvedConfig`""
    Write-Host "Using external config: $resolvedConfig" -ForegroundColor Cyan
}

# Auto-cleanup previous instances
Write-Host "Cleaning up previous instances..." -ForegroundColor Yellow
& "$ScriptDir\Stop-Dashboard.ps1"

Write-Host "Starting Investigation Dashboard..." -ForegroundColor Cyan

if (-not $Classic) {
    # ----- App Mode (default): hidden consoles + standalone Edge window -----

    Write-Host "Starting in App mode (hidden consoles)..." -ForegroundColor Magenta

    # Start Backend (hidden window)
    $backendProc = Start-Process -FilePath "powershell" -ArgumentList "-WindowStyle", "Hidden", "-Command", "cd '$ScriptDir\backend'; npm.cmd run dev$backendExtra" -WindowStyle Hidden -PassThru
    Write-Host "  Backend started (PID: $($backendProc.Id))" -ForegroundColor DarkGray

    # Start Frontend (hidden window)
    $frontendProc = Start-Process -FilePath "powershell" -ArgumentList "-WindowStyle", "Hidden", "-Command", "cd '$ScriptDir\frontend'; npm.cmd run dev" -WindowStyle Hidden -PassThru
    Write-Host "  Frontend started (PID: $($frontendProc.Id))" -ForegroundColor DarkGray

    # Wait for frontend to become reachable
    Write-Host "Waiting for frontend to be ready " -ForegroundColor Yellow -NoNewline
    $maxAttempts = 60
    $attempt = 0
    $ready = $false
    while ($attempt -lt $maxAttempts) {
        $attempt++
        try {
            # Use TcpClient first — avoids proxy/SSL issues that Invoke-WebRequest can hit
            $tcp = [System.Net.Sockets.TcpClient]::new()
            $tcp.Connect("127.0.0.1", $FrontendPort)
            if ($tcp.Connected) {
                $ready = $true
                $tcp.Close()
                break
            }
            $tcp.Close()
        } catch {
            # Not ready yet
        }
        Write-Host "." -ForegroundColor Yellow -NoNewline
        Start-Sleep -Seconds 1
    }
    Write-Host ""

    if (-not $ready) {
        Write-Host "Frontend did not become ready within $maxAttempts seconds." -ForegroundColor Red
        Write-Host "Try running in Classic mode to see console output: .\Run-Dashboard.ps1 -Classic" -ForegroundColor Yellow
        exit 1
    }

    Write-Host "Frontend is ready! Launching app window..." -ForegroundColor Green

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
        # Check if an Edge --app window for the dashboard is already open
        $existingApp = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            $_.Name -eq 'msedge.exe' -and $_.CommandLine -like '*--app=http://localhost:5173*'
        }
        if ($existingApp) {
            Write-Host ""
            Write-Host "Investigation Dashboard app window is already open." -ForegroundColor Cyan
            Write-Host "Close the app window or run Stop-Dashboard.ps1 to shut down." -ForegroundColor DarkGray
        } else {
            Start-Process -FilePath $edgePath -ArgumentList $edgeArgs
            Write-Host ""
            Write-Host "Investigation Dashboard is running as a standalone app." -ForegroundColor Cyan
            Write-Host "Close the app window or run Stop-Dashboard.ps1 to shut down." -ForegroundColor DarkGray
        }
    } else {
        Write-Host "Microsoft Edge not found. Opening in default browser instead..." -ForegroundColor Yellow
        Start-Process $FrontendUrl
    }
} else {
    # ----- Classic Mode: visible console windows -----

    # Start Backend
    Write-Host "Starting Backend..." -ForegroundColor Green
    Start-Process -FilePath "powershell" -ArgumentList "-NoExit", "-Command", "cd '$ScriptDir\backend'; npm.cmd run dev$backendExtra"

    # Wait a moment for backend to initialize
    Start-Sleep -Seconds 3

    # Start Frontend
    Write-Host "Starting Frontend..." -ForegroundColor Green
    Start-Process -FilePath "powershell" -ArgumentList "-NoExit", "-Command", "cd '$ScriptDir\frontend'; npm.cmd run dev"

    Write-Host "Dashboard launched in separate windows." -ForegroundColor Cyan
    Write-Host "If you see 'EADDRINUSE' in the Backend window, run 'Stop-Dashboard.ps1' and try again." -ForegroundColor Yellow
}

# ----- Dev Tunnel (default, use -NoTunnel to skip) -----
if (-not $NoTunnel) {
    Write-Host ""
    Write-Host "Starting Dev Tunnel..." -ForegroundColor Cyan

    # Find devtunnel CLI — check PATH first, then winget install location
    $devtunnelExe = (Get-Command "devtunnel" -ErrorAction SilentlyContinue).Source
    if (-not $devtunnelExe) {
        # Refresh PATH in case it was installed in this session
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
        $devtunnelExe = (Get-Command "devtunnel" -ErrorAction SilentlyContinue).Source
    }
    if (-not $devtunnelExe) {
        # Check winget install location
        $wingetPath = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
        $found = Get-ChildItem -Path $wingetPath -Filter "devtunnel.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) { $devtunnelExe = $found.FullName }
    }
    if (-not $devtunnelExe) {
        Write-Warning "devtunnel CLI not found. Run Setup-Dashboard.ps1 first, or use -NoTunnel to skip."
    } else {
        if ($Anonymous) {
            Write-Host "  Access: Anonymous (anyone with the link)" -ForegroundColor Yellow
        } else {
            Write-Host "  Access: Authenticated (same Microsoft/Entra account required)" -ForegroundColor Green
        }

        # Start devtunnel with stdout+stderr redirected to log files
        $tunnelLogOut = Join-Path ([System.IO.Path]::GetTempPath()) "devtunnel-stdout.log"
        $tunnelLogErr = Join-Path ([System.IO.Path]::GetTempPath()) "devtunnel-stderr.log"
        # Clear previous logs
        [System.IO.File]::WriteAllText($tunnelLogOut, "")
        [System.IO.File]::WriteAllText($tunnelLogErr, "")

        if ($Anonymous) {
            $tunnelArgStr = "host -p $FrontendPort --allow-anonymous"
        } else {
            $tunnelArgStr = "host -p $FrontendPort"
        }

        $tunnelProc = Start-Process -FilePath $devtunnelExe -ArgumentList $tunnelArgStr `
            -RedirectStandardOutput $tunnelLogOut -RedirectStandardError $tunnelLogErr `
            -PassThru -WindowStyle Hidden

        # Wait for the tunnel URL to appear in either log
        Write-Host "  Waiting for tunnel URL " -ForegroundColor Yellow -NoNewline
        $tunnelUrl = $null
        $tunnelAttempts = 0
        $tunnelMaxAttempts = 30
        while ($tunnelAttempts -lt $tunnelMaxAttempts -and -not $tunnelUrl) {
            $tunnelAttempts++
            Start-Sleep -Seconds 1
            Write-Host "." -ForegroundColor Yellow -NoNewline
            foreach ($logFile in @($tunnelLogOut, $tunnelLogErr)) {
                if (Test-Path $logFile) {
                    $logContent = Get-Content $logFile -Raw -ErrorAction SilentlyContinue
                    if ($logContent) {
                        $match = [regex]::Match($logContent, '(https?://[^\s]*\.devtunnels\.ms[^\s]*)')
                        if ($match.Success) {
                            $tunnelUrl = $match.Groups[1].Value
                            break
                        }
                    }
                }
            }
        }
        Write-Host ""

        if ($tunnelUrl) {
            Write-Host ""
            Write-Host "  ============================================" -ForegroundColor Cyan
            Write-Host "  Remote Access URL:" -ForegroundColor Cyan
            Write-Host "  $tunnelUrl" -ForegroundColor White
            Write-Host "  ============================================" -ForegroundColor Cyan
            Write-Host ""
            Write-Host "  Share this URL with remote users." -ForegroundColor Green
            # Copy to clipboard if available
            try {
                $tunnelUrl | Set-Clipboard
                Write-Host "  (URL copied to clipboard)" -ForegroundColor DarkGray
            } catch {
                # Clipboard not available
            }
        } else {
            Write-Host "  Could not detect tunnel URL automatically." -ForegroundColor Yellow
            Write-Host "  Check the Dev Tunnel window (minimized) for the URL." -ForegroundColor Yellow
        }
        Write-Host "  Run Stop-Dashboard.ps1 to shut everything down." -ForegroundColor DarkGray
    }
}
