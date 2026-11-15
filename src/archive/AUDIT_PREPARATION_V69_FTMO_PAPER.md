# Audit de préparation V69 — première simulation PAPER FTMO 20K

## Verdict

**NON PRÊT au démarrage automatique continu. Maintenir STOPPED.** Une simple validation ponctuelle des cotations MT5 ne suffit pas à lever les blocages décrits ci-dessous.

Audit statique des sources présentes. Aucun moteur exécuté, bot démarré, ordre envoyé, replay/backtest/autotest relancé, connexion Windows testée ou registre modifié. Le nom V69 désigne la cible demandée, pas une version de binaire Windows certifiée. Seul ce rapport est ajouté ; aucun correctif de fonctionnement n’est appliqué dans cette intervention.

## 1. Stratégie principale — présente, état Windows non certifié

Sources : `src/ftmo/core.py::new_state`, `src/ftmo/frozen.py::frozen_signal`, `src/ftmo/reference/lab/run_filters.py`, `src/lib/ftmo-api.ts`.

- Nouveau challenge : `tpR=2.5`.
- Lecture des expressions originales GOLD M15 via AST, candidat `break8 / H4_D1_mom / atr / 2.5`, filtres `EMA50_200` et `M30_CONFIRM`. Aucune grille de recherche exécutée par ce lecteur.
- Timeout existant : 32 bougies M15 ; TP calculé avec le `tpR` du registre. La variante 5R n’est pas sélectionnée par l’interface active.
- Limite : le serveur vérifie version/PAPER/LIVE OFF au chargement, mais ne verrouille pas explicitement `tpR == 2.5` dans un registre préexistant. Le schéma du navigateur le refuse s’il diffère, sans constituer une protection du moteur Python. Le contenu réel de challenge.json n’a pas été inspecté ici.

**Conclusion : configuration par défaut conforme ; invariant serveur de registre et état effectif à confirmer avant autorisation.**

## 2. Risque et position unique — mécanismes présents, pas une garantie de perte maximale

Sources : `core.py::volume`, `ftmo_service.py::observe`.

- Dimensionnement : risque prévu au plus `equity × 0.005`, frais estimés compris. Sur 20 000 € d’equity : 100 €.
- Le budget varie avec l’equity : ce n’est pas un plafond fixe permanent de 100 €. Aucun changement de cette règle n’est proposé ici.
- Arrondi du volume vers le bas selon le pas MT5 ; volume inférieur au minimum refusé ; plafond du contrat et marge simulée à levier 1:20 pris en compte.
- Un seul objet `position`, nouvelle entrée uniquement s’il est nul, mutations sérialisées par le verrou du service.
- Le risque prévu inclut stop, spread courant, deux slippages, deux commissions et une réserve de swap défavorable sur trois nuits.
- Pas de garantie de perte effective limitée à 100 € : gaps, spread futur plus large, variation du change et conservation au-delà de la réserve de swaps peuvent dépasser l’estimation.

**Conclusion : 0,5 % de l’equity et position unique implémentés, non validés par un essai de cette intervention.**

## 3. Limites FTMO et positions ouvertes — présentes avec limites de surveillance

Sources : `core.py::{limits,reset_day,mark}`, `ftmo_service.py::observe`.

- Capital initial par phase : 20 000 €.
- Perte quotidienne : equity comparée à `dayBase − 1 000 €` ; base quotidienne = solde lors du changement de date Europe/Prague, avec DST IANA.
- Plancher total fixe : 18 000 €.
- Equity d’une position ouverte : solde + P&L de liquidation simulé au BID/ASK selon le sens, slippage et commission de sortie estimée inclus. Swaps et commission d’entrée affectent déjà le solde.
- Franchissement : état FAILED, entrées arrêtées et clôture virtuelle prévue dans observe.
- La comparaison est strictement « inférieur » avec tolérance numérique de 1e-6 : être exactement sur le plancher ne déclenche pas l’échec dans ce code.
- Surveillance par polling toutes les deux secondes, pas chaque tick. Les excursions entre lectures ne sont pas garanties détectées. Une interruption est enregistrée, mais pas reconstruite rétroactivement.
- Le reset se produit au premier échantillon du nouveau jour, pas via un instantané indépendant garanti à minuit. En cas de trou de suivi, le solde exact de minuit ne peut pas être certifié.
- Aucune réservation explicite de toute la perte potentielle du prochain trade sur la marge quotidienne/totale restante. Le moteur peut ouvrir près d’une limite, puis l’arrêter sur equity observée ; ce n’est pas un refus préventif systématique.

**Conclusion : valeurs et contrôle du latent présents ; conformité FTMO continue non certifiable, en particulier pendant une interruption.**

## 4. Spread, commissions, swaps et slippage — modèle présent, calibration bloquante

Source : `ftmo_service.py::{market,observe,close_position}`, `core.py::volume`, `bridge.py::FTMOStart`.

- Spread réel du tick : ASK − BID, pas un spread historique fixe. Achat à ASK, vente à BID ; liquidation inverse.
- Commission : USD/lot/sens, débit à l’entrée puis à la sortie, conversion EUR/USD du flux. Valeur par défaut : 3 USD/lot/sens ; c’est une hypothèse, pas une lecture des frais effectifs FTMO.
- Slippage : USD/oz/sens, défavorable à l’entrée et à la sortie. Défaut 0,05 ; hypothèse de simulation, pas mesure des fills réels.
- Swaps : montants signés saisis explicitement en USD/lot/nuit, heure UTC de rollover requise. Le champ MT5 brut n’est pas converti automatiquement de points vers USD. Jour triple lu dans les spécifications MT5.
- Réserve de risque : trois nuits de swap défavorable ; durée réelle potentiellement supérieure, notamment en cas d’interruption.
- Les swaps manqués sont estimés avec le flux de change et les spécifications disponibles à la reprise, pas avec les cotations historiques exactes de chaque nuit. L’heure UTC de rollover est saisie, non ajustée automatiquement au DST du broker.
- Le registre mémorise les swaps appliqués via `lastSwap`. Les coûts sont figés si une position est ouverte.
- Le brouillon de frais de Paramètres n’est pas sauvegardé/appliqué avant le démarrage. Les valeurs effectives du registre et la calibration FTMO n’ont pas été vérifiées sur Windows.

**Conclusion : calculs présents ; commissions, swaps, unité du swap, jour triple et rollover FTMO doivent être confirmés. Ne pas présenter les défauts comme les frais officiels du compte.**

## 5. Sauvegarde automatique — présente, défaillance d’écriture non sécurisée complètement

Sources : `ftmo_service.py::{save,loop,close_position}`.

- Persistance dans `%LOCALAPPDATA%/TradeBotIA/ftmo20k/challenge.json` (repli Path.home() si LOCALAPPDATA absent).
- Sauvegarde complète après chaque cycle actif, START, STOP et arrêt normal du service : solde, equity, position, transactions clôturées, événements de trésorerie, swaps, phases, lastSignal et courbe.
- Écriture dans `.tmp`, flush, fsync, puis remplacement atomique du fichier principal. Les gains/pertes restent déductibles des transactions et événements ; ce n’est pas une sauvegarde extérieure automatique séparée.
- **Blocage technique :** `self.save()` est hors du try/except dans loop. Une erreur disque/permissions peut terminer le thread sans enregistrer un arrêt et peut laisser `running=True` en mémoire. L’interface n’expose pas de heartbeat du worker.
- START modifie la mémoire avant sa sauvegarde ; un échec de save peut donc produire une erreur HTTP tout en laissant l’état mémoire actif. Aucun test de panne d’écriture exécuté ici.

**Conclusion : persistance normale implémentée ; pas de garantie de sécurité en cas de panne disque.**

## 6. Redémarrage et doublons — mécanismes favorables, « exactement une fois » non démontré

Sources : `ftmo_service.py::{__init__,start,observe,loop}`, `bridge.py::lifespan`.

- Si challenge.json existe, il est relu ; un JSON invalide ne déclenche pas silencieusement une nouvelle simulation.
- `running=False` au chargement ; solde, transactions et position existants conservés. Un nouveau capital n’est créé automatiquement que si le fichier attendu est absent ; mauvaise identité Windows/dossier absent peut donc donner un autre registre, pas une preuve de reset du précédent.
- `lastSignal` persistant et position unique limitent les réentrées ; START ignore le signal déjà en cours, sans rattrapage rétroactif.
- Le thread reprend le suivi d’une position existante même avec le bot STOPPED ; STOP signifie arrêt des entrées, pas gel garanti de toutes les écritures/sorties virtuelles.
- Pas de journal transactionnel séparé, identifiant d’idempotence durable par transaction ou verrou interprocessus du fichier. Un crash avant la sauvegarde peut perdre les dernières mutations ; plusieurs processus/utilisateurs ne sont pas couverts par le seul RLock.
- La garde « ancienne position » vérifie le symbole XAUUSD, pas un identifiant de convention temporelle : elle ne démontre pas qu’une position XAUUSD enregistrée avant normalisation utilise la même base UTC.

**Conclusion : conservation en redémarrage normal prévue ; absence absolue de doublons/pertes après crash, disque plein ou changement d’environnement non validée.**

## 7. Refus de démarrage — protections réelles, chaîne incomplète

Sources : `ftmo_service.py::start`, `time_basis.py`, `bridge.py::{ftmo_feed,ftmo_start}`, `verify.py::implementation_hash`.

- START refuse un challenge terminé, un bot déjà actif et un rapport moteur non PASSED/non courant.
- START appelle market : terminal ouvert et connecté, compte DEMO FTMO-Demo, XAUUSD, contrat valide, XAUUSD/EURUSD disponibles, UTC et ticks frais obligatoires. Les ticks futurs ou plus vieux de 15 s sont refusés après normalisation.
- La normalisation exige un relevé natif v2 du même compte/serveur, non tester, et une règle annuelle DST confirmée pour SERVER_WALL. Aucun offset appris de l’âge du tick.
- **Blocage majeur pour l’autonomie :** la preuve expire au bout de 120 s, est relue à chaque cycle et n’est pas renouvelée automatiquement. Le suivi s’arrêtera à expiration, y compris avec position virtuelle ouverte si le flux reste bloqué. La correction actuelle vise un test ponctuel, pas une session automatique continue prête.
- `/ftmo/feed` vérifie les autotests et les historiques complets ; `/ftmo/start` appelle seulement market, pas test_connection ni la suite d’autotests. Valider le flux une fois n’est donc pas un prérequis durable imposé par START pour toutes les unités nécessaires.
- START ne remesure pas l’equity ni les marges FTMO avec la position avant de passer running à vrai. Les limites sont examinées ensuite dans observe.
- Le hash de validité du rapport inclut core/frozen/verify/ftmo_service/archive, mais pas time_basis.py/quote_time.py ni tous les adaptateurs. PASSED ne prouve pas à lui seul la validité du chemin UTC actuel.
- L’interface ne propose actuellement aucun démarrage actif : le bouton est désactivé. L’endpoint POST existe mais n’a pas été appelé.
- Un rapport historique PASSED encore compatible peut être relu sans relancer les backtests. Si STALE/NOT_RUN, l’audit ne le transforme pas en PASSED et ne relance rien pour le débloquer.

**Conclusion : refus MT5/UTC/ticks bien présent ; préparation continue et contrôle complet au démarrage non démontrés.**

## 8. Tableau de bord — lisible, pas encore une checklist de préparation fiable

Sources : `pages/Index.tsx`, `pages/FTMO20K.tsx`, `pages/ConnectionMT5.tsx`, `pages/Settings.tsx`.

Présent : stratégie 2,5R, capital de référence, risque, position unique, PAPER/LIVE OFF, running/STOPPED, état connecté rapporté, erreurs de lecture/action/registre, avertissement de suivi interrompu, métriques et bouton « Démarrage PAPER suspendu ».

Manquant pour un feu vert de préparation : statut consolidé de validité UTC et expiration, fraîcheur XAUUSD/EURUSD en continu sur le dashboard, calibration des frais, test de stockage, heartbeat du worker, preuve de reprise sans doublon et résultat du contrôle complet de démarrage.

Deux nuances importantes : sans registre reçu, l’étiquette affiche BOT STOPPED par défaut, ce qui ne prouve pas l’état du processus distant ; `connected` dans snapshot ne recalcule pas la fraîcheur des ticks et peut rester vrai après un ancien test alors que le bot est arrêté. Ces libellés ne suffisent pas à autoriser START.

**Conclusion : blocages partiellement visibles ; ne pas annoncer « prêt » sur la seule mention connecté ou STOPPED du dashboard.**

## Priorités bloquantes avant une autorisation de démarrage ultérieure

1. Démontrer la normalisation réelle et son maintien sûr pendant toute la session, sans expiration qui coupe le suivi d’une position ; confirmer la règle annuelle FTMO si nécessaire.
2. Sécuriser la défaillance de sauvegarde et rendre visible l’état du worker ; démontrer la reprise du registre sans perte/doublon dans les scénarios visés.
3. Confirmer les coûts et le registre effectifs, notamment tpR=2.5, mode PAPER, LIVE OFF, absence de position issue d’une autre base temporelle.
4. Établir un contrôle complet de démarrage et une checklist de préparation ; les cotations seules ne sont pas suffisantes.
5. Contrôler les limites pratiques du polling, des swaps et de la marge FTMO disponible. Toute correction touchant aux règles de stratégie/risque doit faire l’objet d’une décision distincte ; aucun changement de ce type dans cet audit.
6. Conserver le démarrage suspendu tant que ces points ne sont pas résolus et validés. Ne pas relancer un ancien backtest pour produire artificiellement un feu vert.

## Garanties de cette intervention

Uniquement lecture des sources et rédaction du rapport. Aucun fichier de moteur, paramètre, historique, résultat, interface ou registre existant modifié ou supprimé. Aucun accès de trading effectué. Recherche dans les fichiers Python de passerelle : aucun appel order_send/order_check/login trouvé. Aucune exécution de test Python, compilation, redémarrage de passerelle ou simulation effectuée ; l’état réel du PC Windows n’est pas certifié par cet audit.
