param([ValidateSet('Audit','Prepare','Verify')][string]$Action = 'Audit')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$id = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [Guid]::NewGuid().ToString('N')
$directory = Join-Path $env:LOCALAPPDATA ('TradeBotIA\maintenance-v92\' + $id)
[IO.Directory]::CreateDirectory($directory) | Out-Null
$report = [ordered]@{ release = 'V92'; action = $Action; atUTC = [DateTime]::UtcNow.ToString('o'); root = $root; observations = @(); decisions = @(); restarted = $false; ordersSent = $false; testsRun = 0; error = $null }
$exitCode = 2
function Value($Object, [string]$Name) {
    if ($null -ne $Object -and $null -ne $Object.PSObject.Properties[$Name]) { return $Object.$Name }
    return $null
}
function Observe([string]$Name, $Data) {
    $script:report.observations += [ordered]@{ name = $Name; data = $Data }
    Write-Host ($Name + ' : ' + ($Data | ConvertTo-Json -Depth 24 -Compress))
}
function Decision([string]$Text) {
    $script:report.decisions += $Text
    Write-Host $Text
}
function Get-Local([int]$Port, [string]$Route) {
    try {
        $response = Invoke-WebRequest -Uri ('http://127.0.0.1:' + $Port + $Route) -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 12 -Headers @{ 'Cache-Control' = 'no-cache' }
        return $response
    } catch {
        Observe ('HTTP ' + $Port + $Route) ([ordered]@{ error = $_.Exception.Message })
        return $null
    }
}
function Get-Json([int]$Port, [string]$Route) {
    $response = Get-Local $Port $Route
    if ($null -eq $response) { return $null }
    try { return $response.Content | ConvertFrom-Json } catch { Observe ('JSON invalide ' + $Route) $_.Exception.Message; return $null }
}
function File-Identity([string]$Path) {
    if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { return [ordered]@{ path = $Path; present = $false } }
    $f = Get-Item -LiteralPath $Path
    return [ordered]@{ path = $f.FullName; present = $true; sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant(); modifiedUTC = $f.LastWriteTimeUtc.ToString('o'); productVersion = $f.VersionInfo.ProductVersion }
}
try {
    $all = @(Get-CimInstance Win32_Process)
    $ports = @()
    foreach ($port in @(3088,8765)) {
        $ports += @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess)
    }
    Observe 'Listeners' $ports
    if (@($ports | Where-Object { $_.LocalAddress -notin @('127.0.0.1','::1') }).Count -gt 0) { throw 'Port applicatif expose hors loopback; aucune requete ni preparation autorisee.' }
    $owners = @($ports | Select-Object -ExpandProperty OwningProcess -Unique)
    if (@($ports | Where-Object { $_.LocalPort -eq 3088 }).Count -gt 0 -and @($ports | Where-Object { $_.LocalPort -eq 3088 }).OwningProcess.Count -gt 1) { throw 'Plusieurs listeners web concurrents sur 3088; identite de l’interface ambigue, aucune preparation.' }
    if (@($ports | Where-Object { $_.LocalPort -eq 8765 }).Count -gt 0 -and @($ports | Where-Object { $_.LocalPort -eq 8765 }).OwningProcess.Count -gt 1) { throw 'Plusieurs listeners passerelle sur 8765; identite MT5 ambigue.' }
    $relevant = @($all | Where-Object { $_.ProcessId -in $owners -or $_.Name -in @('TradeBot IA.exe','terminal64.exe') -or [string]$_.CommandLine -match '(?i)(bridge\.py|autostart_paper\.ps1)' })
    $processes = @($relevant | ForEach-Object {
        $owner = $null
        try { $o = Invoke-CimMethod -InputObject $_ -MethodName GetOwner; if ($o.ReturnValue -eq 0) { $owner = $o.Domain + '\' + $o.User } } catch { }
        [pscustomobject]@{ pid = $_.ProcessId; parentPID = $_.ParentProcessId; name = $_.Name; executable = $_.ExecutablePath; session = $_.SessionId; owner = $owner; created = [string]$_.CreationDate; bridgeDetected = ([string]$_.CommandLine -match '(?i)bridge\.py'); autostartDetected = ([string]$_.CommandLine -match '(?i)autostart_paper\.ps1'); currentWebEntrypointDetected = ([string]$_.CommandLine -match [regex]::Escape((Join-Path $root '.output\server\index.mjs'))) }
    })
    Observe 'Processus reels (arguments sensibles exclus)' $processes
    foreach ($p in @($relevant | Where-Object { $_.Name -eq 'TradeBot IA.exe' -and $_.ExecutablePath } | Select-Object -ExpandProperty ExecutablePath -Unique)) {
        Observe 'Executable Electron (pas la version de la page)' (File-Identity $p)
        $metadata = Join-Path (Split-Path $p -Parent) 'resources\app\package.json'
        if (Test-Path -LiteralPath $metadata -PathType Leaf) { Observe 'Metadata du conteneur Electron sur disque' (Get-Content -LiteralPath $metadata -Raw | ConvertFrom-Json) }
    }
    foreach ($path in @('desktop\main.cjs','desktop\package.json','.output\server\index.mjs','.output\public\index.html','.output\public\tradebot-build.json')) {
        Observe 'Fichier projet (disque, pas preuve de chargement)' (File-Identity (Join-Path $root $path))
    }
    $web = Get-Json 3088 '/api/runtime-version'
    Observe 'Serveur web compile observe' $web
    if ($null -ne $web -and (Value $web 'pid') -notin $owners) { throw 'PID du serveur HTTP non retrouve parmi les listeners; identite non confirmee.' }
    $manifest = Get-Json 3088 '/tradebot-build.json'
    Observe 'Manifeste frontend servi (pas preuve du cache Electron)' $manifest
    $page = Get-Local 3088 '/'
    $assetChecks = @()
    foreach ($asset in @(Value $manifest 'assets')) {
        if ($null -eq $asset) { continue }
        $file = [string](Value $asset 'file')
        if ($file -notmatch '^assets/[A-Za-z0-9_./-]+\.(js|css)$' -or $file -match '(^|/)\.\.(/|$)') { continue }
        # Inspect the actual entry assets referenced by the served HTML, not only a manifest label.
        if ($null -eq $page -or !$page.Content.Contains('/' + $file)) { continue }
        $temporary = Join-Path $directory ([Guid]::NewGuid().ToString('N') + '.asset')
        try {
            Invoke-WebRequest -Uri ('http://127.0.0.1:3088/' + $file) -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 12 -OutFile $temporary
            $actual = (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant()
            $assetChecks += [ordered]@{ file = $file; expected = Value $asset 'sha256'; actual = $actual; matches = ($actual -eq (Value $asset 'sha256')) }
        } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary } }
    }
    Observe 'Empreintes des entrees frontend effectivement servies' $assetChecks
    $frontendVerified = ($assetChecks.Count -gt 0 -and @($assetChecks | Where-Object { !$_.matches }).Count -eq 0 -and (Value $manifest 'release') -eq 'V92')
    $bridge = Get-Json 8765 '/diagnostics/mt5-ipc'
    Observe 'Passerelle chargee (aucune initialisation)' $bridge
    if ($null -eq $bridge) {
        $ftmo = Get-Json 8765 '/ftmo/state'
        Observe 'Identite de secours ancienne passerelle' (Value $ftmo 'runtimeBuild')
        Decision 'Endpoint diagnostic absent : version de passerelle non certifiee. Ne pas conclure V86 a partir du seul affichage.'
    }
    $python = Join-Path $root '.venv-mt5\Scripts\python.exe'
    if (Test-Path -LiteralPath $python -PathType Leaf) {
        # runtime_identity imports only standard-library modules; no MT5 initialization or tests.
        $hashText = & $python (Join-Path $PSScriptRoot 'runtime_identity.py')
        if ($LASTEXITCODE -ne 0) { throw 'Calcul de l empreinte locale impossible.' }
        $expected = ($hashText | Out-String | ConvertFrom-Json).sourceSha256
        Observe 'Empreinte attendue des sources passerelle de ce projet' $expected
        if ($null -ne $bridge -and (Value (Value $bridge 'runtime') 'loadedSha256') -ne $expected) { Decision 'Passerelle chargee differente du projet courant : une relance controlee peut etre necessaire, jamais automatique ici.' }
    } else { Decision 'Python .venv-mt5 absent : aucune installation ni reconnexion tentee.' }
    if (@($processes | Where-Object { $_.autostartDetected }).Count -gt 0) { Decision 'Autostart PAPER encore actif : il doit etre identifie et suspendu avec accord avant une relance. Aucun START ne sera envoye par cette procedure.' }
    Observe 'Bilan des identites' ([ordered]@{ expected = 'V92'; webCompiledRelease = Value $web 'release'; frontendAssetsVerified = $frontendVerified; bridgeRelease = Value $bridge 'release'; electronCacheVerified = $false; mt5ReconnectionAttempted = $false })
    Decision 'Le texte V86 etait code en dur dans le projet. Changer ce texte ne repare pas IPC -10005.'
    if ($Action -eq 'Prepare') {
        Decision 'Construction isolee uniquement : aucun .output actif, programme installe, registre PAPER ou historique ne sera remplace.'
        $confirmation = Read-Host 'Saisir PREPARER V92 pour construire la livraison sans redemarrer (autre reponse = annuler)'
        if ($confirmation -cne 'PREPARER V92') { throw 'Preparation annulee; aucun processus arrete.' }
        $node = (Get-Command node.exe -ErrorAction Stop).Source
        $vite = Join-Path $root 'node_modules\vite\bin\vite.js'
        if (!(Test-Path -LiteralPath $vite -PathType Leaf)) { throw 'Dependances absentes; aucune installation automatique.' }
        $stage = Join-Path $directory 'web-v92'
        $previous = $env:TRADEBOT_STAGE_DIR
        Push-Location $root
        try {
            $env:TRADEBOT_STAGE_DIR = $stage.Replace('\','/')
            & $node $vite build --outDir ($stage.Replace('\','/') + '/public') *> (Join-Path $directory 'build.log')
            if ($LASTEXITCODE -ne 0) { throw ('Construction echouee; consulter ' + (Join-Path $directory 'build.log')) }
        } finally {
            $env:TRADEBOT_STAGE_DIR = $previous
            Pop-Location
        }
        foreach ($file in @('server\index.mjs','public\index.html','public\tradebot-build.json')) {
            if (!(Test-Path -LiteralPath (Join-Path $stage $file) -PathType Leaf)) { throw ('Livraison incomplete : ' + $file + '. Aucun deploiement effectue.') }
        }
        $built = Get-Content -LiteralPath (Join-Path $stage 'public\tradebot-build.json') -Raw | ConvertFrom-Json
        if ($built.release -ne 'V92') { throw 'Version de livraison inattendue.' }
        Observe 'Livraison preparee NON DEPLOYEE' ([ordered]@{ directory = $stage; manifest = $built; server = File-Identity (Join-Path $stage 'server\index.mjs') })
        Decision 'Confirmation separee requise AVANT tout arret du serveur web, de la passerelle ou du conteneur Electron. MT5 ne doit pas etre redemarre.'
        Decision 'Avant deploiement : suspendre les lanceurs automatiques avec accord; arret gracieux de la passerelle; sauvegarde coherente de LOCALAPPDATA\TradeBotIA et du profil Electron. Ne pas copier une base SQLite active comme sauvegarde garantie.'
        Decision 'Ne pas utiliser lancer_tradebot_total.ps1 pour cette maintenance : il invoque autostart_paper.ps1. Aucun demarrage PAPER autorise avant validation fiable de la connexion.'
    } elseif ($Action -eq 'Verify') {
        if ((Read-Host 'Saisir VERIFIER IPC pour autoriser la lecture /status via la passerelle existante, sans reset ni START') -cne 'VERIFIER IPC') { throw 'Verification IPC annulee.' }
        & powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File (Join-Path $PSScriptRoot 'diagnostiquer_ipc_v91.ps1')
        $observedExit = $LASTEXITCODE
        Observe 'Verification reelle IPC et PAPER' ([ordered]@{ exitCode = $observedExit; meaning = '0 = connexion, ticks, valorisation et heartbeat controles; autre = non valide. Voir rapport V91.' })
        $exitCode = $observedExit
    }
    if ($Action -ne 'Verify') { $exitCode = 0 }
    Decision 'Aucun redemarrage, ordre, START, reset SAFE_STOP ou test de regression execute. Code 0 Audit/Prepare = procedure terminee, PAS connexion MT5 validee.'
} catch {
    $report.error = $_.Exception.Message
    Write-Host ('Maintenance interrompue : ' + $report.error)
} finally {
    $report.exitCode = $exitCode
    $path = Join-Path $directory 'rapport.json'
    $report | ConvertTo-Json -Depth 48 | Set-Content -LiteralPath $path -Encoding UTF8
    Write-Host ('Rapport local (masquer comptes, utilisateurs et chemins avant partage) : ' + $path)
}
exit $exitCode
