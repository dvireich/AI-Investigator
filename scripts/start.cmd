@echo off
title AI Investigator
setlocal
echo.
echo   AI Investigator
echo   ================
echo.

:: Check for port 3000 in use
set PORT=3000
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :%PORT% ^| findstr LISTENING 2^>nul') do (
    if not "%%p"=="0" (
        echo.
        echo ==================================================
        echo   Previous AI Investigator instance detected
        echo   Shutting it down to start a fresh session...
        echo ==================================================
        echo.
        taskkill /PID %%p /F >nul 2>&1
        timeout /t 1 /nobreak >nul
    )
)

:: Launch the exe, forwarding all arguments
"%~dp0ai-investigator.exe" %*
