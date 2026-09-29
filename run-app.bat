@echo off
title Writing Agent Dashboard
setlocal
cd /d "%~dp0"

echo ===================================================
echo  Starting Writing Agent Visual App...
echo ===================================================

if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" app.py
) else (
    writing-agent app
)

pause
