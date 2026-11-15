# Préparation GOLD M15 2,5R — diagnostic sans replay

## Périmètre

Compte virtuel FTMO 20 000 EUR, PAPER exclusivement. Aucun START, trade, ordre MT5, replay ou deuxième stratégie n'est exécuté par les nouveaux contrôles. LIVE reste désactivé. Aucun changement de `core.py`, `frozen.py`, `verify.py`, `ftmo_service.py`, des paramètres de stratégie ou des résultats historiques.

La route de vérification historique existante reste inchangée : elle relance les quatre replays. Ne pas l'utiliser pour ce diagnostic. Le lanceur ne l'appelle jamais.

## Blocages identifiés par lecture du code

- `FTMOService.report()` renvoie `NOT_RUN` lorsque `%LOCALAPPDATA%\TradeBotIA\ftmo20k\verification.json` n'existe pas. Les JSON de résultats seuls ne constituent pas un rapport de vérification du moteur.
- Un ancien rapport `PASSED` devient `STALE` si son `implementationHash` ne correspond plus au hash attendu par le service. Aucun hash n'est réécrit pour le rendre artificiellement valide.
- `validate_time_basis()` refuse une preuve native future ou âgée de plus de 120 secondes, un autre serveur/login, une capture Strategy Tester, une convention ambiguë ou une règle DST non confirmée. Le diagnostic ne crée/renouvelle aucune preuve.
- Les ticks XAUUSD et EUR/USD doivent avoir un âge UTC signé entre 0 et 15 secondes. Aucun délai n'est assoupli en cas de marché fermé.
- Un worker `STOPPED` doit néanmoins avoir son thread vivant et son heartbeat récent. `PHASE_1` est un statut de challenge, pas de worker.
- Une position existante ou un moteur déjà actif interdit la collecte distante de ce lanceur, pour éviter toute interaction avec une position.

Ces observations sont des constats de code, pas une mesure de l'état du PC Windows.

## Adaptations minimales

1. `src/mt5_bridge/historical_evidence.py` (nouveau) : lecteur standard-library uniquement. Compare octet pour octet les quatre JSON et leurs quatre CSV de transactions à l'archive locale, calcule SHA-256 et contrôle les comptes de transactions/paramètres. N'extrait rien et n'importe aucun moteur historique.
2. Ce lecteur corrobore un rapport **déjà existant** uniquement si son statut, ses tests, ses empreintes, ses quatre preuves de replay, ses résumés et ses contrôles de signaux sont cohérents. Ni import ni création de `verification.json`. Les quatre preuves sont lues, pas rejouées; TP 5R n'est jamais exécuté.
3. `src/mt5_bridge/controler_preparation_paper.ps1` : intègre ce lecteur; un simple `PASSED` ne suffit plus au diagnostic. Contrôle tpR runtime, coûts présents, challenge non terminé, valeurs finies et marges FTMO. Compare registre disque/mémoire et suit aussi les coûts dans l'empreinte financière. Vérifie à nouveau le checkpoint dans `finally`, même après interruption.
4. L'absence de preuve historique est signalée sans masquer les observations indépendantes du worker/UTC/flux lorsque celles-ci peuvent être collectées sans risque. Toute anomalie de sécurité du compte, de la preuve ou du flux arrête la collecte distante.
5. `src/mt5_bridge/controler_preparation_paper.bat` : conserve le menu et ajoute une sélection directe du mode observation ou local. Explique le code 2 et l'absence d'autorisation START.
6. `src/mt5_bridge/test_historical_evidence.py` (nouveau) : neuf tests sur fichiers temporaires (lecture seule, rapport absent, fichiers altérés/absents, archive absente, hash périmé, statut seul, preuve dupliquée, résumé différent, signal en échec).
7. `src/mt5_bridge/test_preparation_diagnostic.py` : ajoute les contrats de preuve indépendante et de relecture du registre après échec.
8. `src/mt5_bridge/valider_diagnostic_v75.bat` : ajoute uniquement ces tests ciblés aux tests de diagnostic existants et au SelfTest isolé. Aucun test de replay n'est appelé.
9. `.vscode/tasks.json` (nouveau) : tâche Windows de tests ciblés, puis tâche d'observation qui en dépend.
10. Le présent rapport.

## Limites de preuve conservées

L'égalité avec l'archive locale ne certifie pas sa provenance externe : aucune empreinte indépendante de confiance n'a été fournie. Le hash historique ne couvre notamment pas toutes les protections UTC/stockage actuelles. Une corroboration du rapport historique ne remplace donc pas une validation complète de préparation.

Le verdict reste `NON_PRET_CONTROLES_PARTIELS`, avec code 2, y compris si les observations réalisées passent. La liste des exigences restantes est conservée dans le rapport (confirmation frais/DST, stockage/reprise, limites de suivi et couverture du hash). Le SelfTest isolé peut seul sortir avec code 0; ce n'est pas un succès de préparation du compte.

Aucun lancement automatique n'est armé. Il ne pourra pas être autorisé sur la seule base de ce diagnostic partiel.

## Vérifications effectivement réalisées ici

- Lecture de la chaîne `bridge.py` → `FTMOService` → `verify.py` et des gardes temporelles; confirmation que la vérification existante appelle bien quatre replays.
- Revue statique des modifications, des imports et des appels du lanceur : uniquement les trois GET locaux autorisés pour l'observation, pas de route d'action. Lecture de l'archive et des rapports uniquement.
- Préparation des tests ciblés et du SelfTest Windows.

**Non exécutés ici** : tests Python, SelfTest PowerShell, calcul des empreintes réelles de l'archive, contrôles du compte MT5, du worker/heartbeat, des cotations et de la preuve native actuelle. Aucun exécuteur Windows/MT5 n'est disponible dans cette session. Aucun résultat de test n'est annoncé comme réussi.

## Prochaine commande dans VS Code (sans terminal shell)

Palette de commandes : **Tasks: Run Task** / **Tâches : Exécuter la tâche**, puis sélectionner **FTMO PAPER : verifier la preparation sans demarrer**.

La tâche exécute d'abord les tests ciblés et le SelfTest; une erreur empêche la tâche d'observation de partir. Les fichiers BAT demandent une touche pour fermer leur étape : les sorties restent visibles dans le terminal de tâche. Si les tests passent, l'observation utilise seulement une passerelle déjà disponible sur 127.0.0.1:8765. Elle ne démarre aucun service ni observateur natif.

La collecte peut durer environ trois minutes si les gardes passent, ou s'arrêter plus tôt sur une preuve expirée/un worker non vérifiable. Les rapports privés sont conservés dans `%LOCALAPPDATA%\TradeBotIA\diagnostics-paper`. Ne pas partager les identifiants ou chemins privés sans les masquer. Conserver la sortie des tests et le rapport pour décider de la correction suivante, sans appeler la vérification historique ni START.
