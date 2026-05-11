# AI Investigator Setup Script
# Installs platform dependencies: Node.js, npm packages, Puppeteer (PDF export), Dev Tunnel (remote sharing)

Write-Host "Setting up AI Investigator..." -ForegroundColor Cyan

# --- Node.js ---
Write-Host ""
Write-Host "Checking for Node.js..." -ForegroundColor Yellow
$nodeExe = (Get-Command "node" -ErrorAction SilentlyContinue).Source
if ($nodeExe) {
    $nodeVersion = & node --version 2>$null
    Write-Host "Node.js found: $nodeExe ($nodeVersion)" -ForegroundColor Green
    # Validate minimum version (>=18)
    $versionNumber = [int]($nodeVersion -replace '^v(\d+).*', '$1')
    if ($versionNumber -lt 18) {
        Write-Error "Node.js 18 or higher is required (found $nodeVersion). Please upgrade Node.js and re-run this script."
        exit 1
    }
} else {
    Write-Host "Node.js not found. Installing via winget..." -ForegroundColor Yellow
    winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    $nodeExe = (Get-Command "node" -ErrorAction SilentlyContinue).Source
    if ($nodeExe) {
        Write-Host "Node.js installed: $nodeExe ($(& node --version))" -ForegroundColor Green
    } else {
        Write-Error "Node.js installation failed. Please install Node.js manually from https://nodejs.org and re-run this script."
        exit 1
    }
}

# --- Config file ---
Write-Host ""
Write-Host "Checking for backend config..." -ForegroundColor Yellow
$configPath = Join-Path $PSScriptRoot "backend" "config.json"
$samplePath = Join-Path $PSScriptRoot "backend" "config.sample.json"
if (-not (Test-Path $configPath)) {
    if (Test-Path $samplePath) {
        Copy-Item $samplePath $configPath
        Write-Host "Created config.json from config.sample.json" -ForegroundColor Green
        Write-Host "  -> Edit backend\config.json to set your LLM provider API key before running." -ForegroundColor Yellow
    } else {
        Write-Warning "No config.sample.json found. You will need to create backend\config.json manually or configure via the Settings page."
    }
} else {
    Write-Host "config.json already exists." -ForegroundColor Green
}

# --- Backend ---
Write-Host ""
Write-Host "Installing Backend Dependencies..." -ForegroundColor Yellow
Set-Location "$PSScriptRoot\backend"
npm install
if ($LASTEXITCODE -ne 0) { Write-Error "Backend install failed"; exit 1 }

# --- CLI (ai-investigator command on PATH) ---
Write-Host ""
Write-Host "Building backend and installing 'ai-investigator' CLI on PATH..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Backend build failed. The dashboard will still work (it uses ts-node-dev), but the 'ai-investigator' CLI will not be available until 'npm run build' succeeds in backend\."
} else {
    npm link
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "'npm link' failed. The CLI is built (use 'npm run investigate -- ...' from backend\), but the global 'ai-investigator' command was not registered. You can retry manually with: cd backend; npm link"
    } else {
        $cliExe = (Get-Command "ai-investigator" -ErrorAction SilentlyContinue).Source
        if ($cliExe) {
            Write-Host "CLI ready: $cliExe" -ForegroundColor Green
        } else {
            Write-Host "CLI linked. Open a new terminal so PATH refreshes, then run 'ai-investigator --help'." -ForegroundColor Green
        }
    }
}

# --- Puppeteer Chromium (for PDF export) ---
Write-Host ""
Write-Host "Ensuring Puppeteer Chromium browser is downloaded..." -ForegroundColor Yellow
npx puppeteer browsers install chrome
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Puppeteer Chromium install failed. PDF export may not work until manually resolved (run 'npx puppeteer browsers install chrome' in the backend directory)."
} else {
    Write-Host "Puppeteer Chromium ready." -ForegroundColor Green
}

# --- Frontend ---
Write-Host ""
Write-Host "Installing Frontend Dependencies..." -ForegroundColor Yellow
Set-Location "$PSScriptRoot\frontend"
npm install
if ($LASTEXITCODE -ne 0) { Write-Error "Frontend install failed"; exit 1 }

# --- Incident Provider Dependencies (optional) ---
$icmScriptsDir = Join-Path $PSScriptRoot "scripts" "icm"
if (Test-Path (Join-Path $icmScriptsDir "package.json")) {
    Write-Host ""
    Write-Host "Installing ICM incident provider dependencies..." -ForegroundColor Yellow
    Set-Location $icmScriptsDir
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "ICM script dependency install failed. ICM incident reading may not work until manually resolved."
    } else {
        Write-Host "ICM incident provider dependencies installed." -ForegroundColor Green
    }
}

# --- Dev Tunnel CLI (for remote sharing) ---
Write-Host ""
Write-Host "Checking for Dev Tunnel CLI..." -ForegroundColor Yellow
$devtunnelExe = (Get-Command "devtunnel" -ErrorAction SilentlyContinue).Source
if (-not $devtunnelExe) {
    $wingetPath = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
    $found = Get-ChildItem -Path $wingetPath -Filter "devtunnel.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $devtunnelExe = $found.FullName }
}
if (-not $devtunnelExe) {
    Write-Host "Installing devtunnel CLI..." -ForegroundColor Yellow
    winget install Microsoft.devtunnel --accept-source-agreements --accept-package-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    $devtunnelExe = (Get-Command "devtunnel" -ErrorAction SilentlyContinue).Source
    if (-not $devtunnelExe) {
        $found = Get-ChildItem -Path $wingetPath -Filter "devtunnel.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) { $devtunnelExe = $found.FullName }
    }
}
if ($devtunnelExe) {
    Write-Host "devtunnel CLI ready: $devtunnelExe" -ForegroundColor Green
    Write-Host "Ensuring devtunnel login..." -ForegroundColor Yellow
    & $devtunnelExe user login
} else {
    Write-Warning "devtunnel installation failed. Remote sharing won't work. Use -NoTunnel when running the dashboard."
}

# --- Done ---
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host " Next steps:" -ForegroundColor White
Write-Host "   1. Run 'Run-Dashboard.ps1' to start the dashboard" -ForegroundColor DarkGray
Write-Host "      OR run 'ai-investigator --help' for the command-line interface" -ForegroundColor DarkGray
Write-Host "   2. Open Settings > Connections to configure:" -ForegroundColor DarkGray
Write-Host "      - LLM Provider (Copilot, OpenAI, Anthropic, etc.)" -ForegroundColor DarkGray
Write-Host "      - Incident Provider (IcM, PagerDuty, or Manual)" -ForegroundColor DarkGray
Write-Host "      - MCP Tool Servers (KQL, SQL, or any MCP-compatible tool)" -ForegroundColor DarkGray
Write-Host "   3. Open Settings > Products to add your product repo" -ForegroundColor DarkGray
Write-Host ""
Set-Location $PSScriptRoot
