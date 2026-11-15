# TradeBot IA V86 — Monitoring PRO

## Statut de livraison et validation

La V86 est une couche d'observation du PAPER V85, pas un nouveau moteur. **PAPER uniquement, LIVE OFF, aucun ordre MT5.**

Dans la session Dyad de développement, seuls la lecture et les changements de fichiers étaient disponibles : **aucun test Python, contrôle TypeScript, test navigateur, envoi Telegram ni connexion MT5 n'a été exécuté**. Les tests ci-dessous sont ajoutés, pas déclarés réussis. La V86 reste **À VALIDER SUR L'ACER WINDOWS** jusqu'à réception des sorties et du contrôle manuel.

Les 28 tests PAPER V85 (`test_paper_trial_time` et `test_paper_trial_waiting`) sont conservés sans modification dans cette livraison. Les résultats Windows antérieurs ne sont pas présentés comme une validation V86.

## Audit et sources réutilisées

- `paper_trial.py` : `snapshot`, position unique, trades clôturés, courbe, cotations, worker, attente et SAFE_STOP. **Fichier non modifié en V86.**
- `paper_storage.py` : checkpoints JSON atomiques, verrou d'écriture, récupération prudente. **Non modifié.**
- `%LOCALAPPDATA%\TradeBotIA\essai-paper20k\essai.json` : seule source de vérité des transactions et de leur état financier. La V86 n'y écrit pas.
- `paper_time.py`, `paper_time_config.json`, `time_basis.py`, `quote_time.py` : règles horaires et fraîcheur **non modifiées**.
- `ftmo_service.py` et `src/ftmo/core.py`, `frozen.py`, `verify.py` : moteur FTMO/stratégie **non modifiés**. Le worker challenge reste indépendant.
- `/paper-trial/state`, `/paper-trial/start`, `/paper-trial/stop`, les API FTMO et le port **127.0.0.1:8765** sont conservés.
- Le `PaperTrialPanel` et l'ancien accueil sont conservés dans `/v85`, avec Connexion MT5, Historique et Paramètres toujours accessibles. Le monitoring ne les appelle pas pour démarrer/arrêter le moteur.
- Outils constatés : unittest Python et lanceurs BAT existants ; TypeScript/Vite/ESLint dans package.json. Aucun exécuteur de processus disponible dans cette session, aucun framework de test navigateur installé.

## Architecture et fichiers V86

### A. Moteur existant

Aucune modification de ses décisions. GOLD/XAUUSD M15, 2,5R, 20 000 EUR de référence, 0,5 % maximum, une seule position, contrôles M15, timestamps futurs, attente sûre, reprise et SAFE_STOP restent ceux de V85. Le monitoring n'a pas d'objet MT5, n'appelle pas `market`, `observe`, `save`, `start` ou `pause` du moteur et ne recalcule aucun signal.

### B. Observation et calculs

- `paper_monitor.py` : thread séparé, copie du snapshot sous verrou puis libération du verrou avant calcul/SQLite. Échantillonnage toutes les 3 secondes ; aucune requête MT5 supplémentaire.
- `monitor_metrics.py` : statistiques pures depuis les trades enregistrés et la courbe du registre.
- `monitor_routes.py` : lectures `/paper-monitor/state`, `/paper-monitor/journal`, `/paper-monitor/export.csv`. Les seuls POST V86 configurent les alertes ou placent un message de test en file. Aucun contrôle moteur.
- `bridge.py` : raccordement isolé de l'observateur et de ses routes ; erreurs de démarrage/arrêt de l'observateur sans arrêt du moteur V85.
- `runtime_identity.py` : empreinte étendue aux modules V86 pour reconnaître la version effectivement chargée. L'empreinte de bridge change ; aucun ancien backtest n'est relancé et aucun rapport historique n'est recréé.

### C. Persistance additionnelle

`monitor_store.py` crée **à côté du registre**, sans le modifier :

`%LOCALAPPDATA%\TradeBotIA\essai-paper20k\monitor-v86.sqlite3`

SQLite standard Python, WAL, synchronisation FULL, schéma version 1. Tables : index `trades`, événements `events`, métadonnées/options `meta`, notifications `outbox`. Création idempotente, aucun effacement ni migration de `essai.json`.

Les IDs `P-…` dérivent de phase, signalTime, entryTime et direction ; ils sont stables à la clôture et au redémarrage. L'index n'invente aucune sortie. Une position disparue sans transaction de clôture reste non clôturée, à vérifier. Les imports historiques ont une date d'événement du registre et une date d'observation V86 distinctes. Le premier import n'envoie pas les anciens trades à Telegram.

Les ouvertures/clôtures restent archivées ; les événements techniques sans notification sont limités à 200. L'API affiche les 60 derniers événements, les vues en montrent 30. Les changements d'âge d'un tick ne multiplient pas les événements d'attente. Les détails intracycle inconnus ne sont pas reconstruits.

Journal paginé (20 lignes, limite API 100), filtres de chevauchement de période UTC et résultat. Export CSV complet de la sélection, maximum 10 000 trades avec refus explicite au-delà ; protection contre les formules CSV. Le navigateur n'est pas la persistance du journal.

### D. Alertes

`monitor_telegram.py` : thread d'envoi séparé. Token et chat ID exclusivement dans l'environnement Windows, jamais dans l'API, le dépôt ou les messages d'erreur.

Options persistantes : interrupteur général, ouverture, clôture (motif SL/TP enregistré inclus), SAFE_STOP, reprise après au moins 60 secondes d'attente observée. Tout message commence par **PAPER — VIRTUEL**. Aucun bouton de commande Telegram ni webhook d'ordre.

L'outbox déduplique les événements. `SENT` n'est pas renvoyé après redémarrage. Telegram 429 : attente exponentielle, au moins 60 secondes, maximum 5 tentatives. Erreur 4xx définitive : FAILED. Timeout, panne réseau, 5xx ou crash pendant l'envoi : UNCERTAIN, pas de renvoi automatique pour éviter un doublon. Telegram n'offre pas de clé d'idempotence : la réception exactement une fois ne peut pas être garantie en cas de réponse perdue. Le statut incertain reste visible ; ne pas prétendre qu'un message a été reçu.

**Limite assumée :** un bridge/PC éteint ne peut pas notifier sa propre panne. Aucun agent externe ou service public n'est installé. Une déconnexion n'est notifiée que lorsqu'elle produit un SAFE_STOP réellement observé. Les transitions très courtes entre deux snapshots peuvent ne pas être connues.

### E. Interface

- `src/lib/paper-monitor-api.ts` : validation Zod, requêtes locales avec timeout, aucun endpoint d'exécution.
- `src/components/monitor/MonitorLayout.tsx` : requête partagée toutes les 4 secondes, pas de polling en arrière-plan, vérification de fraîcheur visuelle chaque seconde.
- `MonitorCards.tsx` : position, capital et courbe d'equity.
- `MonitorJournal.tsx`, `MonitorEvents.tsx`, `MonitorNotifications.tsx` : journal, événements et alertes.
- `src/pages/Index.tsx`, `MonitorPositions.tsx`, `MonitorJournalPage.tsx`, `MonitorStatistics.tsx`, `MonitorHealth.tsx` : cinq vues V86.
- `WorkspaceV85.tsx` : copie intégrale de l'ancien Index pour préserver l'espace fonctionnel.
- `src/App.tsx` : routes V86, routes V85 conservées ; `AppNavigation.tsx` : accès entre les espaces.
- `index.html` : langue française, titre, viewport iPhone/safe areas et métadonnées d'écran d'accueil ; aucun service worker ni cache financier hors ligne.

## Méthodes financières et données absentes

- Réalisé = somme des `pnl` des trades effectivement clôturés. Les frais d'entrée d'une position ouverte sont déjà débités du solde mais ne font pas encore partie du réalisé des trades clôturés.
- Exposition latente = equity enregistrée − solde, uniquement si la valorisation et les deux ticks/heartbeat ont 0–15 secondes, le moteur surveille, et les timestamps du dernier quote valorisé correspondent au feed. Une cotation seule au START ne suffit pas à certifier une ancienne equity.
- P&L net de position = exposition latente − commission d'entrée enregistrée. Pourcentages affichés sur le capital **initial** 20 000 EUR (le capital au moment d'entrée n'est pas enregistré). R = P&L net / risque initial enregistré.
- Risque prévu affiché = riskEUR, et pourcentage du capital initial explicitement libellé. Aucun risque d'entrée non enregistré n'est reconstitué.
- Win rate = gagnants / tous les clôturés, neutres inclus. Profit factor = somme gains / valeur absolue des pertes. Gains sans pertes : infini ; aucun résultat : —.
- Drawdown = baisse maximale depuis les plus-hauts des seules observations d'equity, avec référence 20 000 EUR ; pourcentage sur le plus-haut correspondant. Ce n'est pas une mesure intrabar, et les lacunes peuvent sous-estimer le risque.
- Courbe chronologique condensée si nécessaire avec extrêmes par groupe ; calcul du drawdown sur toutes les observations disponibles, avant condensation.
- Aujourd'hui/mois/7 jours : Europe/Paris à la date de clôture ; 7 jours = aujourd'hui et les 6 jours calendaires précédents. Historique quotidien : jours avec clôtures seulement.
- Motif d'entrée absent : « non enregistré ». Jamais de raison inventée. Aucune équity latente dite actuelle après expiration du tick, perte de bridge, SAFE_STOP, attente ou arrêt.
- MT5 : connexion confirmée seulement par les informations réellement observées ; déconnexion explicite si le message exact du connecteur l'établit, sinon inconnue. Une cotation ancienne n'est pas une preuve de terminal déconnecté.
- M15 : état du dernier contrôle réussi et nombre de bougies quand ils existent, ou insuffisance explicite V85 ; aucun test supplémentaire ni succès actuel supposé.

## Sauvegarde et retour à V85

Point de référence avant développement V86 : commit Dyad **7f1412ee718671bc82b0ce40b47ee7bbfde40bb0**. Utiliser l'historique Dyad pour revenir à cette révision si nécessaire ; il ne suffit pas de restaurer uniquement un fichier bridge.

Avant le premier redémarrage sur Windows :

1. Arrêter manuellement l'essai depuis l'espace V85 ; ne pas supposer la clôture d'une position conservée.
2. Fermer la passerelle puis copier depuis l'Explorateur tout `%LOCALAPPDATA%\TradeBotIA\essai-paper20k` vers un dossier de sauvegarde daté hors du projet. Ne pas écraser le registre courant par une ancienne copie si des transactions ont été enregistrées depuis.
3. Après création de SQLite, sauvegarder le dossier complet passerelle arrêtée (inclure les fichiers `-wal`/`-shm` s'ils existent). Ne pas copier uniquement le fichier SQLite pendant des écritures.
4. Pour revenir au code V85, restaurer la révision Dyad puis relancer une seule passerelle. Le registre moteur n'a pas changé de format. Le fichier SQLite V86 peut rester sur disque, V85 ne le lit pas. Ne pas effacer ni réinitialiser les trades.

Aucune sauvegarde du registre Windows n'a été créée par Dyad à distance : ces fichiers ne sont pas accessibles dans cette session.

## Tests Windows préparés, sans saisie de terminal

Dans l'Explorateur, double-cliquer `src\mt5_bridge\valider_monitor_v86.bat`, ou dans VS Code choisir **Tâches : Exécuter la tâche → V86 Monitoring PRO : tests V85 et V86 sans demarrer**. Les instructions exactes pour Python et TypeScript sont regroupées dans ce fichier inspectable. Le lanceur réutilise `.venv-mt5`, ne réinstalle rien et ne démarre pas la passerelle.

`run_monitor_v86_tests.py` exécute explicitement :

- `test_paper_trial_time` et `test_paper_trial_waiting` : les 28 tests V85 existants.
- `test_quote_time`, `test_time_basis`, `test_paper_safety` : sécurité/persistance et temps existants.
- `test_monitor_v86` : 0/1/plusieurs trades, P&L, PF, R, drawdown, périodes Paris, condensation, SQLite/redémarrage, pas de clôture fictive, déduplication, Telegram désactivé/envoi/erreurs/retry, observation sans mutation moteur, tick ancien/futur, SAFE_STOP prioritaire, CSV, règles réseau exécutées isolément et contrats de routes/mobile.

Rapports effectifs après exécution : `%LOCALAPPDATA%\TradeBotIA\validation-v86\tests-v86.json` et `.txt`. Le JSON indique succès/erreurs/skips et les empreintes des fichiers protégés avant/après. Une comparaison en lecture seule avec le commit V85 est réalisée si Git et le commit sont disponibles ; sinon NOT_CHECKED, pas MATCH supposé. Le contrôle TypeScript du BAT est distinct ; sa sortie est dans la fenêtre de tâche. Les tests de routes/mobile statiques ne remplacent pas un vrai navigateur.

Ne pas utiliser un lanceur global de backtests ou VERIFY pour valider cette interface. **Attendre et examiner les résultats avant de déclarer V86 validée.** Une réussite sur fixtures ne prouve ni MT5 réel ni Safari ni livraison Telegram réelle.

## Configurer Telegram et tester sans trade

1. Telegram : compte officiel vérifié **@BotFather**, commande de création `/newbot`, conserver le token privé.
2. Ouvrir le bot créé, envoyer `/start`. Pour obtenir le chat ID, utiliser `getUpdates` de l'API HTTPS officielle Telegram dans un outil local de confiance avec ce token. Relever `message.chat.id` pour votre conversation. Ne pas mettre le token dans Dyad, un ticket, une capture, un fichier du dépôt ou un journal ; une URL incluant le token est un secret. Révoquer le token auprès de BotFather si compromis.
3. Windows → « Modifier les variables d'environnement pour votre compte » : créer **TRADEBOT_TELEGRAM_TOKEN** et **TRADEBOT_TELEGRAM_CHAT_ID**. Aucun `.env` contenant des secrets n'est ajouté au projet.
4. Fermer la passerelle existante puis double-cliquer une seule fois sur `start_mt5_bridge.bat` depuis un Explorateur qui hérite du nouvel environnement. Si l'ancien processus ne voit pas les variables, rouvrir l'Explorateur/session avant de relancer ; ne pas lancer deux bridges.
5. V86 → État : vérifier « variables serveur détectées », activer l'interrupteur général et les catégories souhaitées.
6. Cliquer **Tester un message · aucun trade** (limite 1/minute). Vérifier le statut SENT dans V86 et surtout la réception du message **PAPER — VIRTUEL** dans Telegram sur iPhone. Le moteur peut rester arrêté pour ce test.
7. Autoriser les notifications Telegram dans Réglages iOS. Un test envoyé n'est ni une ouverture ni une clôture de position. Désactiver l'interrupteur général annule les notifications encore en attente, sans modifier le moteur.

## Réseau local, extérieur et authentification

La V86 n'ouvre **aucun port** et ne déploie **aucun serveur distant**. Bind, Host, client et origine loopback sont conservés. Il n'y a donc pas d'authentification distante activée ni de prétendue protection MFA déjà installée.

- PC Acer : aperçu HTTP localhost sur le même PC que le bridge.
- iPhone sur le même Wi-Fi : pas de connexion directe au bridge ; 127.0.0.1 désignerait le téléphone. L'interface s'adapte à cette largeur, mais le transport reste à configurer.
- Hors domicile : **Bureau à distance Google déjà fonctionnel reste la solution**. Les notifications Telegram sortantes fonctionnent sans exposer le bridge, tant que le PC et le bridge tournent et ont Internet.
- Écran d'accueil Safari : partage → Sur l'écran d'accueil pour une URL déjà accessible ; n'établit ni réseau ni authentification. Aucune promesse de PWA hors ligne.

Architecture prévue pour une évolution explicitement approuvée : connecteur d'observation local sortant vers un service HTTPS authentifié, sessions courtes/MFA, autorisations de lecture uniquement, révocation et journal d'accès. Contrat autorisé : état monitoring, journal et export borné ; pas de proxy générique, pas de `/paper-trial/start`, `/stop`, `/ftmo/*`, ni de configuration de secrets. Le connecteur ne doit jamais accepter des commandes descendantes de trading. Cette infrastructure nécessite configuration, fournisseur/authentification et approbation ; **elle n'est pas implémentée ni activée dans cette livraison locale**. Ne jamais exposer 8765, utiliser un tunnel public anonyme ou désactiver CORS pour contourner cette limite.

## Validation PAPER manuelle après redémarrage

1. Examiner les sorties des tests ; si échec, conserver le détail et ne pas déclarer V86 validée.
2. Faire la sauvegarde hors projet, rester connecté à MT5 DEMO FTMO et laisser l'autotrading/API d'ordres désactivés. XAUUSD/EURUSD et historiques synchronisés.
3. Fermer puis relancer **une seule fois** la passerelle avec le lanceur existant. L'essai reste arrêté au démarrage comme V85 ; V86 ne lance aucun START.
4. Ouvrir l'accueil V86 : pas de cotation/trade inventé, solde et nombre de clôtures identiques au registre V85. Comparer un même trade/ID au journal et à l'export.
5. Depuis **Espace V85** seulement, décider explicitement de démarrer l'essai PAPER. Observer une vraie cotation fraîche et un vrai signal éventuel, sans forcer d'entrée. Comparer BID/ASK, heure d'entrée, SL/TP, volume et risque avec les valeurs du moteur.
6. Attente temporaire : utiliser les tests isolés pour les âges limites ; en observation réelle, ne pas changer les timestamps/configuration pour provoquer le scénario. Si l'attente survient, vérifier libellé, absence de trade sur données périmées et reprise conforme V85. Interruption avec position : conserver SAFE_STOP/reprise explicite si V85 l'exige.
7. Fermer la passerelle après arrêt manuel : le monitoring doit perdre la confirmation et masquer le latent courant. Relancer : position conservée si applicable, pas de clôture supposée, mêmes IDs/transactions, pas de notification historique en rafale.
8. Tester Telegram sans trade puis, uniquement si de vrais événements PAPER surviennent naturellement, comparer leur contenu aux transactions enregistrées.
9. Vérifier Safari/iPhone via l'accès existant et les largeurs 375/390/430 px dans les outils navigateur : cinq rubriques, gros boutons, filtres, absence de débordement horizontal, graphique et lecteurs d'écran/zoom système. Tester clavier, focus, libellés de switches et alertes.
10. Confirmer que le worker challenge FTMO et sa position éventuelle sont inchangés, LIVE OFF partout et aucun ordre broker envoyé. L'absence d'ordre est aussi un contrôle manuel du terminal, pas une conclusion des seuls tests simulés.

## Limites restantes explicites

- Aucun test exécuté par Dyad dans cette session ; exécution Windows et réception des rapports attendues.
- Pas de validation réelle MT5, iPhone/Safari, livraison Telegram ou performance sur gros registre à ce stade.
- Pas d'accès Internet direct ni de MFA distante déployée ; architecture seulement documentée.
- Pas d'alerte de panne totale du PC/bridge sans agent externe approuvé.
- Pas de reconstitution des mises à jour intracycle manquées, des motifs d'entrée absents ou des excursions inconnues.
- Pas de garantie « exactly once » Telegram en cas de réponse perdue ; événements incertains visibles et non renvoyés automatiquement.
