# Investigation Dashboard Setup Script
# Installs Kusto CLI + dependencies for both Backend and Frontend

Write-Host "Setting up Investigation Dashboard..." -ForegroundColor Cyan

# --- Kusto CLI ---
Write-Host ""
Write-Host "Checking for Kusto CLI..." -ForegroundColor Yellow

$kustoExe = $null
# 1. Check PATH
$kustoExe = Get-Command "Kusto.Cli.exe" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
# 2. Check well-known location
if (-not $kustoExe -and (Test-Path "C:\Kusto\tools\net8.0\Kusto.Cli.exe")) {
    $kustoExe = "C:\Kusto\tools\net8.0\Kusto.Cli.exe"
}
# 3. Check NuGet cache
if (-not $kustoExe) {
    $nugetPath = Join-Path $env:USERPROFILE ".nuget\packages\microsoft.azure.kusto.tools"
    if (Test-Path $nugetPath) {
        $kustoExe = Get-ChildItem -Path $nugetPath -Filter "Kusto.Cli.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
    }
}

if ($kustoExe) {
    Write-Host "Kusto CLI found: $kustoExe" -ForegroundColor Green
} else {
    Write-Host "Kusto CLI not found. Installing from NuGet..." -ForegroundColor Yellow

    $installDir = "C:\Kusto"
    $nupkgUrl  = "https://www.nuget.org/api/v2/package/Microsoft.Azure.Kusto.Tools/14.0.3"
    $nupkgPath = Join-Path $installDir "kusto-tools.nupkg"
    $zipPath   = Join-Path $installDir "kusto-tools.zip"

    # Create directory
    if (-not (Test-Path $installDir)) {
        New-Item -ItemType Directory -Path $installDir -Force | Out-Null
        Write-Host "  Created $installDir" -ForegroundColor DarkGray
    }

    # Download
    Write-Host "  Downloading Microsoft.Azure.Kusto.Tools v14.0.3 (this may take a minute)..." -ForegroundColor DarkGray
    try {
        curl.exe -L -o $nupkgPath $nupkgUrl --silent --show-error
    } catch {
        Write-Warning "Download failed: $_"
    }

    if (Test-Path $nupkgPath) {
        $sizeMB = [math]::Round((Get-Item $nupkgPath).Length / 1MB, 1)
        Write-Host "  Downloaded $sizeMB MB" -ForegroundColor DarkGray

        if ((Get-Item $nupkgPath).Length -lt 100KB) {
            Write-Warning "Download too small - possible network error. Skipping."
            Remove-Item $nupkgPath -Force
        } else {
            # Extract (NuGet packages are ZIP files)
            Rename-Item $nupkgPath $zipPath -Force
            Write-Host "  Extracting..." -ForegroundColor DarkGray
            Expand-Archive -Path $zipPath -DestinationPath $installDir -Force
            Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

            # Verify
            $kustoExe = Get-ChildItem -Path $installDir -Filter "Kusto.Cli.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
            if ($kustoExe) {
                Write-Host "Kusto CLI installed: $kustoExe" -ForegroundColor Green
                Write-Host "  Tip: Add '$(Split-Path $kustoExe)' to your PATH for faster startup." -ForegroundColor DarkGray
            } else {
                Write-Warning "Extraction complete but Kusto.Cli.exe not found. The runtime will retry on first launch."
            }
        }
    } else {
        Write-Warning "Download failed. The runtime will auto-install on first launch as a fallback."
    }
}

# --- Backend ---
Write-Host ""
Write-Host "Installing Backend Dependencies..." -ForegroundColor Yellow
Set-Location "$PSScriptRoot\backend"
npm install
if ($LASTEXITCODE -ne 0) { Write-Error "Backend install failed"; exit 1 }

# --- Frontend ---
Write-Host "Installing Frontend Dependencies..." -ForegroundColor Yellow
Set-Location "$PSScriptRoot\frontend"
npm install
if ($LASTEXITCODE -ne 0) { Write-Error "Frontend install failed"; exit 1 }

# --- ICM Scripts (Playwright) ---
$icmScriptsDir = Join-Path $PSScriptRoot "scripts" "icm"
if (Test-Path (Join-Path $icmScriptsDir "package.json")) {
    Write-Host ""
    Write-Host "Installing ICM Script Dependencies (Playwright)..." -ForegroundColor Yellow
    Set-Location $icmScriptsDir
    npm ci
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "ICM script dependency install failed. ICM incident reading may not work until manually resolved."
    } else {
        Write-Host "ICM script dependencies installed." -ForegroundColor Green
    }
} else {
    Write-Host ""
    Write-Host "ICM scripts directory not found - skipping Playwright install." -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Setup Complete! You can now run 'Run-Dashboard.ps1'" -ForegroundColor Green
Set-Location $PSScriptRoot
