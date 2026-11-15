$root = $PSScriptRoot
$url = "http://127.0.0.1:3088/"

function Test-Serveur {
    try {
        $r = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 2
        return ($r.StatusCode -eq 200)
    } catch {
        return $false
    }
}

if (-not (Test-Serveur)) {
    Write-Host "Demarrage du serveur TradeBot IA..."
    $env:HOST = "127.0.0.1"
    $env:PORT = "3088"

    Start-Process -FilePath "node.exe" `
        -ArgumentList ".\.output\server\index.mjs" `
        -WorkingDirectory $root -WindowStyle Hidden

    for ($i = 0; $i -lt 30; $i++) {
        if (Test-Serveur) { break }
        Start-Sleep -Seconds 1
    }
}

if (-not (Test-Serveur)) {
    Write-Host "ERREUR : serveur Nitro indisponible"
    exit 1
}

$exe = Join-Path $env:LOCALAPPDATA "Programs\TradeBot IA\TradeBot IA.exe"

if (!(Test-Path $exe)) {
    throw "TradeBot IA.exe introuvable"
}

Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe -Parent)
Write-Host "TRADEBOT IA EXE LANCE"
