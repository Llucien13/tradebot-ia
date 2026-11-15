param([switch]$ObserverUTC, [switch]$SelfTest, [switch]$RestartBridgeIfStale)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$checks = [Collections.Generic.List[object]]::new()
$samples = [Collections.Generic.List[object]]::new()
$script:historicalEvidenceValid = $false
$report = [ordered]@{
    schemaVersion = 2
    startedUTC = [DateTime]::UtcNow.ToString('o')
    verdict = 'NON_PRET_CONTROLES_PARTIELS'
    mode = 'PAPER'
    liveEnabled = $false
    observerUTCRequested = [bool]$ObserverUTC
    checks = $checks
    samples = $samples
    remaining = @('Confirmation FTMO des frais et regle annuelle DST', 'Controle serveur complet avant toute autorisation START', 'Essais de panne/reprise NTFS en environnement de test isole', 'Limites de polling, minuit Europe/Prague, swaps et marge FTMO', 'Couverture complete du hash du rapport de verification')
}

function Has-Property($Object, [string]$Name) {
    if ($null -eq $Object) { return $false }
    if ($Object -is [Collections.IDictionary]) { return $Object.Contains($Name) }
    return ($null -ne $Object.PSObject.Properties[$Name])
}

function Value($Object, [string]$Name) {
    if (-not (Has-Property $Object $Name)) { return $null }
    if ($Object -is [Collections.IDictionary]) { return $Object[$Name] }
    return $Object.PSObject.Properties[$Name].Value
}

function Finite-Number($Number) {
    if ($null -eq $Number -or $Number -is [bool] -or $Number -is [string]) { return $false }
    try { return (-not [double]::IsNaN([double]$Number) -and -not [double]::IsInfinity([double]$Number)) }
    catch { return $false }
}

function Check([string]$Name, [ValidateSet('VERIFIE', 'BLOQUE', 'NON VERIFIABLE', 'COTATIONS INDISPONIBLES')][string]$Status, [string]$Detail) {
    $checks.Add([ordered]@{ name = $Name; status = $Status; detail = $Detail })
    Write-Host ('{0} : {1} — {2}' -f $Name, $Status, $Detail)
}

function Read-Checkpoint([string]$Path) {
    $before = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    $state = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    $after = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    if ($before -ne $after) { throw 'Registre modifie pendant la lecture : observation non certifiable.' }
    return [pscustomobject]@{ sha256 = $after; state = $state }
}

function Get-Local([string]$Route) {
    if ($Route -notin @('/ftmo/state', '/ftmo/clock-evidence', '/ftmo/feed')) { throw 'Route non autorisee dans ce diagnostic.' }
    # GET loopback only; never starts a process or calls an action endpoint.
    try {
        return Invoke-RestMethod -Uri ('http://127.0.0.1:8765' + $Route) -Method Get -MaximumRedirection 0 -TimeoutSec 25
    } catch {
        $originalMessage = $_.Exception.Message
        $response = Value $_.Exception 'Response'
        $apiDetail = $null
        $errorDetails = Value $_ 'ErrorDetails'
        if ($null -ne (Value $errorDetails 'Message')) {
            try { $apiDetail = Value ((Value $errorDetails 'Message') | ConvertFrom-Json -ErrorAction Stop) 'detail' } catch { }
        }
        if ($null -ne $response -and $null -eq $apiDetail) {
            try {
                $reader = [IO.StreamReader]::new($response.GetResponseStream())
                $body = $reader.ReadToEnd()
                $reader.Dispose()
                $payload = $body | ConvertFrom-Json -ErrorAction Stop
                if (Has-Property $payload 'detail') { $apiDetail = [string](Value $payload 'detail') }
            } catch { }
        }
        if ($apiDetail) { throw $apiDetail }
        throw $originalMessage
    }
}

function Ensure-CurrentBridge($Snapshot, [string]$Python) {
    $identityJSON = & $Python (Join-Path $PSScriptRoot 'runtime_identity.py')
    if ($LASTEXITCODE -ne 0) { throw 'Empreinte locale du moteur non calculable.' }
    $expected = Value (($identityJSON | Out-String) | ConvertFrom-Json) 'sourceSha256'
    if ([string]::IsNullOrWhiteSpace([string]$expected)) { throw 'Empreinte locale absente.' }
    $build = Value $Snapshot 'runtimeBuild'
    if ((Value $build 'sourceSha256') -eq $expected -and (Value $build 'diskSha256') -eq $expected) {
        Check 'Sources Python chargees' 'VERIFIE' 'Empreinte de demarrage = fichiers locaux actuels.'
        return $Snapshot
    }
    Check 'Sources Python chargees' 'BLOQUE' 'Passerelle ancienne ou sources modifiees depuis son demarrage.'
    if (-not $RestartBridgeIfStale) { throw 'Redemarrage controle requis; aucun processus arrete automatiquement.' }
    Guard-State $Snapshot
    $worker = Check-Worker $Snapshot ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0)
    if (-not $worker.verifiable) { throw 'Redemarrage refuse : worker/heartbeat non verifiable.' }
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 8765 | Where-Object { $_.LocalAddress -in @('127.0.0.1', '::1') })
    if ($listeners.Count -ne 1) { throw 'Proprietaire unique du port 8765 non demontre; aucun processus arrete.' }
    $ownerId = $listeners[0].OwningProcess
    $process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $ownerId)
    $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwner
    $expectedOwner = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $bridgeFile = Join-Path $PSScriptRoot 'bridge.py'
    $entryPattern = '(?:^|[\s"])(?:' + [regex]::Escape($bridgeFile) + '|src[\\/]mt5_bridge[\\/]bridge\.py)(?:[\s"]|$)'
    if ($owner.ReturnValue -ne 0 -or ($owner.Domain + '\' + $owner.User) -ine $expectedOwner -or -not [string]::Equals([string]$process.ExecutablePath, $Python, [StringComparison]::OrdinalIgnoreCase) -or $process.CommandLine -notmatch $entryPattern) {
        throw 'Identite du processus Python/chemin/proprietaire non demontree; aucun processus arrete.'
    }
    if ((Read-Host 'Passerelle seule arretee, aucune position ni bot actif. Taper REDEMARRER pour charger les fichiers actuels') -cne 'REDEMARRER') { throw 'Redemarrage non confirme.' }
    $lastState = Get-Local '/ftmo/state'
    Guard-State $lastState
    if ($null -ne (Value $lastState 'storageFault') -or (Value $lastState 'verifying') -ne $false) { throw 'Panne stockage ou verification en cours : redemarrage refuse.' }
    $lastWorker = Check-Worker $lastState ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0)
    if (-not $lastWorker.verifiable) { throw 'Worker modifie avant arret; redemarrage refuse.' }
    $currentListener = @(Get-NetTCPConnection -State Listen -LocalPort 8765)
    if ($currentListener.Count -ne 1 -or $currentListener[0].OwningProcess -ne $ownerId) { throw 'Proprietaire du port modifie; arret refuse.' }
    $sameProcess = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $ownerId)
    if ($sameProcess.CreationDate -ne $process.CreationDate -or $sameProcess.CommandLine -ne $process.CommandLine) { throw 'Identite du processus modifiee; arret refuse.' }
    Stop-Process -Id $ownerId -ErrorAction Stop
    Wait-Process -Id $ownerId -Timeout 10 -ErrorAction SilentlyContinue
    if (Get-Process -Id $ownerId -ErrorAction SilentlyContinue) { throw 'Ancienne passerelle toujours active; aucun second processus lance.' }
    $started = Start-Process -FilePath $Python -ArgumentList @('"' + $bridgeFile + '"') -WorkingDirectory $root -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        Start-Sleep -Seconds 1
        try {
            $fresh = Get-Local '/ftmo/state'
            $freshBuild = Value $fresh 'runtimeBuild'
            if ((Value $freshBuild 'pid') -eq $started.Id -and (Value $freshBuild 'sourceSha256') -eq $expected -and (Value $freshBuild 'diskSha256') -eq $expected) {
                Guard-State $fresh
                Check 'Passerelle rechargee' 'VERIFIE' 'Nouveau PID attendu, sources actuelles; PAPER arrete, aucun START.'
                return $fresh
            }
        } catch { }
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'Nouvelle passerelle non validee dans les 30 s; aucun bot lance, verifier sa sortie.'
}

function Guard-State($Snapshot) {
    $state = Value $Snapshot 'state'
    if (-not (Has-Property $Snapshot 'state')) { throw 'NON VERIFIABLE : objet state absent de la reponse runtime.' }
    if (-not (Has-Property $state 'mode')) { throw 'NON VERIFIABLE : state.mode absent.' }
    if ((Value $state 'mode') -cne 'PAPER') { throw 'Etat non securise : PAPER exclusivement requis.' }
    if (-not (Has-Property $state 'liveEnabled')) { throw 'NON VERIFIABLE : state.liveEnabled absent.' }
    if ((Value $state 'liveEnabled') -isnot [bool] -or (Value $state 'liveEnabled') -ne $false) { throw 'Etat non securise : LIVE doit rester desactive, booleen false requis.' }
    if (-not (Has-Property $state 'running')) { throw 'NON VERIFIABLE : state.running absent.' }
    if ((Value $state 'running') -isnot [bool] -or (Value $state 'running') -ne $false) { throw 'Etat non securise : running doit etre le booleen false.' }
    if (-not (Has-Property $state 'position')) { throw 'NON VERIFIABLE : state.position absent.' }
    if ($null -ne (Value $state 'position')) { throw 'Position PAPER presente : collecte distante interrompue pour la conserver sans valorisation ni cloture.' }
    if (-not (Has-Property $Snapshot 'verifying')) { Check 'Etat verification en cours' 'NON VERIFIABLE' 'Propriete verifying absente du schema runtime.' }
    elseif ((Value $Snapshot 'verifying') -ne $false) { throw 'Verification en cours ou etat verifying incompatible.' }
    if (-not (Has-Property $Snapshot 'verification')) { Check 'Rapport moteur' 'NON VERIFIABLE' 'Objet verification absent du snapshot.' }
    elseif ((Value (Value $Snapshot 'verification') 'status') -eq 'PASSED' -and $script:historicalEvidenceValid) { Check 'Rapport moteur' 'VERIFIE' 'Rapport historique corrobore avec empreintes et resultats archives; couverture legacy limitee, aucune autorisation START.' }
    else { Check 'Rapport moteur' 'BLOQUE' ('verification.status=' + (Value (Value $Snapshot 'verification') 'status') + ' ; preuve historique absente/incomplete ou statut invalide; aucun VERIFY/backtest appele.') }
    if ((Value $state 'tpR') -ne 2.5) { throw 'tpR runtime different de 2.5 : collecte interrompue.' }
    if ((Value $state 'status') -notin @('PHASE_1', 'PHASE_2')) { throw 'Challenge runtime termine ou statut inconnu.' }
}

function Ledger-Fingerprint($State) {
    $financial = [ordered]@{}
    foreach ($key in @('mode', 'liveEnabled', 'tpR', 'phase', 'status', 'balance', 'equity', 'day', 'dayBase', 'position', 'trades', 'cashEvents', 'phases', 'curve', 'lastSignal', 'lastObserved', 'commissionUSD', 'slippageUSD', 'swapLongUSD', 'swapShortUSD', 'swapHourUTC')) {
        $financial[$key] = Value $State $key
    }
    return ($financial | ConvertTo-Json -Depth 100 -Compress)
}

function Safe-StateSummary($State) {
    $position = Value $State 'position'
    return [ordered]@{
        mode = Value $State 'mode'; liveEnabled = Value $State 'liveEnabled'; running = Value $State 'running'
        challengeStatus = Value $State 'status'; workerStatus = 'NON VERIFIABLE - aucun champ worker dans state.status'
        tpR = Value $State 'tpR'; phase = Value $State 'phase'
        balance = Value $State 'balance'; equity = Value $State 'equity'; dayBase = Value $State 'dayBase'; day = Value $State 'day'
        positionOpen = ($null -ne $position)
        positionHasTimeBasis = ($null -ne $position -and $null -ne (Value $position 'timeBasis'))
        trades = if ($null -ne (Value $State 'trades')) { @($State.trades).Count } else { $null }
        cashEvents = if ($null -ne (Value $State 'cashEvents')) { @($State.cashEvents).Count } else { $null }
        phases = if ($null -ne (Value $State 'phases')) { @($State.phases).Count } else { $null }
        lastSignal = Value $State 'lastSignal'; lastObserved = Value $State 'lastObserved'
        commissionUSD = Value $State 'commissionUSD'; slippageUSD = Value $State 'slippageUSD'
        swapLongUSD = Value $State 'swapLongUSD'; swapShortUSD = Value $State 'swapShortUSD'; swapHourUTC = Value $State 'swapHourUTC'
    }
}

function Check-Worker($Snapshot, [double]$Now) {
    $worker = Value $Snapshot 'worker'
    if ($null -eq $worker) {
        Check 'Statut du worker' 'NON VERIFIABLE' 'GET /ftmo/state ne fournit aucun objet worker. state.status est seulement PHASE_1/PHASE_2/FAILED/SUCCEEDED.'
        Check 'Heartbeat du worker' 'NON VERIFIABLE' 'Aucun heartbeat runtime expose ; aucune valeur n est deduite de state.running.'
        return [ordered]@{ status = $null; alive = $null; heartbeatAgeSeconds = $null; verifiable = $false }
    }
    $workerStatus = Value $worker 'status'
    if ($null -eq $workerStatus) { Check 'Statut du worker' 'NON VERIFIABLE' 'worker.status absent.' }
    elseif ($workerStatus -eq 'STOPPED') { Check 'Statut du worker' 'VERIFIE' 'Valeur issue de la telemetrie worker runtime.' }
    else { Check 'Statut du worker' 'BLOQUE' ('worker.status=' + $workerStatus + ', STOPPED attendu pour cette observation.') }
    $alive = Value $worker 'alive'
    if ($null -eq $alive) { Check 'Thread worker' 'NON VERIFIABLE' 'worker.alive absent.' }
    elseif ($alive -ne $true) { Check 'Thread worker' 'BLOQUE' 'Thread absent ou arrete.' }
    $heartbeat = Value $worker 'heartbeat'
    if (-not (Finite-Number $heartbeat)) {
        Check 'Heartbeat du worker' 'NON VERIFIABLE' 'worker.heartbeat absent, nul ou non numerique fini.'
        $age = $null
    } else {
        $age = $Now - [double]$heartbeat
        if ($age -lt 0 -or $age -gt 15) { Check 'Heartbeat du worker' 'BLOQUE' ('Heartbeat futur/ancien : age=' + [math]::Round($age, 3) + ' s.') }
        else { Check 'Heartbeat du worker' 'VERIFIE' ('Age=' + [math]::Round($age, 3) + ' s.') }
    }
    $verifiable = ($workerStatus -eq 'STOPPED' -and $alive -is [bool] -and $alive -eq $true -and $null -ne $age -and $age -ge 0 -and $age -le 15)
    return [ordered]@{ status = $workerStatus; alive = $alive; heartbeatAgeSeconds = $age; verifiable = $verifiable }
}

function Test-QuoteUnavailable($Clock) {
    if ((Value $Clock 'quotesStatus') -eq 'UNAVAILABLE') { return $true }
    $conclusion = [string](Value $Clock 'conclusion')
    $probeError = [string](Value $Clock 'nativeProbeError')
    if ($conclusion -match 'Tick .*ancien ou futur apres normalisation|tick .*indisponible|Cotation .*indisponible|BID/ASK.*indisponible' -or $probeError -match 'tick indisponible') { return $true }
    foreach ($sample in (Value $Clock 'samples')) {
        foreach ($tick in (Value $sample 'ticks')) {
            if (Value $tick 'error') { return $true }
        }
    }
    return $false
}

function Test-NativeProof($Clock, [double]$Now, [string]$ExpectedServer, [string]$ExpectedLogin) {
    $native = Value $Clock 'nativeProbe'
    $normalization = Value $Clock 'normalization'
    $tests = Value $Clock 'tests'
    if (Test-QuoteUnavailable $Clock) {
        return [pscustomobject]@{ status = 'COTATIONS INDISPONIBLES'; detail = 'Capture croisee sans ticks utilisables; seuil de fraicheur de 15 s inchange.' }
    }
    $probeError = [string](Value $Clock 'nativeProbeError')
    if ($probeError -match 'expire|ancien|futur|> 120') {
        return [pscustomobject]@{ status = 'BLOQUE'; detail = ('Preuve native expiree ou hors fenetre: ' + $probeError) }
    }
    if ((Value $Clock 'mode') -cne 'PAPER' -or (Value $Clock 'liveEnabled') -isnot [bool] -or (Value $Clock 'liveEnabled') -ne $false -or (Value $Clock 'ordersSent') -isnot [bool] -or (Value $Clock 'ordersSent') -ne $false -or (Value $Clock 'accountType') -ne 'DEMO') {
        return [pscustomobject]@{ status = 'BLOQUE'; detail = 'Reponse clock-evidence ne confirme pas PAPER/LIVE OFF/DEMO/aucun ordre.' }
    }
    if ($null -eq $native -or $null -eq $normalization -or $null -eq $tests -or (Value $tests 'passed') -ne $true -or (Value $Clock 'nativeProofStatus') -ne 'VERIFIED') {
        return [pscustomobject]@{ status = 'NON VERIFIABLE'; detail = ('Preuve non validee par Python : nativeProbe/normalization/nativeProofStatus/tests requis. ' + $probeError) }
    }
    if ((Value $native 'schemaVersion') -ne 2 -or (Value $native 'tester') -isnot [bool] -or (Value $native 'tester') -ne $false) {
        return [pscustomobject]@{ status = 'BLOQUE'; detail = 'Preuve native v2/hors Strategy Tester requise.' }
    }
    if ((Value $native 'server') -ne $ExpectedServer -or [string](Value $native 'login') -ne $ExpectedLogin) {
        return [pscustomobject]@{ status = 'BLOQUE'; detail = 'Identite serveur/login de la preuve differente de la session MT5.' }
    }
    $gmtValue = Value $native 'timeGMT'
    $expiryValue = Value $normalization 'validUntilUTC'
    $encoding = Value $normalization 'encoding'
    if (-not (Finite-Number $gmtValue) -or $null -eq $expiryValue -or $encoding -notin @('UTC', 'SERVER_WALL')) {
        return [pscustomobject]@{ status = 'NON VERIFIABLE'; detail = 'timeGMT fini, validUntilUTC ou convention manque.' }
    }
    try {
        $gmt = [double]$gmtValue
        $expiry = [DateTimeOffset]::Parse([string]$expiryValue).ToUnixTimeMilliseconds() / 1000.0
    } catch {
        return [pscustomobject]@{ status = 'BLOQUE'; detail = 'timeGMT ou echeance non parseable.' }
    }
    $age = $Now - $gmt
    if ($age -lt 0 -or $age -gt 120) {
        return [pscustomobject]@{ status = 'BLOQUE'; detail = ('Preuve future/perimee, age=' + [math]::Round($age, 3) + ' s ; maximum 120 s.') }
    }
    if ([math]::Abs($expiry - ($gmt + 120)) -gt 1 -or $Now -gt $expiry) {
        return [pscustomobject]@{ status = 'BLOQUE'; detail = 'Echeance UTC invalide ou deja expiree.' }
    }
    if ($encoding -eq 'SERVER_WALL') {
        $serverClock = Value $normalization 'serverClock'
        $confirmedWindow = Value $serverClock 'confirmedWindow'
        if ($null -ne $confirmedWindow) {
            if (@($confirmedWindow).Count -ne 2 -or $gmt -lt $confirmedWindow[0] -or $gmt -ge $confirmedWindow[1] -or -not (Finite-Number (Value $native 'timeTradeServer')) -or [math]::Abs((Value $native 'timeTradeServer') - $gmt - 7200) -gt 2 -or (Value $serverClock 'name') -cne 'FTMO_GMT_PLUS_2_CONFIRMED_2026') {
                return [pscustomobject]@{ status = 'BLOQUE'; detail = 'Fenetre GMT+2 FTMO confirmee absente, expiree ou contradictoire.' }
            }
            return [pscustomobject]@{ status = 'VERIFIE'; detail = 'Python a verifie les mesures et le GMT+2 officiel dans sa fenetre confirmee; aucune regle annuelle inventee.' }
        }
        $policy = Value $native 'confirmedPolicy'
        if ((Value $policy 'confirmed') -ne $true -or [string]::IsNullOrWhiteSpace([string](Value $policy 'ianaZone')) -or [string]::IsNullOrWhiteSpace([string](Value $policy 'source'))) {
            return [pscustomobject]@{ status = 'BLOQUE'; detail = 'Regle annuelle DST/IANA non confirmee par preuve.' }
        }
        # Python zoneinfo validates the actual IANA rule and native clocks.
        # Windows PowerShell 5.1 must not substitute a Windows zone or fixed offset.
        if ((Value $Clock 'nativeProofStatus') -ne 'VERIFIED' -or (Value $policy 'ianaZone') -ne (Value $normalization 'ianaZone')) {
            return [pscustomobject]@{ status = 'NON VERIFIABLE'; detail = 'Validation IANA par le backend absente ou fuseau de la preuve different.' }
        }
        if (-not (Finite-Number (Value $native 'timeTradeServer'))) {
            return [pscustomobject]@{ status = 'NON VERIFIABLE'; detail = 'timeTradeServer absent/invalide.' }
        }
    }
    return [pscustomobject]@{ status = 'VERIFIE'; detail = ('Preuve native v2 coherente, age=' + [math]::Round($age, 3) + ' s, convention=' + $encoding + '; aucun offset infere.') }
}

function Safe-FeedSummary($Snapshot, $Clock, [double]$Now) {
    $feed = Value $Snapshot 'feed'
    $clockProof = Value $Clock 'nativeProbe'
    $normalization = Value $Clock 'normalization'
    $feedBasis = Value $feed 'timeBasis'
    $accountMatches = $false
    if ($null -ne $feedBasis -and $null -ne $clockProof -and (Has-Property $feedBasis 'login') -and (Has-Property $feedBasis 'server')) {
        $accountMatches = ([string](Value $feedBasis 'login') -eq [string](Value $clockProof 'login') -and (Value $feedBasis 'server') -eq (Value $Clock 'server'))
    }
    $goldTime = Value $feed 'time'
    $fxTime = Value $feed 'fxTime'
    $goldAge = if (Finite-Number $goldTime) { $Now - [double]$goldTime } else { $null }
    $fxAge = if (Finite-Number $fxTime) { $Now - [double]$fxTime } else { $null }
    $return = [ordered]@{
        connected = Value $Snapshot 'connected'
        symbol = Value $feed 'symbol'; accountType = Value $feed 'accountType'
        serverPrefixIsFTMODemo = ((Value $feed 'server') -match '^FTMO-Demo')
        timeBasisEncoding = Value $feedBasis 'encoding'; timeBasisZone = Value $feedBasis 'zone'
        nativeEncoding = Value $normalization 'encoding'; nativeZone = Value $normalization 'ianaZone'
        accountMatches = $accountMatches
        nativeProofUTC = $null
        proofValidUntilUTC = Value $normalization 'validUntilUTC'
        goldTickAgeSeconds = $goldAge
        fxTickAgeSeconds = $fxAge
        barCounts = Value $feed 'bars'
        clockTestsPassed = Value (Value $Clock 'tests') 'passed'
        clockTestCount = Value (Value $Clock 'tests') 'tests'
        storageFaultPresent = if (Has-Property $Snapshot 'storageFault') { $null -ne (Value $Snapshot 'storageFault') } else { $null }
        positionOpen = ($null -ne (Value (Value $Snapshot 'state') 'position'))
        verificationStatus = Value (Value $Snapshot 'verification') 'status'
        dailyAvailableEURAtObservation = Value (Value $Snapshot 'limits') 'dailyAvailable'
        totalAvailableEURAtObservation = Value (Value $Snapshot 'limits') 'totalAvailable'
    }
    if ($null -ne (Value $clockProof 'timeGMT')) {
        $return.nativeProofUTC = [DateTimeOffset]::FromUnixTimeSeconds([long](Value $clockProof 'timeGMT')).UtcDateTime.ToString('o')
    }
    return $return
}

if ($SelfTest) {
    $fixture = [pscustomobject]@{ state = [pscustomobject]@{ mode = 'PAPER'; liveEnabled = $false; running = $false; status = 'PHASE_1'; tpR = 2.5; position = $null }; verifying = $false }
    Guard-State $fixture
    if ((Value $fixture.state 'status') -ne 'PHASE_1') { throw 'Fixture invalide.' }
    $workerResult = Check-Worker $fixture ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0)
    if ($workerResult.verifiable -or $workerResult.status -ne $null) { throw 'Worker manquant accepte comme verifiable.' }

    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0
    $validProof = [pscustomobject]@{
        mode = 'PAPER'; liveEnabled = $false; ordersSent = $false; server = 'FTMO-Demo'; accountType = 'DEMO'; accountLogin = '12345'; nativeProofStatus = 'VERIFIED'
        nativeProbe = [pscustomobject]@{ schemaVersion = 2; tester = $false; server = 'FTMO-Demo'; login = 12345; timeGMT = $now; confirmedPolicy = [pscustomobject]@{ confirmed = $true; ianaZone = 'Europe/Helsinki'; source = 'synthetic self-test only' } }
        normalization = [pscustomobject]@{ encoding = 'UTC'; validUntilUTC = [DateTimeOffset]::FromUnixTimeSeconds([long]($now + 120)).UtcDateTime.ToString('o') }
        tests = [pscustomobject]@{ passed = $true }
    }
    $utcCheck = Test-NativeProof $validProof $now 'FTMO-Demo' '12345'
    if ($utcCheck.status -ne 'VERIFIE') { throw ('Fresh synthetic proof rejected: ' + $utcCheck.detail) }
    $expired = Test-NativeProof $validProof ($now + 121) 'FTMO-Demo' '12345'
    if ($expired.status -ne 'BLOQUE') { throw 'Expired native proof accepted.' }
    $wrongAccount = Test-NativeProof $validProof $now 'FTMO-Demo' '99999'
    if ($wrongAccount.status -ne 'BLOQUE') { throw 'Mismatched native account accepted.' }
    $missingUtc = [pscustomobject]@{ mode = 'PAPER'; liveEnabled = $false; ordersSent = $false; accountType = 'DEMO'; normalization = $null; nativeProbe = $null; tests = [pscustomobject]@{ passed = $false } }
    $missingCheck = Test-NativeProof $missingUtc $now 'FTMO-Demo' '12345'
    if ($missingCheck.status -ne 'NON VERIFIABLE') { throw 'Missing native proof accepted.' }
    $closedMarket = [pscustomobject]@{ quotesStatus = 'UNAVAILABLE'; conclusion = 'Tick XAUUSD ancien ou futur apres normalisation'; nativeProbeError = $null }
    if (-not (Test-QuoteUnavailable $closedMarket)) { throw 'Closed market was not classified as unavailable quotes.' }
    if ((Value ([ordered]@{ status = 'STOPPED' }) 'status') -ne 'STOPPED') { throw 'OrderedDictionary key lost.' }
    $freshWorker = [pscustomobject]@{ worker = [pscustomobject]@{ status = 'STOPPED'; alive = $true; heartbeat = $now } }
    if (-not (Check-Worker $freshWorker $now).verifiable) { throw 'Real-shape worker fixture rejected.' }
    if ((Check-Worker $freshWorker ($now + 15.001)).verifiable) { throw 'Stale heartbeat accepted.' }
    $future = Test-NativeProof $validProof ($now - 1) 'FTMO-Demo' '12345'
    if ($future.status -ne 'BLOQUE') { throw 'Future proof accepted.' }
    Write-Host 'SELFTEST PASS : 10 scenarios synthetiques (phase, worker absent/present/perime, preuve fraiche/expiree/future/autre compte/absente, cotations indisponibles) et lecture dictionnaire controles. Verdict global NON PRET.'
    exit 0
}

$exitCode = 0
try {
    if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA absent : identite Windows et chemin du registre a confirmer.' }
    $directory = Join-Path $env:LOCALAPPDATA 'TradeBotIA\ftmo20k'
    $checkpoint = Join-Path $directory 'challenge.json'
    $report['storagePath'] = $checkpoint
    # Never create a challenge if the expected checkpoint does not exist.
    $disk = Read-Checkpoint $checkpoint
    $report['checkpointBeforeSHA256'] = $disk.sha256
    $s = $disk.state
    $report['checkpointSummary'] = Safe-StateSummary $s
    if (-not (Has-Property $s 'mode') -or -not (Has-Property $s 'liveEnabled') -or -not (Has-Property $s 'running')) {
        Check 'Mode PAPER / LIVE OFF / running' 'NON VERIFIABLE' 'Une ou plusieurs proprietes mode/liveEnabled/running manquent au checkpoint.'
        throw 'Etat PAPER NON VERIFIABLE.'
    }
    if ((Value $s 'mode') -cne 'PAPER' -or (Value $s 'liveEnabled') -isnot [bool] -or (Value $s 'liveEnabled') -ne $false -or (Value $s 'running') -isnot [bool] -or (Value $s 'running') -ne $false) { Check 'Mode PAPER / LIVE OFF / running' 'BLOQUE' 'PAPER et booleens liveEnabled=false/running=false requis.'; throw 'Collecte distante refusee.' }
    Check 'Mode PAPER / LIVE OFF / running=false sur disque' 'VERIFIE' 'Valeurs lues sans modification.'
    if (-not (Has-Property $s 'status')) { Check 'Statut du challenge' 'NON VERIFIABLE' 'state.status absent.' }
    elseif ((Value $s 'status') -in @('PHASE_1', 'PHASE_2', 'FAILED', 'SUCCEEDED')) { Check 'Statut du challenge' 'VERIFIE' ('state.status=' + (Value $s 'status') + ' ; statut du challenge uniquement.') }
    else { Check 'Statut du challenge' 'NON VERIFIABLE' 'Valeur de challenge inconnue; pas un statut worker.' }
    if (-not (Has-Property $s 'tpR')) { Check 'tpR effectif dans le registre' 'NON VERIFIABLE' 'Propriete tpR absente.'; throw 'tpR NON VERIFIABLE.' }
    if ((Value $s 'tpR') -eq 2.5) { Check 'tpR effectif dans le registre' 'VERIFIE' 'Valeur lue, aucune strategie modifiee.' }
    else { Check 'tpR effectif dans le registre' 'BLOQUE' 'La valeur n est pas 2.5.'; throw 'tpR du registre incompatible.' }
    foreach ($cost in @('commissionUSD', 'slippageUSD')) {
        if (-not (Finite-Number (Value $s $cost))) { Check ('Cout configure ' + $cost) 'BLOQUE' 'Valeur absente/non finie; aucun cout de remplacement applique.' }
        elseif ((Value $s $cost) -lt 0) { Check ('Cout configure ' + $cost) 'BLOQUE' 'Valeur hors limites.' }
        else { Check ('Cout configure ' + $cost) 'VERIFIE' 'Valeur sauvegardee presente; confirmation tarifaire FTMO distincte encore requise.' }
    }
    if (-not (Has-Property $s 'position')) { Check 'Position ouverte' 'NON VERIFIABLE' 'Propriete position absente.'; throw 'Etat position NON VERIFIABLE.' }
    if ($null -eq (Value $s 'position')) { Check 'Position ouverte' 'VERIFIE' 'Aucune position dans le checkpoint.' }
    else { Check 'Position ouverte' 'BLOQUE' 'Position preservee ; le diagnostic ne demande ni flux ni cloture.'; throw 'Position PAPER existante : collecte distante refusee pour la conserver sans interaction.' }
    if (-not (Finite-Number (Value $s 'equity')) -or -not (Finite-Number (Value $s 'dayBase'))) { Check 'Limites FTMO sur dernier checkpoint' 'NON VERIFIABLE' 'equity ou dayBase absent/non fini.'; throw 'Limites FTMO NON VERIFIABLE.' }
    $report['limitsAtSavedValuationOnly'] = [ordered]@{ dailyAvailableEUR = [math]::Round(([double](Value $s 'equity') - ([double](Value $s 'dayBase') - 1000)), 2); totalAvailableEUR = [math]::Round(([double](Value $s 'equity') - 18000), 2); currentMarketValidated = $false }
    if ((Value $s 'status') -notin @('PHASE_1', 'PHASE_2')) { Check 'Challenge actif' 'BLOQUE' 'Challenge termine ou statut inconnu : aucun demarrage possible.' }
    if ($report.limitsAtSavedValuationOnly.dailyAvailableEUR -le 0 -or $report.limitsAtSavedValuationOnly.totalAvailableEUR -le 0) { Check 'Limites FTMO sauvegardees' 'BLOQUE' 'Marge quotidienne/totale non positive.' }
    else { Check 'Limites FTMO sauvegardees' 'VERIFIE' 'Seuil quotidien dayBase-1000 EUR et plancher fixe 18000 EUR; valeurs sauvegardees uniquement.' }
    $python = Join-Path $root '.venv-mt5\Scripts\python.exe'
    if (Test-Path -LiteralPath $python) {
        $evidenceJSON = & $python (Join-Path $PSScriptRoot 'historical_evidence.py')
        if ($LASTEXITCODE -ne 0) { throw 'Controle integrite Python en echec; aucun resultat positif suppose.' }
        $evidence = ($evidenceJSON | Out-String) | ConvertFrom-Json
        $report['historicalEvidence'] = $evidence
        if ((Value $evidence 'historicalIntegrity') -eq 'MATCHES_LOCAL_ARCHIVE') { Check 'Integrite historique' 'VERIFIE' 'Huit fichiers JSON/transactions identiques a l archive locale; provenance externe non certifiee.' }
        else { Check 'Integrite historique' 'NON VERIFIABLE' ((Value $evidence 'errors') -join '; ') }
        if ((Value $evidence 'engineReportExists') -eq $false) { Check 'Cause NOT_RUN' 'BLOQUE' (Value $evidence 'notRunExplanation') }
        if (@(Value $evidence 'archiveSearchErrors').Count -gt 0) { Check 'Recherche rapports archives' 'NON VERIFIABLE' ((Value $evidence 'archiveSearchErrors') -join '; ') }
        foreach ($candidate in (Value $evidence 'archivedReports')) { Check 'Rapport archive examine sans import' 'NON VERIFIABLE' ((Value $candidate 'source') + ' : ' + (Value $candidate 'verificationEvidence') + ' ; ' + ((Value $candidate 'errors') -join '; ')) }
        $script:historicalEvidenceValid = ((Value $evidence 'historicalIntegrity') -eq 'MATCHES_LOCAL_ARCHIVE' -and (Value $evidence 'verificationEvidence') -eq 'CORROBORATED_LEGACY_REPORT')
        if ($script:historicalEvidenceValid) { Check 'Preuves du rapport historique' 'VERIFIE' 'Rapport existant corrobore, empreintes legacy coherentes; aucun rapport cree ni importe.' }
        else { Check 'Preuves du rapport historique' 'BLOQUE' ('NOT_RUN reste bloque si rapport absent. ' + ((Value $evidence 'verificationErrors') -join '; ')) }
    } else { Check 'Integrite et rapport historiques' 'NON VERIFIABLE' 'Python .venv-mt5 absent; aucun interpreteur de remplacement lance.' }
    $verification = Join-Path $directory 'verification.json'
    if (Test-Path -LiteralPath $verification) {
        $existingVerification = Get-Content -LiteralPath $verification -Raw -Encoding UTF8 | ConvertFrom-Json
        $report['verificationSummary'] = [ordered]@{ status = Value $existingVerification 'status'; implementationHash = Value $existingVerification 'implementationHash'; unitTests = Value $existingVerification 'unitTests'; unitPassed = Value $existingVerification 'unitPassed'; completedAt = Value $existingVerification 'completedAt' }
    } else { $report['verificationSummary'] = 'ABSENT - ne pas regenerer via un backtest' }
    if (-not (Has-Property $s 'status')) { Check 'Statut du challenge' 'NON VERIFIABLE' 'state.status absent.' }
    elseif ((Value $s 'status') -in @('PHASE_1', 'PHASE_2', 'FAILED', 'SUCCEEDED')) { Check 'Statut du challenge' 'VERIFIE' ('state.status=' + (Value $s 'status') + ' ; statut du challenge uniquement, jamais worker STOPPED.') }
    else { Check 'Statut du challenge' 'NON VERIFIABLE' 'Valeur challenge inconnue; pas un statut worker.' }
    try {
        $report['windowsClockQuery'] = (& w32tm.exe /query /status 2>&1 | Out-String)
        $report['windowsClockQueryExitCode'] = $LASTEXITCODE
        if ($LASTEXITCODE -ne 0) { Check 'Horloge Windows' 'NON VERIFIABLE' 'w32tm /query a echoue.' }
        else { Check 'Horloge Windows' 'VERIFIE' 'Etat w32tm collecte ; la synchronisation de l horloge MT5/UTC reste a confirmer.' }
    } catch {
        $report['windowsClockQuery'] = $_.Exception.Message
        $report['windowsClockQueryExitCode'] = 1
        Check 'Horloge Windows' 'NON VERIFIABLE' 'w32tm indisponible.'
    }
    $report['windowsTimezone'] = (Get-TimeZone | Select-Object Id, DisplayName)
    $report['sourceHashes'] = @(foreach ($relative in @('src\ftmo\core.py', 'src\ftmo\frozen.py', 'src\ftmo\verify.py', 'src\mt5_bridge\ftmo_service.py', 'src\mt5_bridge\paper_storage.py', 'src\mt5_bridge\time_basis.py', 'src\mt5_bridge\quote_time.py', 'src\mt5_bridge\TradeBotClockProbe.mq5', 'src\mt5_bridge\TradeBotClockProbe.ex5')) {
        Get-FileHash -LiteralPath (Join-Path $root $relative) -Algorithm SHA256 | Select-Object Path, Hash
    })
    if (-not $ObserverUTC) {
        Check 'Statut du worker' 'NON VERIFIABLE' 'Mode local seul : GET /ftmo/state ne fournit pas worker et state.status est PHASE_1/PHASE_2, pas STOPPED.'
        Check 'Heartbeat du worker' 'NON VERIFIABLE' 'Aucun heartbeat runtime collecte en mode local.'
        Check 'Preuve UTC native et renouvellement' 'NON VERIFIABLE' 'Aucune observation MT5/natif demandee en mode local.'
    }
    if ($ObserverUTC) {
        $initial = Get-Local '/ftmo/state'
        if (-not (Test-Path -LiteralPath $python)) { throw 'Python .venv-mt5 absent; version active non verifiable.' }
        $initial = Ensure-CurrentBridge $initial $python
        Guard-State $initial
        $report['runtimeBuild'] = Value $initial 'runtimeBuild'
        $runtimeStorage = Value $initial 'storage'
        if ($null -eq $runtimeStorage) {
            Check 'Chemin du registre runtime' 'NON VERIFIABLE' 'GET /ftmo/state ne fournit pas storage.'
            throw 'Chemin du registre runtime NON VERIFIABLE.'
        }
        $runtimeStoragePath = [IO.Path]::GetFullPath([string]$runtimeStorage)
        $checkpointPath = [IO.Path]::GetFullPath($checkpoint)
        if (-not [string]::Equals($runtimeStoragePath, $checkpointPath, [StringComparison]::OrdinalIgnoreCase)) {
            Check 'Chemin du registre runtime' 'BLOQUE' 'Le chemin runtime differe du challenge.json lu ; aucune autre lecture de registre.'
            throw 'Chemin runtime du registre inattendu.'
        }
        Check 'Chemin du registre runtime' 'VERIFIE' 'Le chemin API correspond au challenge.json inspecte en lecture seule.'
        $initialLedger = Ledger-Fingerprint (Value $initial 'state')
        if ($initialLedger -ne (Ledger-Fingerprint $s)) { throw 'Registre runtime different du checkpoint disque : collecte interrompue.' }
        $report['initialRuntimeSummary'] = Safe-StateSummary (Value $initial 'state')
        $timer = [Diagnostics.Stopwatch]::StartNew()
        $previousGMT = $null
        $firstGMT = $null
        $firstBasis = $null
        for ($i = 0; $i -lt 7; $i++) {
            $delay = ($i * 30) - $timer.Elapsed.TotalSeconds
            if ($delay -gt 0) { Start-Sleep -Milliseconds ([int]($delay * 1000) + 1) }
            $before = Get-Local '/ftmo/state'
            Guard-State $before
            $workerObservation = Check-Worker $before ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0)
            try { $clock = Get-Local '/ftmo/clock-evidence' }
            catch { Check 'Preuve UTC native' 'NON VERIFIABLE' ('Endpoint inaccessible : ' + $_.Exception.Message); throw 'Preuve native NON VERIFIABLE.' }
            if ((Value $clock 'mode') -cne 'PAPER' -or (Value $clock 'liveEnabled') -ne $false -or (Value $clock 'ordersSent') -ne $false) { throw 'NON VERIFIABLE : mode PAPER / LIVE OFF / ordersSent non prouve dans la reponse clock-evidence.' }
            $report['nativeProofSource'] = Value $clock 'nativeProbeSource'
            $report['nativeProofReadError'] = Value $clock 'nativeProbeError'
            $report['diagnosticSchemaVersion'] = Value $clock 'diagnosticSchemaVersion'
            # Preserve the exact Python failure and fee metadata before any UTC/quote early exit.
            $report['utcValidationDetails'] = Value $clock 'utcValidationDetails'
            $report['clockSamples'] = Value $clock 'samples'
            $report['clockTests'] = Value $clock 'tests'
            $report['ftmoFeesEvidence'] = Value $clock 'fees'
            if ((Value $clock 'diagnosticSchemaVersion') -ne 76 -or $null -eq $report['utcValidationDetails'] -or $null -eq $report['ftmoFeesEvidence']) {
                Check 'Diagnostic V76 charge' 'NON VERIFIABLE' 'La passerelle ne fournit pas le collecteur V76; code Python en memoire ancien ou incompatible.'
                throw 'Collecteur V76 absent de la passerelle; aucun diagnostic de frais ou de DST invente.'
            }
            if ($i -eq 0) {
                $fees = $report['ftmoFeesEvidence']
                foreach ($swapKey in @('swapLongUSD', 'swapShortUSD')) {
                    if (Finite-Number (Value $fees $swapKey)) {
                        Check ('Specification MT5 ' + $swapKey) 'VERIFIE' ((Value $fees $swapKey).ToString() + ' USD/lot/rollover simple; ' + (Value $fees 'conversionFormula') + '; signe conserve, registre non modifie.')
                        # Without an open position, START derives costs from this same validated source.
                    } else { Check ('Specification MT5 ' + $swapKey) 'NON VERIFIABLE' ((Value $fees 'blockers') -join '; ') }
                }
                if ((Value $fees 'status') -eq 'VERIFIED' -and (Finite-Number (Value $fees 'swapHourUTC'))) { Check 'Heure UTC de rollover FTMO' 'VERIFIE' ('Minuit serveur = ' + (Value $fees 'swapHourUTC') + ' h UTC pour la date observee; moteur derive ces couts au START, sans modifier le registre pendant ce GET.') }
                else { Check 'Heure UTC de rollover FTMO' 'NON VERIFIABLE' ((Value $fees 'blockers') -join '; ') }
                Check 'Regle annuelle FTMO' 'NON VERIFIABLE' ((Value $report['utcValidationDetails'] 'annualPolicyStatus') + ' : ' + (Value $report['utcValidationDetails'] 'annualPolicyReason'))
            }
            if (-not [string]::IsNullOrWhiteSpace([string](Value $clock 'nativeProbeError'))) {
                Check 'Cause exacte validation UTC Python' 'BLOQUE' ((Value $report['utcValidationDetails'] 'stage') + ' : ' + (Value $clock 'nativeProbeError'))
            }
            if (Test-QuoteUnavailable $clock) {
                Check 'COTATIONS INDISPONIBLES' 'COTATIONS INDISPONIBLES' 'Marche ferme ou flux incoherent : aucune cotation fraiche certifiable ; seuil 15 s conserve.'
                throw 'COTATIONS INDISPONIBLES : horaires du marche non certifies, aucune valeur substituee.'
            }
            $clockServer = Value $clock 'server'
            $clockLogin = Value $clock 'accountLogin'
            if ([string]::IsNullOrWhiteSpace([string]$clockServer) -or [string]::IsNullOrWhiteSpace([string]$clockLogin)) { Check 'Identite native MT5' 'NON VERIFIABLE' 'Serveur ou accountLogin runtime absent ; backend ancien/incompatible possible, aucune identite deduite du fichier.'; throw 'Identite session MT5 NON VERIFIABLE.' }
            $proofCheck = Test-NativeProof $clock ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0) ([string]$clockServer) ([string]$clockLogin)
            if ($proofCheck.status -ne 'VERIFIE') { Check 'Preuve UTC native' $proofCheck.status $proofCheck.detail; throw ('Preuve UTC ' + $proofCheck.status + ' : ' + $proofCheck.detail) }
            if ($i -eq 0) { Check 'Preuve UTC native' 'VERIFIE' $proofCheck.detail }
            if (-not $workerObservation.verifiable) { throw 'Worker/heartbeat NON VERIFIABLE ; aucune observation feed ne sera demandee, verdict NON PRET.' }
            $normalization = Value $clock 'normalization'
            $native = Value $clock 'nativeProbe'
            $clockTests = Value $clock 'tests'
            if ($null -eq $clockTests -or (Value $clockTests 'passed') -ne $true) {
                Check 'Autotests UTC' 'NON VERIFIABLE' 'Tests UTC absents ou non reussis.'
                throw 'Autotests UTC NON VERIFIABLE.'
            }
            try {
                $feed = Get-Local '/ftmo/feed'
            } catch {
                $feedError = $_.Exception.Message
                if ($feedError -match 'Tick .*ancien|BID/ASK|Pas de cotation|Cotation.*indisponible|tick.*indisponible|market.*closed|march[eé].*ferm') {
                    Check 'COTATIONS INDISPONIBLES' 'COTATIONS INDISPONIBLES' ('Aucun prix substitue. Regle de fraicheur <=15 s inchangee. ' + $feedError)
                    throw 'COTATIONS INDISPONIBLES : aucun tick estime/invente, validation arretee.'
                }
                throw
            }
            if (Test-QuoteUnavailable $clock) {
                Check 'COTATIONS INDISPONIBLES' 'COTATIONS INDISPONIBLES' 'La preuve croisee detecte des ticks natifs/python absents ou perimes; seuil 15 s conserve.'
                throw 'COTATIONS INDISPONIBLES : marche ferme ou tick courant absent.'
            }
            Guard-State $feed
            $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0
            $workerObservation = Check-Worker $feed $now
            $safe = Safe-FeedSummary $feed $clock $now
            if (-not $safe.connected -or -not $safe.accountMatches -or $safe.symbol -cne 'XAUUSD' -or $safe.accountType -cne 'DEMO' -or -not $safe.serverPrefixIsFTMODemo) {
                Check 'Flux MT5 XAUUSD/compte' 'BLOQUE' 'Le flux actif ne correspond pas au compte FTMO-Demo DEMO/XAUUSD.'
                throw 'Flux MT5 FTMO incoherent.'
            }
            $gmt = [double](Value $native 'timeGMT')
            $basis = @((Value $clock 'server'), [string](Value $native 'login'), (Value $normalization 'encoding'), (Value $normalization 'ianaZone')) | ConvertTo-Json -Compress
            if ($i -eq 0) { $firstGMT = $gmt; $firstBasis = $basis }
            if ($basis -ne $firstBasis) { Check 'Continuite compte/convention' 'BLOQUE' 'Compte, serveur ou convention a change.'; throw 'Convention ou identite native modifiee.' }
            if ($null -ne $previousGMT -and $gmt -lt $previousGMT) { throw 'Preuve native revenue en arriere.' }
            if ($i -eq 0) { Check 'Continuité compte/convention' 'VERIFIE' 'Identité serveur/login et convention relevées.' }
            $previousGMT = $gmt
            if ((Value $feed 'connected') -ne $true -or (Value (Value $feed 'feed') 'symbol') -cne 'XAUUSD' -or (Value (Value $feed 'feed') 'accountType') -cne 'DEMO' -or -not $safe.serverPrefixIsFTMODemo) { Check 'Flux FTMO' 'BLOQUE' 'Compte DEMO/XAUUSD/serveur FTMO non confirme.'; throw 'Flux FTMO non confirme.' }
            $feedBasis = Value (Value $feed 'feed') 'timeBasis'
            if ($null -eq $feedBasis -or (Value $feedBasis 'encoding') -ne (Value $normalization 'encoding') -or (Value $feedBasis 'zone') -ne (Value $normalization 'ianaZone') -or (Value $feedBasis 'server') -ne (Value $clock 'server') -or [string](Value $feedBasis 'login') -ne [string](Value $native 'login')) {
                Check 'Convention commune flux/preuve' 'NON VERIFIABLE' 'timeBasis ou l identite de compte manque/differe.'
                throw 'Convention UTC du flux NON VERIFIABLE.'
            }
            if (-not $safe.accountMatches -or $null -eq $safe.goldTickAgeSeconds -or $safe.goldTickAgeSeconds -lt 0 -or $safe.goldTickAgeSeconds -gt 15 -or $null -eq $safe.fxTickAgeSeconds -or $safe.fxTickAgeSeconds -lt 0 -or $safe.fxTickAgeSeconds -gt 15) { Check 'Fraicheur BID/ASK et FX' 'BLOQUE' 'Identite ou ages UTC hors limite 0-15 s.'; throw 'Fraicheur stricte non confirmee.' }
            if ($i -eq 0) { Check 'Flux XAUUSD/EURUSD FTMO' 'VERIFIE' 'GET /ftmo/feed a passe ses controles; ticks frais observes.' }
            if ($null -eq $safe.proofValidUntilUTC) { Check 'Expiration preuve UTC' 'NON VERIFIABLE' 'validUntilUTC absent.'; throw 'Echeance de preuve UTC NON VERIFIABLE.' }
            if ($now -gt [DateTimeOffset]::Parse([string]$safe.proofValidUntilUTC).ToUnixTimeSeconds()) { Check 'Expiration preuve UTC' 'BLOQUE' 'Preuve expiree a reception.'; throw 'Preuve UTC expiree.' }
            if ($i -eq 0) { Check 'Fraicheur BID/ASK et FX' 'VERIFIE' ('Ticks ages XAUUSD=' + $safe.goldTickAgeSeconds + ' s, FX=' + $safe.fxTickAgeSeconds + ' s; max 15 s, aucune cotation future.') }
            if ($i -eq 0) { Check 'Correspondance base du flux et preuve' 'VERIFIE' 'Compte, serveur, convention et echeance controles.' }
            foreach ($frame in @('m15', 'm30', 'h1', 'h4', 'd1', 'm5')) {
                $minimum = $(if ($frame -eq 'm15') { 201 } else { 8 })
                if ($null -eq (Value $safe.barCounts $frame)) { Check 'Historiques MT5' 'NON VERIFIABLE' ('Comptage absent : ' + $frame); throw ('Historique NON VERIFIABLE : ' + $frame) }
                if ((Value $safe.barCounts $frame) -lt $minimum) { Check 'Historiques MT5' 'BLOQUE' ('Historique insuffisant : ' + $frame); throw ('Historique insuffisant : ' + $frame) }
            }
            if (-not $workerObservation.verifiable) { throw 'Worker/heartbeat NON VERIFIABLE ; verdict maintenu NON PRET.' }
            if ($workerObservation.status -ne 'STOPPED' -or $workerObservation.alive -ne $true) { throw 'Le worker ne fournit pas le couple STOPPED/thread vivant attendu pour observer sans demarrer.' }
            if ($null -eq $safe.storageFaultPresent) { Check 'Etat stockage runtime' 'NON VERIFIABLE' 'storageFault absent de la reponse.'; throw 'Etat stockage NON VERIFIABLE.' }
            elseif ($safe.storageFaultPresent) { Check 'Etat stockage runtime' 'BLOQUE' 'Panne de stockage signalee.'; throw 'Stockage en SAFE_STOP.' }
            elseif ($i -eq 0) { Check 'Etat stockage runtime' 'VERIFIE' 'storageFault absent ou nul.' }
            if ($null -eq $safe.verificationStatus) { Check 'Verification existante' 'NON VERIFIABLE' 'verification.status absent.' }
            elseif ($safe.verificationStatus -ne 'PASSED' -or -not $script:historicalEvidenceValid) { Check 'Verification existante' 'BLOQUE' ('verification.status=' + $safe.verificationStatus + '; preuve historique insuffisante ou statut invalide; aucun verify/backtest lance.') }
            # Missing historical proof must not hide the independent UTC/worker/feed observations.
            if (-not (Finite-Number $safe.dailyAvailableEURAtObservation) -or -not (Finite-Number $safe.totalAvailableEURAtObservation)) { Check 'Limites FTMO observees' 'NON VERIFIABLE' 'Marges absentes/non finies du snapshot.'; throw 'Limites FTMO NON VERIFIABLE.' }
            $runtimeState = Value $feed 'state'
            if (-not (Finite-Number (Value $runtimeState 'equity')) -or -not (Finite-Number (Value $runtimeState 'dayBase'))) { throw 'Equity/dayBase runtime non finis.' }
            $expectedDaily = [double](Value $runtimeState 'equity') - ([double](Value $runtimeState 'dayBase') - 1000)
            $expectedTotal = [double](Value $runtimeState 'equity') - 18000
            if ([math]::Abs($safe.dailyAvailableEURAtObservation - $expectedDaily) -gt 0.01 -or [math]::Abs($safe.totalAvailableEURAtObservation - $expectedTotal) -gt 0.01) { throw 'Limites runtime incoherentes avec les seuils FTMO 20K EUR.' }
            if ($safe.dailyAvailableEURAtObservation -le 0 -or $safe.totalAvailableEURAtObservation -le 0) { Check 'Limites selon valorisation observee' 'BLOQUE' 'Une limite est atteinte ou les marges sont non positives.'; throw 'Limite atteinte selon les seules valeurs observees.' }
            if ((Ledger-Fingerprint (Value $feed 'state')) -ne $initialLedger) { Check 'Integrite registre memoire' 'BLOQUE' 'Donnees financieres modifiees pendant l observation.'; throw 'Registre memoire modifie pendant le diagnostic.' }
            $safe['index'] = $i
            $safe['elapsedSeconds'] = [math]::Round($timer.Elapsed.TotalSeconds, 1)
            $safe['workerStatusCheck'] = if ($null -eq $workerObservation.status) { 'NON VERIFIABLE' } else { $workerObservation.status }
            $safe['heartbeatCheck'] = if ($null -eq $workerObservation.heartbeatAgeSeconds) { 'NON VERIFIABLE' } else { 'age observe' }
            $samples.Add($safe)
            Write-Host ('Observation {0}/7 ; challenge={1} ; worker={2} ; ceci ne vaut pas autorisation de demarrage.' -f ($i + 1), (Value (Value $feed 'state') 'status'), $safe.workerStatusCheck)
        }
        if (($previousGMT - $firstGMT) -gt 120) { Check 'Renouvellement UTC observe >120 s' 'VERIFIE' 'Nouvelle preuve native visible pendant la fenetre de controle.' }
        else { Check 'Renouvellement UTC observe >120 s' 'NON VERIFIABLE' 'TimeGMT de la preuve n a pas avance de plus de 120 s.' }
        $final = Get-Local '/ftmo/state'
        Guard-State $final
        if ((Ledger-Fingerprint (Value $final 'state')) -eq $initialLedger) { Check 'Registre financier memoire inchange' 'VERIFIE' 'Aucune mutation PAPER observee.' }
        else { Check 'Registre financier memoire inchange' 'BLOQUE' 'Le registre a change pendant le diagnostic.' }
        $report['finalRuntimeSummary'] = Safe-StateSummary (Value $final 'state')
    }
    $after = Read-Checkpoint $checkpoint
    if ($after.sha256 -eq $disk.sha256) { Check 'Checkpoint disque inchange' 'VERIFIE' 'Hash identique avant/apres collecte.' }
    else { Check 'Checkpoint disque inchange' 'BLOQUE' 'Hash different avant/apres collecte.' }
    $report['checkpointAfterSHA256'] = $after.sha256
    if (@($checks | Where-Object { $_.status -ne 'VERIFIE' }).Count -gt 0) { $exitCode = 2 }
} catch {
    $exitCode = 2
    $report['error'] = $_.Exception.Message
    Write-Host ('CONTROLE BLOQUE : ' + $_.Exception.Message)
} finally {
    # Unconditional re-read also covers an expired UTC proof or a failed HTTP observation.
    if ($report.Contains('checkpointBeforeSHA256')) {
        try {
            $finalDisk = Read-Checkpoint $checkpoint
            $report['checkpointAfterSHA256'] = $finalDisk.sha256
            if ($finalDisk.sha256 -eq $report['checkpointBeforeSHA256']) { Check 'Checkpoint final inchange' 'VERIFIE' 'Empreinte identique meme apres un controle interrompu.' }
            else { Check 'Checkpoint final inchange' 'BLOQUE' 'Registre modifie pendant la collecte.' }
        } catch { Check 'Checkpoint final inchange' 'NON VERIFIABLE' $_.Exception.Message }
    }
    # Remaining safety requirements are deliberately not promoted to a readiness success.
    $exitCode = 2
    $report['finishedUTC'] = [DateTime]::UtcNow.ToString('o')
    $report['exitCode'] = $exitCode
    $report['verdict'] = 'NON_PRET_CONTROLES_PARTIELS'
    Write-Host 'Verdict global : NON PRET. Aucun START, STOP, RESET, verify, bot ou backtest appele.'
    try {
        if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA absent.' }
        $outputDir = Join-Path $env:LOCALAPPDATA 'TradeBotIA\diagnostics-paper'
        [void][IO.Directory]::CreateDirectory($outputDir)
        $output = Join-Path $outputDir ('preparation-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N') + '.json')
        $report | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $output -Encoding UTF8
        Write-Host ('Rapport prive : ' + $output)
    } catch {
        $exitCode = 2
        Write-Host ('Impossible de conserver le rapport : ' + $_.Exception.Message)
    }
}
exit $exitCode
