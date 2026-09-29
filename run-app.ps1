$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

Write-Host "===================================================" -ForegroundColor Cyan
Write-Host " Starting Writing Agent Visual Dashboard..." -ForegroundColor Green
Write-Host "===================================================" -ForegroundColor Cyan

$venvPy = Join-Path $scriptDir ".venv\Scripts\python.exe"
if (Test-Path $venvPy) {
    & $venvPy (Join-Path $scriptDir "app.py")
} else {
    writing-agent app
}
