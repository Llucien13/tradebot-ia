$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$python = Join-Path $root ".venv-mt5\Scripts\python.exe"
$bridge = Join-Path $root "src\mt5_bridge\bridge.py"
$lanceur = Join-Path $root "lancer_tradebot.ps1"

function Get-Bridge {
    try {
        return Invoke-RestMethod "http://127.0.0.1:8765/status" -TimeoutSec 3
    } catch {
        return $null
    }
}

$s = Get-Bridge

if ($null -eq $s) {
    if (!(Test-Path $python) -or !(Test-Path $bridge)) {
        throw "Fichiers de passerelle introuvables"
    }

    $logs = Join-Path $env:LOCALAPPDATA "TradeBotIA"
    New-Item -ItemType Directory -Force -Path $logs | Out-Null

    Start-Process -FilePath $python `
        -ArgumentList "src\mt5_bridge\bridge.py" `
        -WorkingDirectory $root `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logs "bridge-ui-out.log") `
        -RedirectStandardError (Join-Path $logs "bridge-ui-err.log")

    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        $s = Get-Bridge
        if ($null -ne $s) { break }
    }
}

if ($null -eq $s) {
    throw "Passerelle MT5 indisponible"
}

if ($s.mode -ne "PAPER" -or $s.liveEnabled -ne $false) {
    throw "SECURITE : mode PAPER / LIVE OFF non confirme"
}

if (!(Test-Path $lanceur)) {
    throw "Lanceur de l'interface introuvable"
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $lanceur
