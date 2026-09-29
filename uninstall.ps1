# Writing Agent Uninstaller PowerShell Script
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "   Writing Agent Clean Uninstaller" -ForegroundColor White
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "This will remove:" -ForegroundColor Yellow
Write-Host "  - writing-agent executables in $HOME\.local\bin"
Write-Host "  - Local virtual environment (.venv)"
Write-Host "  - Docker containers and images (if running)"
Write-Host ""
Write-Host "Your novel vault in Nextcloud will NOT be touched." -ForegroundColor Green
Write-Host ""

$confirm = Read-Host "Are you sure you want to uninstall? (y/N)"
if ($confirm -ne 'y' -and $confirm -ne 'Y') {
    Write-Host "Uninstallation cancelled." -ForegroundColor Yellow
    exit
}

Write-Host ""
Write-Host "[1/3] Removing executables from $HOME\.local\bin..." -ForegroundColor Cyan
Remove-Item -Force -ErrorAction SilentlyContinue "$HOME\.local\bin\writing-agent.exe", "$HOME\.local\bin\writing_agent.exe"

Write-Host "[2/3] Cleaning Docker containers..." -ForegroundColor Cyan
if (Get-Command docker -ErrorAction SilentlyContinue) {
    docker compose down --volumes --remove-orphans 2>$null
}

Write-Host "[3/3] Removing virtual environment and caches..." -ForegroundColor Cyan
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "$scriptDir\.venv", "$scriptDir\build", "$scriptDir\*.egg-info"
Get-ChildItem -Path $scriptDir -Recurse -Directory -Filter "__pycache__" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
Write-Host "   Uninstallation complete!" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host "The application has been cleanly removed."
Write-Host "You may now safely delete this directory: $scriptDir"
