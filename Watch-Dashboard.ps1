# Watch-Dashboard.ps1
# Background watcher: monitors the Investigation Dashboard UI and triggers
# Stop-Dashboard.ps1 when the user closes it.
#
# Two modes:
#   App mode (default): watch for the Edge --app window identified by -AppUrlMatch.
#   Classic mode:       watch a list of process IDs (-WatchPids) — shut down when
#                       ANY of them exits (i.e. user closes a console window).
#
# Spawned automatically by Run-Dashboard.ps1. Not normally invoked directly.
#
# Parameters:
#   -AppUrlMatch        : Substring identifying the Edge --app process command line
#                         (defaults to '--app=http://localhost:5173').
#   -WatchPids          : Comma-separated PIDs to watch (Classic mode). When provided,
#                         the script ignores -AppUrlMatch and uses process-watch mode.
#   -InitialWaitSeconds : How long to wait for the target to appear after launch.
#   -PollSeconds        : Polling interval while watching.

param(
    [string]$AppUrlMatch = '--app=http://localhost:5173',
    [string]$WatchPids = '',
    [int]$InitialWaitSeconds = 30,
    [int]$PollSeconds = 2
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Get-DashboardEdgeProcs {
    param([string]$Match)
    try {
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            $_.Name -eq 'msedge.exe' -and $_.CommandLine -like "*$Match*"
        }
    } catch {
        @()
    }
}

# Parse PIDs (Classic mode) up front.
$pidList = @()
if ($WatchPids) {
    $pidList = $WatchPids -split '[,\s]+' | Where-Object { $_ } | ForEach-Object { [int]$_ }
}

if ($pidList.Count -gt 0) {
    # ----- Classic mode: watch the supplied PIDs. -----
    # Wait briefly to make sure they're actually running.
    $elapsed = 0
    $anyAlive = $false
    while ($elapsed -lt $InitialWaitSeconds) {
        $anyAlive = $false
        foreach ($targetPid in $pidList) {
            if (Get-Process -Id $targetPid -ErrorAction SilentlyContinue) {
                $anyAlive = $true
                break
            }
        }
        if ($anyAlive) { break }
        Start-Sleep -Seconds 1
        $elapsed++
    }
    if (-not $anyAlive) { exit 0 }

    # Poll until ANY watched PID is gone — that signals the user closed a console window.
    while ($true) {
        Start-Sleep -Seconds $PollSeconds
        foreach ($targetPid in $pidList) {
            if (-not (Get-Process -Id $targetPid -ErrorAction SilentlyContinue)) {
                $triggered = $true
                break
            }
        }
        if ($triggered) { break }
    }
} else {
    # ----- App mode: watch the Edge --app window. -----
    # Phase 1: wait for the Edge --app window to actually appear.
    $elapsed = 0
    $appearedOnce = $false
    while ($elapsed -lt $InitialWaitSeconds) {
        if (Get-DashboardEdgeProcs -Match $AppUrlMatch) {
            $appearedOnce = $true
            break
        }
        Start-Sleep -Seconds 1
        $elapsed++
    }

    if (-not $appearedOnce) {
        # Edge app window never appeared — bail out without touching the dashboard.
        exit 0
    }

    # Phase 2: poll until the Edge --app window is gone, then shut down.
    # Require two consecutive empty polls to avoid false positives during Edge restarts.
    $emptyStreak = 0
    while ($true) {
        Start-Sleep -Seconds $PollSeconds
        $procs = Get-DashboardEdgeProcs -Match $AppUrlMatch
        if (-not $procs) {
            $emptyStreak++
            if ($emptyStreak -ge 2) { break }
        } else {
            $emptyStreak = 0
        }
    }
}

# User closed the UI — shut everything down.
$stopScript = Join-Path $ScriptDir 'Stop-Dashboard.ps1'
if (Test-Path $stopScript) {
    & $stopScript | Out-Null
}
