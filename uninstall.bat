@echo off
setlocal
echo ========================================================
echo   Writing Agent Uninstaller
echo ========================================================
echo.
echo This will remove:
echo   - writing-agent executables in %%USERPROFILE%%\.local\bin
echo   - Local virtual environment (.venv)
echo   - Docker containers (if created)
echo.
echo Your novel vault in Nextcloud will NOT be touched.
echo.
set /p CONFIRM="Are you sure you want to uninstall? (y/N): "
if /i not "%CONFIRM%"=="y" (
    echo Uninstallation cancelled.
    pause
    exit /b 0
)

echo.
echo [1/3] Removing executables from %%USERPROFILE%%\.local\bin...
if exist "%USERPROFILE%\.local\bin\writing-agent.exe" del /f /q "%USERPROFILE%\.local\bin\writing-agent.exe"
if exist "%USERPROFILE%\.local\bin\writing_agent.exe" del /f /q "%USERPROFILE%\.local\bin\writing_agent.exe"

echo [2/3] Cleaning Docker containers (if running)...
where docker >nul 2>nul
if %ERRORLEVEL% equ 0 (
    docker compose down --volumes --remove-orphans >nul 2>nul
)

echo [3/3] Removing virtual environment and caches...
if exist "%~dp0.venv" rmdir /s /q "%~dp0.venv"
if exist "%~dp0build" rmdir /s /q "%~dp0build"
for /d /r "%~dp0" %%d in (__pycache__ *.egg-info) do if exist "%%d" rmdir /s /q "%%d"

echo.
echo ========================================================
echo   Uninstallation complete!
echo ========================================================
echo The application and CLI aliases have been cleanly removed.
echo You may now safely delete this folder: %~dp0
echo.
pause
