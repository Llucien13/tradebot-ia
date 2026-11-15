# V75 — diagnostic PAPER : sources, corrections et validations restantes

## Verdict

**NON PRÊT.** Aucun ordre, démarrage de bot, START, STOP, RESET, VERIFY, backtest ou modification de registre utilisateur effectué dans cette intervention. Stratégie GOLD M15 2,5R, risque, historiques et résultats anciens inchangés.

Les 45 tests Python et le build Vite/Nitro ont réussi **selon le compte rendu Windows de l’utilisateur**. Ils ne sont pas relancés ici et ne couvrent pas les nouveaux correctifs V75.

## Sources autoritaires et écart de déploiement

| Information | Source réelle | Ce qui ne constitue pas une preuve |
|---|---|---|
| Phase/statut challenge | `challenge.json` chargé dans `FTMOService.state`, puis `state.status` | `PHASE_1` n’est pas STOPPED et ne décrit pas un thread. |
| Mode/activation | Booléens runtime `state.liveEnabled`, `state.running`, mode `state.mode`; copie disque à distinguer | Un champ absent, nul ou une chaîne ne doit pas être converti en faux. |
| Position/capital/historique | Checkpoint `%LOCALAPPDATA%\TradeBotIA\ftmo20k\challenge.json` sous identité Windows attendue; snapshot en mémoire séparé | Un registre absent n’autorise pas à recréer un capital pendant le diagnostic. |
| Chemin du registre | Champ top-level `storage` de `/ftmo/state` comparé au chemin local attendu | Pas de propriété `state.storage` inventée ni de chemin choisi par une autre réponse. |
| Worker | `self.worker.status`, `self.thread.is_alive()` exposés par `snapshot()` dans les sources actuelles | `running=false`, un serveur HTTP joignable, ou un heartbeat de requête ne prouvent pas STOPPED. |
| Heartbeat | `self.worker.heartbeat` mis à jour dans `cycle()` | Ni date du fichier, ni `lastObserved`, ni heure du GET ne remplacent un heartbeat absent. |
| Identité MT5 | Compte renvoyé par la connexion réelle : `account.server` / `account.login`; télémétrie `server` / `accountLogin` | Ne pas comparer le login natif uniquement à lui-même. |
| Preuve native | `Path(terminal.data_path)/MQL5/Files/tradebot-clock-proof.json`, produit par l’observateur MQL5 | Pas dans challenge.json, pas dans le navigateur, pas dans un dossier MT5 présumé. |
| Normalisation/expiration | `validate_time_basis()` Python : preuve v2, compte, horloges, convention, ticks et bougies croisés; expiration `timeGMT+120 s` | Ni offset estimé à partir de l’âge des ticks ni simple existence du fichier ne suffisent. |
| Vérification moteur | Rapport `verification.json` existant + état PASSED/STALE/NOT_RUN renvoyé par le service | Le succès des 45 tests n’est pas un PASSED artificiel du rapport historique; NOT_RUN reste bloquant. |

**Écart constaté :** les sources présentes de `FTMOService.snapshot()` contiennent déjà `worker` et `storageFault`, mais la réponse Windows rapportée ne contient pas `worker`. Les causes possibles incluent une ancienne passerelle chargée, un autre exemplaire du projet ou un intermédiaire qui retire des champs. Aucune de ces causes n’est confirmée ici. Le correctif ne démarre, ne redémarre et ne modifie aucun worker pour contourner cet écart.

La télémétrie horloge V75 ajoute `diagnosticSchemaVersion=75`, `nativeProbeSource`, `accountLogin`, `nativeProofStatus` et `quotesStatus`. Ces valeurs sont calculées à la lecture réelle, sans création de preuve, sans modification du fichier MT5 ni du registre.

## Correctifs finalisés

1. PowerShell gère explicitement les propriétés absentes sous StrictMode et les clés des dictionnaires (`OrderedDictionary` compris).
2. Un heartbeat absent/invalide, un thread non confirmé ou un statut worker absent restent NON VÉRIFIABLES. Un heartbeat ancien/futur reste bloquant. Rien n’est déduit de PHASE_1.
3. Les âges de ticks sont contrôlés sans arrondi préalable : une avance de 0,0001 s ou un âge de 15,0001 s ne devient pas valide en étant arrondi. Limite maintenue à 0–15 s inclus.
4. `/ftmo/clock-evidence` lit le fichier de preuve **une seule fois** et valide cet objet exact avec le validateur Python existant. Auparavant, le diagnostic pouvait afficher une capture et en relire une autre lors du renouvellement.
5. L’identité native est comparée au compte runtime `accountLogin`, et au compte/base du flux si l’observation peut continuer. La source du fichier est exposée explicitement.
6. Une preuve manquante, JSON corrompue, d’un autre compte, du tester, périmée, future ou incohérente n’obtient aucune normalisation validée.
7. La validation IANA autoritaire reste celle de Python `zoneinfo`. PowerShell 5.1 ne tente plus de résoudre un identifiant IANA via les noms de fuseaux Windows et ne remplace pas celui-ci par un offset fixe. La règle confirmée et le fuseau retourné par Python doivent correspondre.
8. Marché fermé / tick absent ou trop ancien / horloges serveur incohérentes : **COTATIONS INDISPONIBLES** pour la validation. Les horaires exacts du marché ne sont pas certifiés par ce libellé; une panne de flux peut produire le même symptôme. Aucune cotation ni clôture n’est fabriquée. Si la base UTC elle-même est inconnue, l’état reste NON VÉRIFIABLE plutôt qu’une correction arbitraire.
9. Le lanceur de diagnostic ne fait plus deux collectes locales par erreur (la première ligne de commande est désormais affichée, non exécutée une seconde fois).
10. Le verdict global reste NON PRÊT, y compris si les observations individuelles sont conformes. Aucun rapport historique n’est régénéré pour lever NOT_RUN/STALE.

## Tests ciblés préparés — résultats exacts

Aucun outil d’exécution Python, PowerShell, shell ou accès au poste Windows n’est disponible dans cette session. **Aucun résultat d’exécution V75 n’est annoncé comme acquis.** Le contrôle statique des sources n’est pas un test d’exécution ni une validation syntaxique PowerShell.

| Vérification | Définis | Exécutés ici | Réussis constatés | Échoués constatés |
|---|---:|---:|---:|---:|
| `test_preparation_diagnostic.py` — contrats statiques des sources | 6 | 0 | 0 | 0 |
| `test_clock_diagnostic_v75.py` — vrai collecteur avec MT5 simulé et fichiers temporaires | 9 | 0 | 0 | 0 |
| PowerShell `-SelfTest` — scénarios hors ligne | Scénarios incorporés | 0 | 0 | 0 |

Les 9 tests du collecteur couvrent : source réelle/identité runtime, preuve absente, expiration malgré tick Python frais, autre compte, cotations absentes, âge >15 s, lecture unique de l’objet validé, JSON partiel, et cas marché fermé/horloges non synchronisées. Ils neutralisent `run_clock_tests` : aucune des 45 anciennes vérifications n’est relancée par ces tests ciblés.

Le SelfTest couvre phase distincte du worker, worker absent, heartbeat frais/périmé, preuve synthétique fraîche/expirée/future/autre compte/absente, cotations indisponibles et dictionnaires PowerShell. Il se termine avant tout GET, accès au registre, création de rapport ou interrogation de l’horloge Windows.

## Validation Windows préparée

### Prochaine action : validation ciblée hors ligne

Depuis l’Explorateur, le lanceur **`src/mt5_bridge/valider_diagnostic_v75.bat`** affiche les commandes exactes puis exécute uniquement les 6 tests de contrat, les 9 tests du collecteur et le SelfTest PowerShell. Il utilise l’environnement `.venv-mt5` existant, sans installation automatique. Aucune politique PowerShell n’est contournée. La sortie doit être conservée, y compris un éventuel refus de politique ou échec d’import.

Commandes de référence embarquées (racine du dépôt) :

```bat
".venv-mt5\Scripts\python.exe" -m unittest discover -s "src\mt5_bridge" -p "test_preparation_diagnostic.py" -v
".venv-mt5\Scripts\python.exe" -m unittest discover -s "src\mt5_bridge" -p "test_clock_diagnostic_v75.py" -v
powershell.exe -NoProfile -File "src\mt5_bridge\controler_preparation_paper.ps1" -SelfTest
```

### Collecte réelle, seulement après validation ciblée

Le menu **`src/mt5_bridge/controler_preparation_paper.bat`** fournit les deux modes existants :

- Mode local : lit uniquement les fichiers existants et l’état Windows; aucune connexion au service, aucun challenge créé.
- Observation UTC : requiert MT5 et la passerelle **déjà ouverts**, PAPER, LIVE OFF, running=false et aucune position. Les propriétés absentes sont signalées, pas recréées. Si le worker n’est pas démontré, aucune requête `/ftmo/feed` n’est demandée. Une capture UTC peut être collectée indépendamment pour expliquer le blocage. Aucune lecture ne démarre l’observateur MQL5.

Commandes de référence du menu :

```bat
powershell.exe -NoProfile -File "src\mt5_bridge\controler_preparation_paper.ps1"
powershell.exe -NoProfile -File "src\mt5_bridge\controler_preparation_paper.ps1" -ObserverUTC
```

Le GET `clock-evidence` effectue ses autotests UTC obligatoires; le GET `feed`, s’il est autorisé, fait aussi son contrôle UTC existant et synchronise/charge les historiques MT5. Ce ne sont pas des backtests. Ces GET ne sont pas strictement sans effet sur les caches et la télémétrie; ils ne placent aucun ordre et ne modifient pas les résultats financiers. Aucun des trois endpoints d’action START/STOP/RESET ni VERIFY n’est utilisé.

Le JSON neuf se trouve dans `%LOCALAPPDATA%\TradeBotIA\diagnostics-paper`. Il peut contenir chemins et informations privées : masquer celles-ci avant partage. Code 2 = incomplet/bloqué; code 0 = fin des observations codées seulement, jamais autorisation de démarrage. Le SelfTest a son propre code de résultat, sans verdict de préparation du bot.

## Blocages toujours réels

- Différence entre sources actuelles et schéma reçu par le processus Windows : retrouver quel service répond, sans supposer que le build Vite a rechargé Python. Les outils livrés ne le redémarrent pas.
- Preuve native MT5 v2 réellement produite au bon emplacement et compilation du bon `.mq5`/`.ex5` : non attestées ici. Ne pas écrire de JSON artificiel pour satisfaire le diagnostic.
- Si SERVER_WALL : preuve externe de la règle annuelle FTMO, pas seulement GMT+3 à une date.
- Renouvellement réel observé au-delà de 120 s avec ticks frais; impossible hors marché/flux disponible.
- `verification.status=NOT_RUN/STALE` : reste bloquant, sans relancer d’ancien backtest pour masquer la cause.
- Calibration des frais, contrôles serveur complets avant démarrage, couverture du hash, essais réels de panne/reprise en bac à sable, limites de surveillance continue déjà décrits dans l’audit : non levés par V75.

## Périmètre des fichiers V75

- `src/mt5_bridge/controler_preparation_paper.ps1`
- `src/mt5_bridge/controler_preparation_paper.bat`
- `src/mt5_bridge/clock_evidence.py` (collecte/télémétrie read-only uniquement)
- `src/mt5_bridge/test_preparation_diagnostic.py`
- `src/mt5_bridge/test_clock_diagnostic_v75.py`
- `src/mt5_bridge/valider_diagnostic_v75.bat`
- Ce rapport.

Aucun fichier de moteur, risque, historique, ancien résultat, `time_basis.py`, `ftmo_service.py` ou route d’action n’est modifié pour finaliser V75. Les défauts du diagnostic sont corrigés dans les sources; les préconditions manquantes ne sont pas déclarées satisfaites.
