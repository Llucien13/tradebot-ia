# V71 — corrections UTC / persistance PAPER

## Verdict

**NON PRÊT. Démarrage suspendu. Corrections de sources, non certifiées par exécution.** Aucun bot, observateur natif, ordre MT5, backtest, replay ou vérification historique n’a été lancé pendant cette intervention. Aucun registre utilisateur n’a été ouvert ou modifié.

## Périmètre des fichiers

| Fichier | Modification |
|---|---|
| `src/mt5_bridge/paper_storage.py` (nouveau) | Verrou exclusif interprocessus Windows/POSIX, validation du checkpoint, écritures atomiques |
| `src/mt5_bridge/ftmo_service.py` | Checkpoints cohérents, rollback mémoire, arrêt verrouillé après panne, maintien explicite des positions, provenance temporelle, heartbeat |
| `src/mt5_bridge/bridge.py` | Journalisation des échecs d’initialisation/arrêt, libération du verrou après arrêt du worker |
| `src/mt5_bridge/TradeBotClockProbe.mq5` | Relevés natifs répétés toutes les 30 s, publication via fichier temporaire ; lecture seule |
| `src/mt5_bridge/test_paper_safety.py` (nouveau) | 18 tests synthétiques de persistance, worker et reprise |
| `src/mt5_bridge/test_utc_renewal.py` (nouveau) | 5 tests synthétiques UTC |
| `src/lib/ftmo-api.ts` | Contrat des statuts worker/stockage/position et échéance UTC |
| `src/pages/FTMO20K.tsx` | Affichage de ces statuts et avertissements de valorisation figée |
| `src/mt5_bridge/HORODATAGES.md` | Documentation du renouvellement et des limites |
| Ce rapport (nouveau) | Périmètre, contrôles et validations restantes |

## UTC

Le source natif produit un nouveau relevé toutes les 30 secondes, tant que l’observateur est actif. Aucun observateur n’est démarré ici. L’ancien `.ex5` n’a pas été recompilé : il ne contient pas ce renouvellement.

La validation existante de `time_basis.py` reste inchangée et obligatoire à chaque série de lectures : identité compte/serveur, DEMO FTMO, hors tester, horloges natives, ticks natifs croisés avec Python, bougies M15, cohérence secondes/millisecondes, calendrier IANA confirmé pour SERVER_WALL. Seule une nouvelle capture native intégralement acceptée renouvelle l’échéance. Aucun prolongement local de l’ancienne preuve, aucun offset arbitraire, aucun tick Python utilisé pour recréer une preuve native.

Les seuils ne sont pas assouplis : preuve valable 120 s ; ticks Python normalisés âgés de 0 à 15 s inclus ; toute avance refusée. La publication native temporaire ne constitue pas une validation : toute incohérence ou lecture partielle reste bloquante.

Au défaut, les mutations partielles du cycle sont annulées, les entrées arrêtées et la position maintenue sans cotation/clôture inventée. `SAFE_STOP`, `HELD_UNPRICED`, cause, heartbeat et dernière observation sont exposés. Le suivi ne reprend pas automatiquement après ce défaut. Le renouvellement ne démontre pas la règle annuelle FTMO ni la synchronisation réelle de Windows.

Une nouvelle position mémorise la convention, le fuseau et le compte/serveur. Une position ancienne sans cette provenance ne reçoit pas une provenance inventée : sa reprise est refusée. Au redémarrage, une position restaurée reste figée jusqu’à reprise explicite compatible ; le bouton de démarrage reste suspendu.

## Persistance et reprise

- Un seul processus peut détenir le registre à un même chemin. Le verrou OS est libéré à la mort du processus ; pas de fichier sentinelle dont l’existence seule bloquerait une reprise.
- Capital, position, transactions, événements de trésorerie, swaps, historique, courbe et `lastSignal` appartiennent au même checkpoint JSON.
- Validation PAPER/LIVE OFF, valeurs de capital finies, listes historiques et absence de doubles transactions par clé `(phase, signalTime)`. La même clé ne peut être à la fois clôturée et ouverte.
- Écriture temporaire, flush, fsync et remplacement atomique conservés. Synchronisation du répertoire ajoutée sur POSIX. L’archivage préalable à RESET utilise également un checkpoint atomique.
- JSON invalide, refus de lecture ou checkpoint initial interrompu : aucune création silencieuse d’un nouveau capital à sa place.
- START est sérialisé et ne publie pas d’état actif si la sauvegarde échoue : rollback au dernier état mémoire confirmé, `running=False`, verrouillage du stockage pour toute la session.
- Les erreurs de sauvegarde du cycle ne sortent plus sans contrôle du worker. Même un thread présent ne signifie pas que le suivi est actif : le statut et le heartbeat sont distincts.
- Après panne de stockage, aucune nouvelle mutation métier ni tentative de START/RESET n’est autorisée ; cause journalisée via Python logging et exposée dans l’API.
- Une erreur après remplacement mais avant confirmation de durabilité peut laisser le fichier complet ancien OU nouveau selon le point de panne. La session est alors verrouillée ; l’affichage reste le dernier état confirmé en mémoire et ne certifie pas le contenu disque. À la reprise, le checkpoint complet effectivement lisible est restauré, sans rejouer les mutations en mémoire perdues.
- Le système n’invente pas les observations survenues pendant une interruption. Une mutation non commitée peut être perdue ; elle n’a pas été exposée comme transaction durable ni envoyée à un broker. Ce mécanisme n’est pas une garantie universelle contre la destruction du disque ou une coupure matérielle Windows.
- La cause est envoyée au journal du processus ; une panne disque ne permet pas de garantir une copie durable supplémentaire de ce journal.

## Tests : résultats exacts disponibles

**Exécution indisponible dans cet environnement : aucun outil de terminal/Python/compilation/accès MT5 n’est disponible. Aucun résultat de réussite n’est inventé.**

| Suite nouvelle | Tests définis (comptage statique) | Exécutés | Réussis constatés | Échoués constatés | Non exécutés |
|---|---:|---:|---:|---:|---:|
| `test_utc_renewal.UTCRenewalTests` | 5 | 0 | 0 | 0 | 5 |
| `test_paper_safety.PaperSafetyTests` | 18 | 0 | 0 | 0 | 18 |
| Total | **23** | **0** | **0** | **0** | **23** |

Zéro échec constaté ne signifie PAS réussite : les 23 tests sont NON EXÉCUTÉS. Les suites préexistantes `test_quote_time.py` et `test_time_basis.py` n’ont pas non plus été exécutées ici. Pas de compilation TypeScript ni MQL5 effectuée.

Cas préparés : expiration malgré tick Python frais ; nouveau relevé natif valide ; règle DST non confirmée ; révocation/JSON partiel sans cache ; fraîcheur 15 s et avance ; restauration exacte capital/position/historique ; crash avant/après remplacement ; absence de réapplication après relecture ; JSON corrompu ; lecture et écriture refusées ; premier commit interrompu ; concurrence interprocessus ; doublons ouverts/clôturés ; capital non fini ; échec du checkpoint START ; fsync défaillant ; position conservée à expiration ; annulation d’observation partielle ; panne d’écriture dans le cycle ; redémarrage avec position maintenue sans lancer de thread ; rapport de vérification illisible.

Ces suites utilisent des données synthétiques et des répertoires temporaires. Le test de START simule uniquement la méthode avec flux et rapport factices : il n’active aucun thread ni terminal. Le test de construction neutralise l’extraction des références et le calcul du hash. Aucun appel de backtest n’appartient à ces suites.

## Contrôles statiques effectués

- Relecture des chemins de sauvegarde, initialisation, cycle, arrêt et des tests ajoutés.
- Recherche des définitions : 18 + 5 méthodes de tests ciblés.
- Recherche de `order_send` / `order_check` dans les sources Python/TypeScript : aucune occurrence retournée.
- Bouton de démarrage suspendu conservé dans `src/pages/Index.tsx` (fichier non modifié).
- Aucun fichier `src/ftmo/core.py`, `frozen.py`, moteur de référence, expression GOLD M15, archive de backtests ou résultat historique modifié par cette intervention. Les formules de volume, risque 0,5 %, limites FTMO, TP 2,5R, timeout et coûts sont conservées. Les seuls ajouts dans la création de position concernent sa provenance temporelle.
- Aucun accès au registre réel ; aucune comparaison Git ou empreinte binaire avant/après exécutable n’a été possible. La préservation ci-dessus décrit le périmètre des éditions, pas une certification indépendante du poste Windows.

## Validations bloquantes restantes

1. Exécuter les 23 nouveaux tests et les suites UTC existantes dans un environnement Python compatible ; conserver la sortie exacte et corriger tout échec avant autorisation. Ne pas appeler `verify.py` ni relancer les anciens backtests pour cette étape.
2. Compiler le nouveau `.mq5` et confirmer son comportement de lecture seule sur Windows ; le binaire présent reste ancien. Démontrer la règle annuelle FTMO et la synchronisation Windows sans calendrier supposé.
3. Valider réellement NTFS/permissions/disque plein, verrou entre processus distincts, crash avant/après remplacement et restauration du capital, position et historique. Les mocks ne constituent pas une preuve de résistance à une coupure électrique.
4. Vérifier le rendu TypeScript et l’affichage d’arrêt, de heartbeat ancien, d’erreur disque et de position non valorisée.
5. Traiter les autres blocages de l’audit : frais réels, invariant serveur du registre 2,5R, contrôle complet de démarrage, couverture du hash, limites polling/minuit/swaps/marge FTMO. Ils ne sont pas déclarés corrigés par V71.
6. Maintenir PAPER exclusivement, LIVE OFF et démarrage suspendu. Ne pas déclarer le bot prêt avant validation de tous les blocages.
