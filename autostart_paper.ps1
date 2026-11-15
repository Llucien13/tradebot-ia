$base = "http://127.0.0.1:8765"
$log = Join-Path $env:LOCALAPPDATA "TradeBotIA\autostart-paper.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null

function Log($message) {
    Add-Content $log "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - $message"
}

Log "Demarrage automatique PAPER demande"

for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Seconds 10

    try {
        $s = Invoke-RestMethod "$base/status" -TimeoutSec 5

        if ($s.mode -ne "PAPER" -or
            $s.liveEnabled -ne $false -or
            $s.readonly -ne $true) {
            Log "BLOQUE : configuration de securite incorrecte"
            exit 1
        }

        if ($s.connected -ne $true) { continue }

        $p = Invoke-RestMethod "$base/paper-trial/state" -TimeoutSec 5

        if ($p.state.status -eq "FAILED" -or
            $p.worker.status -eq "SAFE_STOP" -or
            $p.storageFault -or
            $null -ne $p.state.position) {
            Log "BLOQUE : verification manuelle requise"
            exit 1
        }

        if ($p.state.running -eq $true) {
            Log "PAPER deja actif, aucun second lancement"
            exit 0
        }

        $null = Invoke-RestMethod "$base/ftmo/clock-evidence" -TimeoutSec 10
        $r = Invoke-RestMethod "$base/paper-trial/start" -Method Post -TimeoutSec 25

        if ($r.state.running -eq $true) {
            Log "PAPER DEMARRE"
            exit 0
        }
    }
    catch {
        if ($i % 6 -eq 0) {
            Log "En attente : $($_.Exception.Message)"
        }
    }
}

Log "Demarrage non confirme apres 20 minutes"
