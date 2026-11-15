# Suivi Shadow XAUUSD — isolé et sans ordres

## Périmètre

`scripts/run-gold-xauusd-shadow.mjs` interroge uniquement les routes locales `GET /candles` de la passerelle déjà disponible, avec `symbol=XAUUSD`, pour M15, M30, H4 et D1. Il refuse tout hôte non local, toute redirection HTTP, flux non marqué `readOnly` ou `closedBarsOnly`, symbole différent, OHLC invalide, doublon, réponse réseau périmée ou requête interrompue. La dernière M15 doit dater de moins de 40 minutes; les séries M30/H4/D1 peuvent rester plus anciennes pendant une fermeture de marché, mais leurs horaires/trous restent contrôlés et journalisés. Il ne démarre ni ne contrôle la passerelle, et ne lit pas `/status`, `/ftmo/feed` ou les routes PAPER/FTMO.

La route de bougies utilise des chandelles clôturées uniquement. Le code historique GOLD est réutilisé pour les signaux M15 et ses confirmations M30/H4/D1. GOLD + SMC est filtré par le module SMC expérimental existant (`EXPERIMENTAL_NOT_HISTORICAL`), sur le même historique et les mêmes clôtures. Le prix d'entrée théorique est l'ouverture constatée de la bougie M15 suivante; aucun signal ne consomme sa clôture ou des bougies postérieures. Parce que le flux ne révèle pas la bougie en formation, cette ouverture n'est observable qu'après la clôture suivante; le journal inclut le délai et le suivi est donc rétrospectif d'une bougie, pas une alerte instantanée.

Chaque comparaison expose aussi deux candidats facultatifs à titre expérimental : GOLD + Fibonacci et GOLD + SMC + Fibonacci. Les quatre variantes partagent les mêmes signaux GOLD sous-jacents, clôtures et bougies d'exécution. SMC/Fibonacci ne sont pas des filtres obligatoires pour la référence GOLD et leurs règles ne sont pas historiques vérifiées.

Le journal JSONL est append-only, synchronisé sur disque à chaque événement, reprend les identifiants déjà écrits après redémarrage, refuse les lignes corrompues/doublons et utilise un verrou exclusif afin de bloquer deux runners simultanés. Il contient les comparaisons, horodatages, empreinte SHA-256 des historiques, événements de trous, erreurs et reprises. Le premier démarrage pose un point de départ et ne journalise pas les trous de l’historique de chauffe. Ensuite, les trous observés sont consignés comme « fermeture de marché ou cotations manquantes » sans prétendre les distinguer faute de calendrier de sessions XAUUSD vérifié.

Une réponse HTTP non réussie (dont 503) est traitée comme une interruption : aucune donnée de repli n'est utilisée et le runner réessaie au cycle suivant. Le début et la reprise de l'interruption sont journalisés; la preuve d'horloge MT5 doit être restaurée uniquement selon la procédure existante, sans ajustement artificiel.

## Limites financières et de préparation

`GET /candles` ne fournit pas la taille du contrat, la valeur/taille du tick, les devises, les minimum/maximum/pas de volume, les frais complets, le slippage ni la marge. Le runner inscrit donc pour tout signal un budget indicatif de 100 EUR (0,5 % du capital théorique initial de 20 000 EUR), **refuse le dimensionnement**, laisse le volume et les coûts à `null` et n'invente pas de résultat simulé. Le capital courant et le risque ne sont pas recalculés, car aucun PnL vérifiable n'est produit. Le spread en points fourni par la bougie est conservé comme observation, pas converti en coût.

Il faut encore obtenir une spécification de symbole et des coûts XAUUSD vérifiés, notamment par une méthode de lecture seule approuvée qui ne touche pas à l'état des moteurs. Aucun adaptateur de spécifications n'est activé par ce runner. Le suivi des trades simulés (SL/TP/expiration, résultats nets, capital courant), les limites de positions virtuelles et une analyse de corrélation de portefeuille ne sont pas activés; seul l'accord/désaccord directionnel des deux stratégies est journalisé. En conséquence ce programme est un collecteur comparatif de signaux Shadow, pas une simulation de compte ni un moteur PAPER.

## Démarrage manuel

Prérequis : lancer préalablement la passerelle locale selon sa procédure habituelle, uniquement si elle est déjà autorisée et dans l'état attendu; ce runner ne la démarre pas. Confirmer d'abord que le GET local de `/candles?symbol=XAUUSD&timeframe=M15&count=10` retourne des bougies clôturées correctes.

Depuis la racine du dépôt sous Windows :

```powershell
node --experimental-strip-types scripts\run-gold-xauusd-shadow.mjs
```

Le processus ne fait que des requêtes HTTP GET vers `127.0.0.1:8765/candles`. Au premier démarrage, il établit un point de départ sur la clôture disponible et ignore les signaux antérieurs; ensuite, chaque nouvelle décision admissible est journalisée une fois. Il s'arrête avec `Ctrl+C`; aucun ordre n'est transmis. L'intervalle de scrutation peut être défini par `GOLD_SHADOW_POLL_MS` (minimum 5000 ms). Le journal est créé sous `src\ftmo\reference\resultats\shadow-xauusd-live\shadow-journal.jsonl` et n'écrase aucun rapport antérieur. Un verrou résiduel après arrêt brutal entraîne un refus de démarrer et doit être inspecté manuellement avant toute reprise.

Ne pas considérer le suivi comme opérationnel tant qu'une vraie réponse de la passerelle, la persistance du journal en exécution et la disponibilité de nouvelles bougies n'ont pas été vérifiées. Même alors, le sizing et les résultats financiers restent bloqués tant que les spécifications et coûts vérifiés manquent.

La procédure de reprise détaillée est dans [GOLD_SHADOW_MONDAY_CHECKLIST.md](./GOLD_SHADOW_MONDAY_CHECKLIST.md).
