# Checklist de reprise — GOLD Shadow (lundi)

Cette procédure est manuelle, en lecture seule et ne démarre pas le moteur PAPER. Ne pas lancer MT5, la passerelle ou le tracker avant la réouverture et les vérifications ci-dessous.

## 1. Horloge et compte MT5

1. Ouvrir le terminal MT5 déjà autorisé et confirmer visuellement qu'il s'agit du compte **FTMO-Demo** attendu; ne pas basculer de compte.
2. Suivre la procédure existante de [`HORODATAGES.md`](../mt5_bridge/HORODATAGES.md), dans MT5 : **Relevé croisé + autotests**. Le relevé doit être natif, récent, lié au compte/serveur courant et cohérent avec XAUUSD/EURUSD.
3. Ne pas renseigner de fuseau ou de règle annuelle FTMO non confirmés. Ne pas retoucher les timestamps. Si la preuve est absente, expirée ou incohérente, ou si le GET répond HTTP 503, arrêter ici et suivre le diagnostic autorisé; aucun contournement ni redémarrage improvisé.

## 2. Contrat et cotations — lecture seule

Dans MT5, consulter la spécification du symbole **XAUUSD** dans Market Watch et relever la taille du contrat, taille/valeur du tick, devises, volumes minimum/maximum/pas et exigences de marge. Vérifier séparément le spread coté et la commission applicable dans le barème FTMO. Une valeur manquante ou non confirmée bloque tout dimensionnement; les valeurs historiques de simulation ne sont pas des spécifications du compte.

Vérifier ensuite les quatre flux avec des GET locaux seulement, sans appeler `/ftmo/feed`. Ces appels sont des diagnostics à exécuter manuellement à la réouverture, jamais pendant la fermeture :

```powershell
$intervals = @{ M15 = 15; M30 = 30; H4 = 240; D1 = 1440 }
foreach ($tf in $intervals.Keys) {
  $uri = "http://127.0.0.1:8765/candles?symbol=XAUUSD&timeframe=$tf&count=2000"
  try { $feed = Invoke-RestMethod -Method Get -Uri $uri -TimeoutSec 10 }
  catch { throw "GET $tf en échec (503 inclus); arrêt sans contournement : $_" }
  $now = [DateTimeOffset]::UtcNow
  if ($feed.source -ne 'MT5' -or $feed.readOnly -ne $true -or $feed.closedBarsOnly -ne $true -or $feed.symbol -ne 'XAUUSD' -or $feed.timeframe -ne $tf) { throw "Flux $tf non conforme; arrêt." }
  $fetchedAt = [DateTimeOffset]::Parse($feed.fetchedAt).ToUniversalTime()
  $responseAge = $now - $fetchedAt
  if ($responseAge.TotalSeconds -lt 0 -or $responseAge.TotalSeconds -gt 120) { throw "Réponse $tf périmée ou future; arrêt." }
  $minimum = if ($tf -eq 'M15') { 201 } else { 5 }
  if ($feed.candles.Count -lt $minimum) { throw "Historique $tf insuffisant; arrêt." }
  $priorTime = -1.0
  $gapCount = 0
  foreach ($bar in $feed.candles) {
    $values = @([double]$bar.time, [double]$bar.open, [double]$bar.high, [double]$bar.low, [double]$bar.close)
    if ($values | Where-Object { [double]::IsNaN($_) -or [double]::IsInfinity($_) }) { throw "OHLC non fini dans $tf; arrêt." }
    if ($bar.time -le $priorTime -or $bar.open -le 0 -or $bar.high -lt [Math]::Max($bar.open, $bar.close) -or $bar.low -gt [Math]::Min($bar.open, $bar.close)) { throw "Ordre chronologique ou OHLC invalide dans $tf; arrêt." }
    if ($priorTime -ge 0 -and $bar.time - $priorTime -gt $intervals[$tf] * 60 * 1000) { $gapCount++ }
    $priorTime = $bar.time
  }
  $last = $feed.candles[-1]
  $closedAt = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$last.time).AddMinutes($intervals[$tf])
  $barAge = $now - $closedAt
  if ($barAge.TotalSeconds -lt 0) { throw "Dernière bougie $tf non clôturée; arrêt." }
  if ($tf -eq 'M15' -and $barAge.TotalMinutes -gt 40) { throw 'Dernière M15 périmée; arrêt.' }
  [pscustomobject]@{ Timeframe = $tf; ClosedAtUTC = $closedAt; AgeMinutes = [Math]::Round($barAge.TotalMinutes, 1); GapCount = $gapCount }
}
```

Les gaps sont seulement comptés : un week-end ou une fermeture ne peut pas être distingué d'un manque de cotations sans calendrier de sessions confirmé. Cette vérification préalable ne remplace pas les validations du runner.

## 3. Démarrer et vérifier le Shadow

Depuis la racine du dépôt, dans un terminal PowerShell dédié :

```powershell
node --experimental-strip-types scripts\run-gold-xauusd-shadow.mjs
```

Au premier lancement sur un journal absent/vide, le runner écrit un événement `RECOVERY` dont `detail.action` vaut `INITIAL_BASELINE` dès qu'il trouve au moins une comparaison issue de deux M15 consécutives exploitables; l'historique de chauffe est ignoré. Un journal déjà existant est repris sans être effacé et ne doit pas produire un nouveau `INITIAL_BASELINE`. Pour un premier démarrage, vérifier le baseline dans un second terminal :

```powershell
$journal = 'src\ftmo\reference\resultats\shadow-xauusd-live\shadow-journal.jsonl'
$events = Get-Content $journal | ForEach-Object { $_ | ConvertFrom-Json }
$baseline = $events | Where-Object { $_.eventType -eq 'RECOVERY' -and $_.detail.action -eq 'INITIAL_BASELINE' } | Select-Object -Last 1
if (-not $baseline) { throw 'INITIAL_BASELINE absent; vérifier la sortie du runner et la présence de M15 consécutives.' }
$baseline | Select-Object eventType, recordedAt, decisionAt, detail
```

Attendre au moins une nouvelle clôture M15 après le baseline, relire le journal et exiger une comparaison dont l'instant de décision est postérieur au baseline :

```powershell
$events = Get-Content $journal | ForEach-Object { $_ | ConvertFrom-Json }
$comparison = $events | Where-Object { $_.eventType -eq 'BAR_COMPARISON' -and $_.decisionAt -gt $baseline.detail.baselineDecisionAt } | Select-Object -Last 1
if (-not $comparison) { throw 'Aucun nouveau BAR_COMPARISON après le baseline; laisser le runner en attente ou diagnostiquer le flux.' }
if ($comparison.detail.orderTransmission -ne $false -or $comparison.detail.paperEngineNotification -ne $false) { throw 'Événement sans preuve de non-transmission.' }
$comparison | Select-Object eventType, recordedAt, decisionAt, detail
```

Le code du runner ne possède que des GET locaux vers `/candles` et marque explicitement `orderTransmission: false` et `paperEngineNotification: false`. Arrêter proprement avec `Ctrl+C`; attendre le message d'arrêt avant de fermer la fenêtre, afin que le verrou soit libéré.

## 4. Interruptions et limites

- HTTP 503, erreur réseau ou données invalides : le runner journalise une `INTERRUPTION`, ne fabrique aucune donnée, puis réessaie au cycle suivant. La reprise du flux journalise `RECOVERY`; aucun contournement n'est effectué.
- Un journal corrompu ou un verrou résiduel bloque le démarrage. Ne pas supprimer le journal ni le verrou sans inspection; préserver tous les événements.
- Les événements initiaux ne font pas de simulation financière. Volume, coûts, PnL et capital restent indisponibles tant que les spécifications réelles ne sont pas vérifiées.
- GOLD reste la référence provisoire. `GOLD_SMC`, `GOLD_FIBONACCI` et `GOLD_SMC_FIBONACCI` sont des comparaisons Shadow expérimentales et facultatives; elles ne modifient pas les règles actives ni n'imposent de filtre.
- Le suivi n'est pas déclaré opérationnel avant observation réelle d'une nouvelle clôture M15 et lecture d'un `BAR_COMPARISON` persisté.
