$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

$complet = Join-Path $root "lancer_tradebot_complet.ps1"
$auto = Join-Path $root "autostart_paper.ps1"

if (!(Test-Path $complet) -or !(Test-Path $auto)) {
    throw "Script TradeBot IA manquant"
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $complet

if ($LASTEXITCODE -ne 0) {
    throw "Echec du lancement TradeBot IA"
}

Start-Process powershell.exe `
    -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$auto`"" `
    -WorkingDirectory $root `
    -WindowStyle Hidden
