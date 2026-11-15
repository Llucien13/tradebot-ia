# État de validation — après tests Windows 45/45

## Déclarations reçues

Le propriétaire rapporte que les vérifications Windows suivantes ont réussi :

- **45 tests Python exécutés, 45 réussis** ;
- **`npm.cmd run build` réussi** (Vite + Nitro).

Ces résultats sont rapportés par l’utilisateur dans la conversation. Les journaux bruts n’ont pas été joints ni exécutés/inspectés ici. Aucun backtest n’est redemandé ou relancé.

Le collecteur PowerShell livré dans cette suite n’est pas couvert par les 45 tests Python ni par le build Vite/Nitro. Il n’a pas été exécuté ou validé par l’interpréteur PowerShell dans cette session.

## Matrice de préparation PAPER

| Contrôle | État constaté | Interprétation / preuve requise |
|---|---|---|
| Tests Python synthétiques (45) | Réussi selon rapport utilisateur | Bon test logiciel ; ne simule pas un terminal FTMO, le calendrier réel ni une panne matérielle. Conserver sortie Windows. |
| Build Vite + Nitro | Réussi selon rapport utilisateur | Build frontend/server réussi selon le rapport; ne certifie pas la passerelle Python ni le binaire MQL5. |
| GOLD M15 2,5R / données historiques | Aucun backtest relancé; moteurs et historiques non modifiés dans la suite | Invariant du registre actif non vérifié sur le PC. Ne pas lancer de replay antérieur pour obtenir un feu vert. |
| PAPER / LIVE OFF / `running` | Non inspecté ici sur la machine | Lire le registre local existant. Si registre absent, ne pas créer automatiquement un challenge pendant le contrôle. |
| Preuve UTC native de compte | Non validée par une capture Windows transmise | Confirmer preuve v2 fraîche, hors Strategy Tester, même compte/serveur, convention indiquée et ticks/bougies croisés. |
| Règle annuelle de fuseau serveur | Bloquante si heure `SERVER_WALL` sans preuve FTMO complète | Confirmation FTMO indépendante, fuseau IANA correspondant; GMT+3 à une date seule ne prouve pas le calendrier DST. |
| Renouvellement natif >120 s | Source décrit un observateur 30 s, mais compilation/exécution Windows non attestées | Compiler le `.mq5`, confirmer le `.ex5` utilisé puis observer au moins 180 s sans changement de compte/base. Script d’observation non lancé automatiquement par nos outils. |
| Flux FTMO XAUUSD + EUR/USD | Non validé en session ici | Requiert MT5 déjà ouvert; GET `/ftmo/feed` fait test de connexion et charge les historiques, sans démarrer le bot ni envoyer d’ordre. |
| Worker/heartbeat | Code expose statut et heartbeat, mais aucune observation Windows fournie | Vérifier thread vivant + statut STOPPED + heartbeat récent. L’API snapshot lit aussi le report; une lecture report inaccessible doit afficher l’erreur/SAFE_STOP. |
| Checkpoint PAPER courant / absence de position | Non inspecté | Contrôler chemin Windows attendu, PAPER/LIVE OFF, tpR=2.5, `running=false`, intégrité registre. Position présente = arrêter le diagnostic distant et conserver la position non valorisée. |
| Sauvegarde atomique, verrou exclusif | 45 tests rapportés passent; pas d’essai réel NTFS | Vérifier que le `.lock` OS exclut un second processus sur le même fichier dans une copie de test. Ne jamais tester par panne simulée sur le registre officiel. |
| Reprise après crash | Test logiciel rapporté; comportement Windows réel non démontré | Restaurer une copie de challenge.json dans un bac à sable isolé et vérifier capitale, position, trades, événements/courbe et absence de réapplication. Pas de coupure forcée sur registre réel. |
| Limites FTMO | Mécanismes déjà décrits, continuité non démontrée | Limites quotidiennes à minuit Europe/Prague, trous de polling, swaps manqués, marge, gaps et excursions non observées restent des limites de protection. Le rapport V69 les décrit. |
| Frais | Non certifiés FTMO | Obtenir commission, devise/unité, slippage de simulation, valeur swap signée/nuit, jour triple et rollover/DST. Les valeurs par défaut ne sont pas une calibration réelle. |
| Invariant serveur `tpR==2.5` / hash du rapport | Toujours bloquant selon V69 | V69 indique absence de garde moteur sur un challenge.json préexistant et hash sans `time_basis.py`/`quote_time.py`. Aucune correction V72 de ces points n’a été effectuée. Contrôle code séparé avant autorisation. |
| Contrôle complet de démarrage | Toujours bloquant selon V69 | `/ftmo/start` appelle `market()` mais ne refait pas à lui seul `/ftmo/feed`/contrôles complets et n’évalue pas préventivement tous les risques/limites sur position au démarrage. Ne pas appeler START pendant diagnostic. |
| Reprise sûre avec position ouverte | Bloquante par conception | Reprise automatique est désactivée; position doit rester conservée sans cotation/clôture supposée. L’approbation d’un protocole explicite de continuité est encore requise. |

## Contrôles Windows préparés

Fichiers ajoutés :

- `src/mt5_bridge/controler_preparation_paper.bat` — menu par double clic;
- `src/mt5_bridge/controler_preparation_paper.ps1` — collecteur en lecture seule, résumé sans historique ni tick brut.

Les deux commandes directes, depuis la racine du dépôt :

```bat
powershell.exe -NoProfile -File "src\mt5_bridge\controler_preparation_paper.ps1"
```

Lecture locale des fichiers existants, hash avant/après, résumé PAPER/risques/frais, rapport de vérification existant, état Windows UTC et empreintes de fichiers source/binaire. Il n’ouvre pas MT5, n’appelle pas le service local et ne recrée pas un challenge manquant.

```bat
powershell.exe -NoProfile -File "src\mt5_bridge\controler_preparation_paper.ps1" -ObserverUTC
```

À n’utiliser que si MT5 et la passerelle sont **déjà** ouverts et l’état observé STOPPED, sans position, sans erreur stockage. Sept lectures espacées sur environ 180 secondes comparent les réponses de `/ftmo/state`, `/ftmo/clock-evidence` et `/ftmo/feed`, le compte/convention/fraîcheur et les valeurs financières en mémoire. Ces GET ne contiennent aucun START/STOP/RESET/VERIFY. Attention : `/ftmo/feed` appelle `test_connection()`, charge l’historique MT5 requis et actualise le `feed`/`connected` en mémoire, sans écrire le registre, sans trading, et sans backtest. Ce n’est donc pas strictement sans effet sur la télémétrie du worker ni le cache de données du terminal.

**Ne pas choisir l’observation distante si la position du registre n’est pas nulle.** Le diagnostic l’interrompt plutôt que de suivre, marquer ou clôturer la position. Aucun script ne lance ou compile l’observateur MQL5.

Chaque collecte écrit un JSON neuf sous `%LOCALAPPDATA%\TradeBotIA\diagnostics-paper`, séparé du registre et des historiques. Le rapport évite les ticks bruts et les listes d’historique; il contient toutefois des paramètres financiers, compteurs, chemins et hashes à traiter comme données privées. Code retour `0` signifie que les checks codés ont été observés, pas que le bot est prêt; `2` indique blocage/collecte incomplète. Le script PowerShell n’a pas été exécuté ni analysé par PowerShell ici.

Les commandes et scripts sont préparés, mais **n’ont pas été exécutés dans cette session**.

## Verdict

**NON PRÊT.** Tests et build rapportés réussis = preuves logicielles utiles, insuffisantes pour la préparation live du worker Paper. Continuer de conserver PAPER exclusivement, LIVE OFF, aucun bot démarré et aucun ordre envoyé. Les points non validés ci-dessus empêchent toute déclaration de préparation. Aucun backtest historique ne doit être relancé pour cette revue.
