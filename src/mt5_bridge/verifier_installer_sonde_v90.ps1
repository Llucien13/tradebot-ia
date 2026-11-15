param([switch]$Install, [string]$CompiledPath)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$report = [ordered]@{ version = 90; atUTC = [DateTime]::UtcNow.ToString('o'); mode = 'PAPER'; liveEnabled = $false; installation = 'NON_EXECUTEE'; checks = @(); candidates = @(); error = $null }
$exitCode = 2

function Get-Value($Object, [string]$Name) {
    if ($null -ne $Object -and $null -ne $Object.PSObject.Properties[$Name]) { return $Object.$Name }
    return $null
}
function Record([string]$Name, $Value) {
    $script:report.checks += [ordered]@{ name = $Name; value = $Value }
    Write-Host ($Name + ' : ' + ($Value | ConvertTo-Json -Depth 12 -Compress))
}
function Get-Local([string]$Route) {
    if ($Route -notin @('/status?symbol=XAUUSD', '/ftmo/clock-evidence', '/paper-trial/state')) { throw 'Route refusee.' }
    Invoke-RestMethod -Uri ('http://127.0.0.1:8765' + $Route) -Method Get -TimeoutSec 90 -MaximumRedirection 0
}
function Assert-PlainPath([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force
    while ($null -ne $item) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw ('Lien/jonction refuse : ' + $item.FullName) }
        if ($item -is [IO.FileInfo]) { $item = $item.Directory } else { $item = $item.Parent }
    }
}
function Hash([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash }
function Stream-Hash($Stream) {
    $Stream.Position = 0
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($Stream)).Replace('-', '') }
    finally { $sha.Dispose(); $Stream.Position = 0 }
}
function Identity($Status) {
    if ((Get-Value $Status 'connected') -ne $true -or (Get-Value $Status 'liveEnabled') -ne $false) { throw 'Connexion locale PAPER non confirmee.' }
    $account = Get-Value $Status 'account'
    if ((Get-Value $account 'type') -ne 'DEMO' -or [string](Get-Value $account 'server') -notmatch '^FTMO-Demo') { throw 'Compte FTMO-Demo DEMO non confirme.' }
    return ([string]$account.login + '|' + [string]$account.server + '|' + [string]$Status.terminal.path)
}
function Check-PaperIdentity($Paper, $Status) {
    if ((Get-Value $Paper 'kind') -ne 'ESSAI_PAPER') { throw 'Source ESSAI PAPER non confirmee.' }
    $state = $Paper.state
    if ($state.mode -ne 'PAPER' -or $state.liveEnabled -ne $false) { throw 'LIVE OFF non confirme.' }
    foreach ($quote in @((Get-Value $state 'lastQuote'), (Get-Value $Paper 'feed'), (Get-Value $state 'position'))) {
        $basis = Get-Value $quote 'timeBasis'
        if ($null -ne $basis -and (([string](Get-Value $basis 'login') -ne [string]$Status.account.login) -or ([string](Get-Value $basis 'server') -ne [string]$Status.account.server))) {
            throw 'Compte PAPER conserve different du compte MT5 courant. Installation refusee.'
        }
    }
}
function Assert-Current($Expected, [string]$ProofPath) {
    $status = Get-Local '/status?symbol=XAUUSD'
    if ((Identity $status) -ne $Expected) { throw 'Identite MT5 modifiee pendant le controle.' }
    $clock = Get-Local '/ftmo/clock-evidence'
    if ([string]$clock.nativeProbeSource -ne $ProofPath -or [string]$clock.accountLogin -ne [string]$status.account.login -or [string]$clock.server -ne [string]$status.account.server) {
        throw 'Dossier de donnees ou compte modifie pendant le controle.'
    }
    Check-PaperIdentity (Get-Local '/paper-trial/state') $status
}

try {
    $source = Join-Path $PSScriptRoot 'TradeBotClockProbe.mq5'
    Assert-PlainPath $source
    $sourceHash = Hash $source
    $status = Get-Local '/status?symbol=XAUUSD'
    $identity = Identity $status
    $paper = Get-Local '/paper-trial/state'
    Check-PaperIdentity $paper $status
    $clock = Get-Local '/ftmo/clock-evidence'
    if ([string]$clock.accountLogin -ne [string]$status.account.login -or [string]$clock.server -ne [string]$status.account.server) { throw 'Diagnostics de comptes differents.' }
    Record 'Observations initiales (avant installation)' ([ordered]@{ nativeProofStatus = (Get-Value $clock 'nativeProofStatus'); quotesStatus = (Get-Value $clock 'quotesStatus'); nativeProbeError = (Get-Value $clock 'nativeProbeError'); paperConnected = $paper.connected; worker = $paper.worker })
    $proof = [string](Get-Value $clock 'nativeProbeSource')
    if (-not [IO.Path]::IsPathRooted($proof) -or [IO.Path]::GetFileName($proof) -ne 'tradebot-clock-proof.json') { throw 'Chemin natif absent ou invalide.' }
    $files = Split-Path -Parent $proof
    $mql = Split-Path -Parent $files
    if ((Split-Path -Leaf $files) -ne 'Files' -or (Split-Path -Leaf $mql) -ne 'MQL5') { throw 'Arborescence native non confirmee.' }
    $dataPath = Split-Path -Parent $mql
    Assert-PlainPath $dataPath
    $scripts = Join-Path $mql 'Scripts'
    if (-not (Test-Path -LiteralPath $scripts -PathType Container)) { throw 'MQL5/Scripts absent : aucune creation de chemin suppose.' }
    Assert-PlainPath $scripts
    $target = Join-Path $scripts 'TradeBotClockProbe.ex5'
    Record 'Instance MT5 identifiee par la passerelle' ([ordered]@{ identity = $identity; dataPath = $dataPath; target = $target; proof = $proof })

    # Search only the repository and the actual terminal data directory, never guessed AppData terminals.
    $paths = @((Join-Path $PSScriptRoot 'TradeBotClockProbe.ex5'), $target)
    foreach ($root in @($PSScriptRoot, $scripts)) {
        $paths += @(Get-ChildItem -LiteralPath $root -Filter 'TradeBotClockProbe.ex5' -File -Recurse | Select-Object -ExpandProperty FullName)
    }
    if ($CompiledPath) {
        if ([IO.Path]::GetFileName($CompiledPath) -ne 'TradeBotClockProbe.ex5') { throw 'CompiledPath doit designer TradeBotClockProbe.ex5.' }
        $paths += [IO.Path]::GetFullPath($CompiledPath)
    }
    $candidates = @()
    foreach ($path in @($paths | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
        Assert-PlainPath $path
        $file = Get-Item -LiteralPath $path
        $sibling = [IO.Path]::ChangeExtension($path, '.mq5')
        $matches = (Test-Path -LiteralPath $sibling -PathType Leaf)
        if ($matches) { Assert-PlainPath $sibling; $matches = ((Hash $sibling) -eq $sourceHash -and $file.LastWriteTimeUtc -ge (Get-Item -LiteralPath $sibling).LastWriteTimeUtc) }
        $candidates += [pscustomobject]@{ path = $file.FullName; modifiedUTC = $file.LastWriteTimeUtc.ToString('o'); length = $file.Length; sha256 = (Hash $path); sourceMatches = [bool]$matches }
    }
    $report.candidates = $candidates
    Record 'Binaires trouves (date et empreinte)' $candidates
    $eligible = @($candidates | Where-Object { $_.sourceMatches -and $_.length -gt 0 -and $_.length -le 20971520 -and [DateTime]::Parse($_.modifiedUTC).ToUniversalTime() -le [DateTime]::UtcNow })
    if ($CompiledPath) {
        $full = [IO.Path]::GetFullPath($CompiledPath)
        $eligible = @($eligible | Where-Object { $_.path -eq $full })
    }
    if ($eligible.Count -eq 0) { throw 'Aucun EX5 relie au source courant par son MQ5 voisin et sa date. Preciser CompiledPath si la compilation est ailleurs.' }
    $selected = $eligible | Sort-Object { [DateTime]::Parse($_.modifiedUTC) } -Descending | Select-Object -First 1
    $ties = @($eligible | Where-Object { $_.modifiedUTC -eq $selected.modifiedUTC -and $_.sha256 -ne $selected.sha256 })
    if ($ties.Count -gt 0) { throw 'Derniere compilation ambigue; selection explicite CompiledPath requise.' }
    Record 'Dernier candidat admissible (pas une attestation du compilateur)' $selected
    $installedHash = $null
    if (Test-Path -LiteralPath $target) {
        Assert-PlainPath $target
        $installedHash = Hash $target
    }
    if ($installedHash -eq $selected.sha256) {
        $report.installation = 'DEJA_INSTALLE_IDENTIQUE'
    } elseif ($Install) {
        Write-Host ('Source : ' + $selected.path + '; cible : ' + $target + '; SHA256 : ' + $selected.sha256)
        if ((Read-Host 'Taper INSTALLER pour confirmer la copie sauvegardee (aucun lancement MT5)') -cne 'INSTALLER') { throw 'Installation annulee.' }
        Assert-Current $identity $proof
        Assert-PlainPath $selected.path
        Assert-PlainPath $scripts
        if ((Hash $selected.path) -ne $selected.sha256 -or (Hash $source) -ne $sourceHash) { throw 'Source modifiee depuis inspection.' }
        $bytes = [IO.File]::ReadAllBytes($selected.path)
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $bytesHash = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '') } finally { $sha.Dispose() }
        if ($bytesHash -ne $selected.sha256) { throw 'Binaire modifie pendant sa lecture.' }
        $handle = $null
        $backup = $null
        $createdNew = $false
        $written = $false
        try {
            if ($null -ne $installedHash) {
                Assert-PlainPath $target
                $handle = [IO.File]::Open($target, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
                if ((Stream-Hash $handle) -ne $installedHash) { throw 'Cible modifiee depuis inspection; aucun ecrasement.' }
                $backup = $target + '.' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '.' + [Guid]::NewGuid().ToString('N') + '.bak'
                $copy = [IO.File]::Open($backup, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
                try { $handle.CopyTo($copy); $copy.Flush($true) } finally { $copy.Dispose(); $handle.Position = 0 }
                if ((Hash $backup) -ne $installedHash) { throw 'Sauvegarde non conforme; cible non modifiee.' }
            } else {
                $handle = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
                $createdNew = $true
            }
            try {
                $handle.Position = 0
                $handle.Write($bytes, 0, $bytes.Length)
                $handle.SetLength($bytes.Length)
                $handle.Flush($true)
                if ((Stream-Hash $handle) -ne $selected.sha256) { throw 'Empreinte apres ecriture incorrecte.' }
                $written = $true
            } catch {
                if ($backup) {
                    $old = [IO.File]::ReadAllBytes($backup)
                    $handle.Position = 0; $handle.Write($old, 0, $old.Length); $handle.SetLength($old.Length); $handle.Flush($true)
                }
                throw
            }
        } finally {
            if ($null -ne $handle) { $handle.Dispose() }
            if ($createdNew -and -not $written) { Remove-Item -LiteralPath $target -Force }
        }
        $report.installation = 'COPIE_VERIFIEE'
        Record 'Sauvegarde precedente' $backup
    } else {
        $report.installation = 'COPIE_NECESSAIRE_NON_EXECUTEE'
    }
    Record 'Installation' $report.installation
    if (Test-Path -LiteralPath $target -PathType Leaf) {
        $installed = Get-Item -LiteralPath $target
        Record 'Binaire installe observe' ([ordered]@{ path = $installed.FullName; modifiedUTC = $installed.LastWriteTimeUtc.ToString('o'); sha256 = (Hash $target) })
    }
    # These GETs do not start PAPER, the native script or MT5.
    Assert-Current $identity $proof
    $clock = Get-Local '/ftmo/clock-evidence'
    $paper = Get-Local '/paper-trial/state'
    Record 'Diagnostic horloge existant' ([ordered]@{ nativeProofStatus = (Get-Value $clock 'nativeProofStatus'); quotesStatus = (Get-Value $clock 'quotesStatus'); nativeProbeError = (Get-Value $clock 'nativeProbeError'); tradeSessions = (Get-Value (Get-Value $clock 'nativeProbe') 'tradeSessions'); tests = (Get-Value $clock 'tests'); conclusion = (Get-Value $clock 'conclusion') })
    Record 'PAPER observe sans commande START' ([ordered]@{ connected = $paper.connected; valuationFresh = $paper.valuationFresh; worker = $paper.worker; running = $paper.state.running; monitoringBlocked = $paper.state.monitoringBlocked; error = $paper.state.error })
    if (Test-Path -LiteralPath $proof -PathType Leaf) {
        $p = Get-Item -LiteralPath $proof
        Record 'Date du releve natif' ($p.LastWriteTimeUtc.ToString('o'))
    }
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()/1000.0
    $hb = Get-Value $paper.worker 'heartbeat'
    $monitoring = ($null -ne $hb -and ($now - [double]$hb) -ge 0 -and ($now - [double]$hb) -le 15 -and $paper.worker.alive -eq $true -and $paper.state.running -eq $true -and -not $paper.state.monitoringBlocked)
    Record 'Heartbeat PAPER et surveillance' $monitoring
    $hasSessions = ($null -ne (Get-Value (Get-Value $clock 'nativeProbe') 'tradeSessions'))
    $exitCode = 0
    if ($report.installation -eq 'COPIE_NECESSAIRE_NON_EXECUTEE' -or $clock.nativeProofStatus -ne 'VERIFIED' -or $clock.quotesStatus -ne 'AVAILABLE' -or -not $paper.connected -or -not $paper.valuationFresh -or -not $monitoring -or -not $hasSessions -or $report.installation -eq 'COPIE_VERIFIEE') { $exitCode = 2 }
    Write-Host 'Aucun ordre, START, redemarrage MT5/passerelle ou changement du demarrage automatique.'
    if ($clock.nativeProofStatus -ne 'VERIFIED' -or -not $hasSessions -or $report.installation -eq 'COPIE_VERIFIEE') {
        Write-Host 'Action MT5 si la sonde actualisee ne tourne pas : Navigateur > Scripts > Actualiser, puis glisser TradeBotClockProbe sur un graphique du compte FTMO-Demo et confirmer ses parametres horaires verifies. Si une ancienne instance tourne, la retirer de ce graphique avant de lancer la nouvelle.'
    }
} catch {
    $report.error = $_.Exception.Message
    Write-Host ('BLOQUE : ' + $report.error)
    $exitCode = 2
} finally {
    $report.exitCode = $exitCode
    $directory = Join-Path $env:LOCALAPPDATA 'TradeBotIA\validation-v90'
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    $output = Join-Path $directory ('sonde-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [Guid]::NewGuid().ToString('N') + '.json')
    $report | ConvertTo-Json -Depth 24 | Set-Content -LiteralPath $output -Encoding UTF8
    Write-Host ('Rapport local (contient chemins et identifiant de compte) : ' + $output)
}
exit $exitCode
