Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$report = [ordered]@{ version = 91; atUTC = [DateTime]::UtcNow.ToString('o'); mode = 'PAPER'; liveEnabled = $false; testsRun = 0; observations = @(); findings = @(); error = $null }
$exitCode = 2
function Value($Object, [string]$Name) {
    if ($null -ne $Object -and $null -ne $Object.PSObject.Properties[$Name]) { return $Object.$Name }
    return $null
}
function Observe([string]$Name, $Data) {
    $script:report.observations += [ordered]@{ name = $Name; data = $Data }
    Write-Host ($Name + ' : ' + ($Data | ConvertTo-Json -Depth 20 -Compress))
}
function Finding([string]$Code, [string]$Evidence, [string]$Action) {
    $script:report.findings += [ordered]@{ code = $Code; evidence = $Evidence; action = $Action }
    Write-Host ($Code + ' : ' + $Evidence + ' | ' + $Action)
}
function Get-Local([string]$Route) {
    if ($Route -notin @('/diagnostics/mt5-ipc', '/status?symbol=XAUUSD', '/paper-trial/state')) { throw 'Route refusee.' }
    $watch = [Diagnostics.Stopwatch]::StartNew()
    try {
        $data = Invoke-RestMethod -Uri ('http://127.0.0.1:8765' + $Route) -Method Get -MaximumRedirection 0 -TimeoutSec 40
        Observe $Route ([ordered]@{ elapsedMs = $watch.ElapsedMilliseconds; response = $data })
        return $data
    } catch {
        Observe $Route ([ordered]@{ elapsedMs = $watch.ElapsedMilliseconds; error = $_.Exception.Message; detail = [string]$_.ErrorDetails })
        return $null
    }
}
try {
    Observe 'Contexte VS Code' ([ordered]@{ user = [Security.Principal.WindowsIdentity]::GetCurrent().Name; powershellPID = $PID; session = (Get-Process -Id $PID).SessionId; root = $root; terminalPathProcess = $env:MT5_TERMINAL_PATH; terminalPathUser = [Environment]::GetEnvironmentVariable('MT5_TERMINAL_PATH','User'); terminalPathMachine = [Environment]::GetEnvironmentVariable('MT5_TERMINAL_PATH','Machine') })
    $processes = @()
    foreach ($p in @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('terminal64.exe','python.exe','pythonw.exe') })) {
        $owner = $null
        try { $o = Invoke-CimMethod -InputObject $p -MethodName GetOwner; if ($o.ReturnValue -eq 0) { $owner = $o.Domain + '\' + $o.User } } catch { }
        $processes += [pscustomobject]@{ pid = $p.ProcessId; parentPID = $p.ParentProcessId; name = $p.Name; executable = $p.ExecutablePath; session = $p.SessionId; owner = $owner; created = [string]$p.CreationDate; bridgeCommandDetected = ([string]$p.CommandLine -match '(?i)bridge\.py(?:["\s]|$)') }
    }
    Observe 'Processus (sans arguments sensibles)' $processes
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 8765 -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess)
    Observe 'Proprietaire du port 8765' $listeners
    if ($listeners.Count -eq 0) { Finding 'BRIDGE_NOT_LISTENING' 'Aucun listener 8765 observe.' 'La passerelle existante doit etre disponible; aucun processus ne sera lance ici.' }
    if (@($listeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1','::1') }).Count -gt 0) { throw 'Port 8765 expose hors loopback; diagnostic HTTP refuse.' }
    $bridgeProcesses = @($processes | Where-Object { $_.bridgeCommandDetected })
    if ($bridgeProcesses.Count -gt 1) { Finding 'MULTIPLE_BRIDGE_CANDIDATES' ('Plusieurs commandes bridge.py observees : ' + ($bridgeProcesses.pid -join ', ')) 'Identifier leur provenance avant toute fermeture; aucun processus arrete automatiquement.' }
    $terminals = @($processes | Where-Object { $_.name -eq 'terminal64.exe' })
    if ($terminals.Count -eq 0) { Finding 'TERMINAL_NOT_OBSERVED' 'Aucun terminal64.exe observe.' 'Verifier utilisateur/session Windows du terminal; pas de lancement automatique.' }
    foreach ($group in @($terminals | Where-Object { $_.executable } | Group-Object executable)) {
        if ($group.Count -gt 1) { Finding 'SAME_EXECUTABLE_MULTIPLE_PIDS' ('Chemin ambigu : ' + $group.Name + '; PID=' + (($group.Group | ForEach-Object { $_.pid }) -join ',')) 'Une instance unique doit etre identifiee; le projet refuse desormais cette ambiguite sans toucher aux terminaux.' }
    }
    # Metadata only: do not import bridge.py, initialize MT5, install packages, or execute tests.
    $python = Join-Path $root '.venv-mt5\Scripts\python.exe'
    if (Test-Path -LiteralPath $python -PathType Leaf) {
        $code = 'import sys,struct,json,importlib.util,importlib.metadata as m; s=importlib.util.find_spec("MetaTrader5"); print(json.dumps({"executable":sys.executable,"bits":struct.calcsize("P")*8,"version":sys.version,"mt5Module":s.origin if s else None,"mt5Version":m.version("MetaTrader5") if s else None}))'
        $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($code))
        $loader = "import base64;exec(base64.b64decode('$encoded'))"
        try {
            $text = & $python -c $loader 2>&1
            Observe 'Environnement Python attendu (sans initialisation API)' ([ordered]@{ exitCode = $LASTEXITCODE; output = ($text | Out-String) })
        } catch { Observe 'Environnement Python attendu en erreur' $_.Exception.Message }
    } else { Finding 'EXPECTED_VENV_MISSING' $python 'Environnement attendu absent; aucun package ne sera installe automatiquement.' }
    $before = Get-Local '/diagnostics/mt5-ipc'
    # Only the existing bridge may attempt its normal connection, under its lock/retry gate.
    # This does not reset the gate, start PAPER, or retry in a second Python process.
    $status = Get-Local '/status?symbol=XAUUSD'
    $after = Get-Local '/diagnostics/mt5-ipc'
    $paper = Get-Local '/paper-trial/state'
    if ($null -eq $after) {
        Finding 'DIAGNOSTIC_ENDPOINT_UNAVAILABLE' 'Endpoint V91 absent ou inaccessible; les erreurs HTTP sont conservees.' 'Si 404 et ancienne passerelle confirmee, une relance controlee de la passerelle est necessaire pour charger V91, avec accord; aucun redemarrage MT5 requis par ce constat.'
    } else {
        $runtime = Value $after 'runtime'
        if ((Value $runtime 'loadedSha256') -ne (Value $runtime 'diskSha256')) { Finding 'STALE_BRIDGE' 'Empreinte des modules charges differente du disque.' 'Relance controlee de la passerelle uniquement avec accord; ne pas demarrer une deuxieme instance.' }
        $py = Value $after 'python'
        if ((Value $py 'bits') -ne 64) { Finding 'PYTHON_NOT_64BIT' 'Processus passerelle non 64 bits.' 'Utiliser un Python Windows 64 bits compatible; aucune reinstallation automatique.' }
        if ([string](Value $py 'executable') -ne $python) { Finding 'PYTHON_ENVIRONMENT_DIFFERS' ('Python charge : ' + [string](Value $py 'executable') + '; attendu : ' + $python) 'Difference observee, pas une preuve de causalite; verifier la provenance du lancement avant changement.' }
        $configured = Value $py 'configuredTerminalResolved'
        if ($configured) {
            $matches = @($terminals | Where-Object { $_.executable -eq $configured })
            if ($matches.Count -eq 0) { Finding 'CONFIGURED_TERMINAL_NOT_OBSERVED' ([string]$configured) 'Chemin herite par la passerelle absent des executables accessibles observes; verifier les permissions avant de conclure a une absence. Aucun changement de variable automatique.' }
            $actual = Value $after 'terminal'
            if ($null -ne $actual -and (Join-Path ([string](Value $actual 'path')) 'terminal64.exe') -ne $configured) { Finding 'ACTUAL_TERMINAL_PATH_MISMATCH' ('API=' + [string](Value $actual 'path') + '; configuration=' + $configured) 'Lecture refusee par connect(); aucune reinitialisation ou selection automatique d un autre compte.' }
        } elseif (@($terminals | Where-Object { $_.executable } | Select-Object -ExpandProperty executable -Unique).Count -gt 1) { Finding 'NO_UNIQUE_TERMINAL_SELECTION' 'Plusieurs chemins MT5 accessibles, aucun MT5_TERMINAL_PATH herite.' 'Selection ambigue prouvee; identifier le terminal FTMO-Demo avant toute configuration.' }
        $bridgePID = Value $py 'pid'
        if (@($listeners | Where-Object { $_.OwningProcess -eq $bridgePID }).Count -eq 0) { Finding 'LISTENER_PID_MISMATCH' 'PID HTTP V91 non retrouve parmi les listeners observes.' 'Instance de passerelle non confirmee; ne pas modifier les processus.' }
        $bp = $processes | Where-Object { $_.pid -eq $bridgePID } | Select-Object -First 1
        foreach ($t in $terminals) {
            if ($null -ne $bp -and $null -ne $bp.owner -and $null -ne $t.owner -and ($bp.owner -ne $t.owner -or $bp.session -ne $t.session)) {
                Finding 'WINDOWS_CONTEXT_DIFFERS' ('Passerelle PID ' + $bridgePID + ' et MT5 PID ' + $t.pid + ' : utilisateur/session differents.') 'Conflit potentiel seulement si ce terminal est celui cible; ne pas changer le compte MT5. Alignement du contexte de lancement a confirmer avec accord.'
            }
        }
        $ipc = Value $after 'ipc'
        if ((Value $ipc 'exhausted') -eq $true) { Finding 'IPC_RETRIES_EXHAUSTED' 'Compteur IPC de la passerelle epuise; aucune nouvelle initialisation autorisee.' 'SAFE_STOP conserve. Le diagnostic ne reinitialise pas ce compteur.' }
        foreach ($item in @(Value $after 'findings')) { if ($null -ne $item) { Finding 'BRIDGE_OBSERVATION' ([string]$item) 'Voir les donnees natives jointes; aucune remise a zero.' } }
        if ((Value $status 'connected') -ne $true) { Finding 'CONNECTION_NOT_VERIFIED' ([string](Value $status 'error')) 'Un timeout IPC prouve un echec de dialogue, pas a lui seul sa cause racine.' }
    }
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()/1000.0
    $ticks = @(Value $after 'ticks')
    $fresh = ($ticks.Count -eq 2 -and @($ticks | Where-Object { (Value $_ 'fresh') -ne $true -or $null -eq (Value $_ 'normalizedUTC') -or ($now - [double](Value $_ 'normalizedUTC')) -lt 0 -or ($now - [double](Value $_ 'normalizedUTC')) -gt 15 }).Count -eq 0)
    $worker = Value $paper 'worker'
    $hb = Value $worker 'heartbeat'
    $hbFresh = ($null -ne $hb -and ($now - [double]$hb) -ge 0 -and ($now - [double]$hb) -le 15 -and (Value $worker 'alive') -eq $true)
    $state = Value $paper 'state'
    $safe = ((Value $status 'mode') -eq 'PAPER' -and (Value $status 'liveEnabled') -eq $false -and (Value $paper 'kind') -eq 'ESSAI_PAPER' -and (Value $state 'running') -eq $true -and (Value $state 'monitoringBlocked') -eq $false -and (Value $worker 'status') -ne 'SAFE_STOP' -and (Value (Value $after 'ipc') 'failed') -eq $false)
    Observe 'Bilan observe' ([ordered]@{ connected = (Value $status 'connected'); twoTicksFreshUnder15s = $fresh; valuationFresh = (Value $paper 'valuationFresh'); paperHeartbeatFresh = $hbFresh; paperSafetyConfirmed = $safe; worker = $worker; safeStopNeverCleared = $true; rootCauseAutomaticallyProven = $false })
    if ((Value $status 'connected') -eq $true -and $fresh -and $hbFresh -and $safe -and (Value $paper 'valuationFresh') -eq $true -and (Value (Value $after 'account') 'ftmoDemo') -eq $true) { $exitCode = 0 }
    Write-Host 'Aucun test relance. Aucun ordre, START, login, changement de compte, shutdown, suppression ou redemarrage.'
} catch { $report.error = $_.Exception.Message; Write-Host ('DIAGNOSTIC INCOMPLET : ' + $report.error) }
finally {
    $report.exitCode = $exitCode
    $directory = Join-Path $env:LOCALAPPDATA 'TradeBotIA\diagnostic-v91'
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    $path = Join-Path $directory ('ipc-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [Guid]::NewGuid().ToString('N') + '.json')
    $report | ConvertTo-Json -Depth 32 | Set-Content -LiteralPath $path -Encoding UTF8
    Write-Host ('Rapport local (identifiants et chemins a masquer avant partage) : ' + $path)
}
exit $exitCode
