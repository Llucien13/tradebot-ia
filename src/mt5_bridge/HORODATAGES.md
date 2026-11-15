# Normalisation UTC FTMO — validation obligatoire

## Essai PAPER V81 : conventions et précision de capture

L’essai valide séparément XAUUSD et EURUSD avec les horloges natives et les M15 du relevé existant. Une convention distincte par symbole est autorisée uniquement si chaque comparaison la démontre; `timeBasis.symbolEncodings` en conserve la provenance. Les erreurs distinguent désormais la tentative UTC directe de l’échec de la base prouvée. Les règles du challenge restent inchangées.

`TimeGMT` et les horloges natives sont quantifiés à la seconde : une avance inférieure ou égale à 1 s est tolérée uniquement pour identifier la convention du relevé, pas pour consommer un tick futur. Si le tick Python est identique au tick natif vérifié et présente au plus 0,5 s d’avance sur la passerelle, une attente bornée laisse l’horloge le rattraper. Le timestamp n’est jamais retouché. Le contrôle final exige toujours un âge de 0 à 15 s pour les deux ticks; si l’horloge reste en retard, le flux est refusé. Un tick différent de celui de la capture ne bénéficie pas de cette attente. La limite de 0,5 s borne l’attente à une demi-seconde, sans élargir le seuil de fraîcheur.

Les tests ciblés sont raccordés à « Relevé croisé + autotests » existant. Ils couvrent les conventions mixtes, l’avance de 274 ms, les bornes 500/501 ms, un tick futur sans preuve, une horloge restant en retard, les preuves expirées et les M15 incohérentes. Leur exécution Python et les mesures MT5 doivent être confirmées sur Windows; elles ne sont pas certifiées par une lecture du code.

Après mise à jour, arrêter les entrées PAPER, fermer la fenêtre de la passerelle puis relancer une seule fois `start_mt5_bridge.bat`. Garder MT5 et l’observateur natif existant ouverts. Ne pas redémarrer le serveur React : cela ne recharge pas Python.

## Correction implémentée

`time_basis.py` est la base commune des lectures actives FTMO et de l’essai PAPER : ticks XAUUSD et EURUSD, bougies de toutes les unités, comparaison tick/bougie M15 et comptage des bougies de timeout. Aucun fichier historique, backtest, formule de risque ou expression de signal n’est réécrit.

L’essai tente d’abord l’interprétation Unix UTC directe. Si elle échoue, le relevé natif compare `TimeGMT`, `TimeTradeServer`, `TimeCurrent`, `time` et `time_msc` XAUUSD/EURUSD. Le mode AUTO identifie si les ticks correspondent à l’horloge GMT ou à l’horloge serveur. La passerelle vérifie ensuite les ticks et bougies Python, l’identité compte/serveur, les unités et la fraîcheur. La voie directe UTC de l’essai n’exige donc pas le relevé FTMO; seule une conversion serveur nécessite la preuve native démontrant cette convention.

- Convention UTC démontrée : pas de conversion.
- Convention heure murale serveur démontrée : conversion date par date avec `zoneinfo`, uniquement si la règle complète DST du serveur est explicitement confirmée et documentée.
- Fuseau non confirmé, contradiction avec l’offset natif courant, preuve expirée, heure locale ambiguë/inexistante au changement d’heure : lecture refusée.
- Après normalisation : tick âgé de plus de 15 secondes ou situé dans le futur, même de moins de 5 secondes, refusé. Les bougies futures et non strictement chronologiques sont refusées. Les barres historiques restent naturellement anciennes ; elles ne sont pas présentées comme des cotations fraîches.

Le GMT+3 d’octobre 2026 confirmé par l’utilisateur ne démontre pas la règle annuelle : plusieurs calendriers DST peuvent partager cet offset à cette date. Aucun fuseau Europe/Paris, Europe/Prague, Europe/Helsinki ou calendrier américain n’est présumé être celui de FTMO. Le fuseau Helsinki des tests est exclusivement une fixture synthétique de test.

## Seule preuve restante pour autoriser la conversion sur le terminal

Un **relevé natif version 2 de ce terminal FTMO-Demo, accompagné de la règle annuelle FTMO confirmée**. Cet ensemble doit identifier le fuseau IANA correspondant à la règle complète ; une confirmation de l’offset d’octobre uniquement ne suffit pas. Les tests synthétiques ne valident pas ce choix pour le broker.

La confirmation est une entrée explicite locale, pas une information que le programme peut certifier vraie en lisant un texte. Le contrôle de cohérence de l’offset actuel ne prouve pas à lui seul le calendrier annuel. Ne pas renseigner une règle supposée simplement pour obtenir un test vert.

## Produire et utiliser le relevé Windows

1. Fermer uniquement la fenêtre Python de la passerelle et relancer `start_mt5_bridge.bat`, MT5 restant ouvert. Le rechargement de React ne recharge pas Python.
2. Dans MT5 : **Fichier → Ouvrir le dossier des données**. Copier le script mis à jour `src/mt5_bridge/TradeBotClockProbe.mq5` dans **MQL5 → Scripts** de ce terminal.
3. Compiler avec MetaEditor. Exécuter le script depuis **Navigateur → Scripts** sur le compte FTMO-Demo. Le script n’utilise aucun appel de trading ; ne pas activer le trading automatique pour cela.
4. Laisser `Encoding=AUTO`. Laisser les champs de règle vides et la confirmation à faux tant que la règle annuelle n’est pas confirmée par FTMO. Lorsque cette preuve est acquise, renseigner `ConfirmedIANATimezone`, `PolicySource` (référence de la confirmation complète) et `FullDSTRuleConfirmed=true`.
5. Dans les deux minutes, cliquer **Relevé croisé + autotests**. Le résultat indique la normalisation autorisée ou le motif précis du blocage. **Tester le flux FTMO / MT5** utilise la même validation et relance les autotests avant toute validation du flux.

### V71 — renouvellement natif, non activé par cette intervention

Le source du script capture désormais de nouvelles horloges et de nouveaux ticks natifs toutes les 30 secondes tant que l’observateur est actif. Il publie via `tradebot-clock-proof.tmp` puis remplacement de `tradebot-clock-proof.json`. Il ne démarre aucun bot PAPER et ne contient aucun appel d’ordre. **Le fichier `.ex5` existant n’a pas été recompilé et ne représente pas cette modification.** La compilation et la vérification sur Windows restent obligatoires ; aucun observateur n’a été lancé ici.

La preuve est relue et intégralement revalidée à chaque série de lectures, avec expiration inchangée à 120 secondes. Elle n’est jamais remplacée par un offset en cache ni prolongée à partir des ticks Python. Seul un nouveau relevé natif cohérent avec le compte, les ticks, les bougies et la convention démontrée peut renouveler l’échéance. Une preuve illisible, périmée ou contradictoire n’est pas ignorée au profit d’une ancienne preuve.

Au défaut UTC, le worker arrête les entrées et le suivi, conserve la position PAPER et la dernière valorisation sauvegardée, et expose `SAFE_STOP` / `HELD_UNPRICED`. Il ne fabrique ni tick ni clôture. La reprise n’est pas automatique après ce défaut. Les nouvelles positions mémorisent la convention, le fuseau et l’identité compte/serveur ; une ancienne position sans cette provenance reste bloquée, sans migration supposée. Au redémarrage, une position restaurée reste également conservée sans valorisation nouvelle jusqu’à une reprise explicite avec base compatible. Le bouton de démarrage demeure suspendu.

`TimeGMT` dépend de Windows et `TimeTradeServer` est estimé par le terminal : Windows doit être synchronisé avec une référence UTC. Le relevé natif n’est pas une attestation indépendante du bon réglage de l’horloge système. Le calendrier annuel FTMO doit toujours être démontré ; le renouvellement ne le démontre pas à lui seul.

## Autotests

`run_clock_tests()` exécute les suites `test_quote_time.py`, `test_time_basis.py` et `test_paper_trial_time.py` lors du relevé ou du test du flux. Elles couvrent l’identification UTC/heure serveur par horloges indépendantes, la conversion datée, XAUUSD et EURUSD à GMT+2, les âges synthétiques 0,256 s et 2,161 s, l’alignement M15, les seuils inchangés, les preuves manquantes/expirées/contradictoires, et le refus de ticks futurs/anciens. Un échec empêche de valider le flux. Les tests synthétiques ne prouvent pas la convention sur le terminal réel.

L’environnement d’édition utilisé pour cette modification ne dispose pas d’un exécuteur Python ni d’un accès au terminal Windows. Les tests ont été ajoutés et raccordés au contrôle obligatoire, mais **leur exécution et leur réussite ne sont pas annoncées comme acquises**. Le résultat détaillé réel sera fourni par la passerelle Windows.

## Contrats et protections conservés

- `/status.quote.time` et `/candles[].time` : millisecondes UTC ; flux FTMO : secondes UTC.
- Les anciens appels et backtests XAUUSD-ECN VT Markets restent bruts et inchangés.
- GOLD M15 2,5R et variante historique 5R : aucune règle modifiée. Le changement concerne la base temporelle des lectures en mémoire, pas les expressions de stratégie.
- PAPER uniquement, LIVE désactivé, démarrage suspendu dans l’interface, STOP conservé. Aucun ordre, optimisation ou backtest lancé par cette correction.
- Aucune conversion rétroactive des registres existants. Une position d’une ancienne base temporelle ne doit pas être reprise automatiquement.
