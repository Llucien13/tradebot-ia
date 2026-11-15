# V91 — diagnostic IPC sans relancer les tests

## Depuis VS Code

Choisir **Terminal > Executer la tache > V91 : diagnostic IPC MT5 sans tests ni redemarrage**. Le script `diagnostiquer_ipc_v91.ps1` collecte les observations et les publie sous `%LOCALAPPDATA%\TradeBotIA\diagnostic-v91\ipc-*.json`.

Il ne demande aucune action dans MT5, ne recompile pas la sonde et ne relance pas les 164 tests. Il ne modifie ni MT5, ni le compte, ni la configuration, ni les historiques. Aucun ordre, START, login, shutdown, installation, suppression ou redemarrage n'est execute par le diagnostic. Le rapport contient des identifiants de compte et des chemins; les masquer avant partage.

## Observations collectees

- PID, chemin executable, utilisateur, session Windows et date de creation des processus MT5/Python; arguments complets exclus du rapport.
- Proprietaire du listener loopback 8765; autres commandes `bridge.py` potentiellement concurrentes. Leur presence ne prouve pas qu'elles utilisent l'API MT5.
- Variable `MT5_TERMINAL_PATH` du terminal VS Code et valeurs utilisateur/machine, distinctes de la valeur effectivement heritee par le processus passerelle.
- Metadonnees du Python `.venv-mt5` attendu, sans importer la passerelle ou initialiser MT5. Le Python reellement charge est rapporte par la passerelle : executable, architecture, version, prefix, fichier/version du package MetaTrader5.
- Identite du terminal effectivement joignable : chemin, dossier de donnees, build, connexion broker; compte/login/serveur DEMO reellement lus, sans substitution.
- Dernier code MT5 sur echec de lecture, compteur IPC, delai restant et eventuel epuisement. Aucun compteur n'est reinitialise.
- Ticks XAUUSD et EURUSD bruts puis normalises avec la convention PAPER existante. Fraicheur <=15 s, aucun timestamp futur accepte. Une normalisation impossible reste une erreur, pas un prix ou decalage invente.
- Worker PAPER, presence du thread, heartbeat, erreur, position presente (sans lecture de positions manuelles), SAFE_STOP et valorisation separes.

Le nouvel endpoint GET `/diagnostics/mt5-ipc` execute des lectures dans le processus de la passerelle, sous le verrou partage acquis sans attente. Il ne fait aucun `initialize()`; si le verrou est occupe, il rapporte BUSY. Les verrous PAPER et marche ne sont jamais imbriques en ordre inverse du worker.

Le script appelle ensuite une seule fois le diagnostic `/status?symbol=XAUUSD` existant. Ce GET peut effectuer la tentative de connexion normale, dans le meme processus, seulement si le verrou IPC de securite l'autorise. Il n'utilise pas de second Python pour tester `initialize()`. Aucune boucle de reconnexion de diagnostic n'est ajoutee. Il observe ensuite a nouveau le diagnostic IPC et l'etat PAPER. Les routes d'horloge/feed qui relancent des autotests ne sont pas appelees.

## Corrections limitees aux defauts visibles du projet

1. L'ancien `connect()` convertissait les chemins des terminaux en `set`, perdant le nombre de processus. Deux terminaux avec le meme executable pouvaient donc passer pour une seule instance. Le correctif refuse maintenant une telle ambiguite avant toute initialisation.
2. L'ancien `connect()` appelait `initialize()` a chaque lecture, y compris lors d'une liaison deja valide. Le correctif reutilise le terminal deja joignable et initialise seulement si `terminal_info()` est absent, toujours apres verification de la porte IPC et de l'unicite du processus.
3. Un terminal retourne au mauvais chemin n'est plus deconnecte par `shutdown()` dans ce controle : la lecture est refusee sans intervention sur sa liaison.

Ces defauts sont demontrables par inspection du code; ils ne prouvent pas qu'ils sont la cause racine du timeout observe sur le PC. Les seuils, compte DEMO, strategie GOLD M15, risque, worker FTMO, interface, lancement automatique et historiques ne sont pas modifies. La porte IPC demeure verrouillee apres epuisement; une liaison retablie ne leve pas SAFE_STOP.

## Resultats et actions conditionnelles

Code 0 : connexion DEMO et deux ticks frais observes, valorisation/heartbeat PAPER et securites compatibles avec une surveillance active. Cela ne constitue ni une autorisation d'ordre ni une certification generale. Code 2 : observations incompletes, attente de marche/cotations, SAFE_STOP ou panne. Examiner le detail; pas de relance automatique pour obtenir un resultat vert.

Un code -10005 atteste un timeout de dialogue IPC, pas sa cause racine. Des utilisateurs/sessions differents, un autre Python ou plusieurs processus sont des faits de contexte; leur causalite doit etre confirmee. Une absence de heartbeat ne prouve pas a elle seule une panne du terminal. Les privileges d'elevation, antivirus, DLL et pipes Windows ne sont pas audites exhaustivement : aucune conclusion supposee n'est produite a leur sujet.

**Si l'endpoint V91 retourne 404 sur une ancienne passerelle :** le processus existant ne charge pas les nouveaux modules a chaud. Une relance controlee de **la passerelle uniquement**, avec accord et selon la procedure de securite existante, est necessaire pour les observations internes V91. Ne pas lancer une deuxieme passerelle et ne pas redemarrer MT5. Le script conserve deja les observations Windows et les erreurs des endpoints. Il ne relance rien lui-meme.

**Si plusieurs terminaux identiques sont prouves :** identifier les PID et leurs dossiers de donnees avant d'envisager une fermeture; aucune fermeture automatique ou changement de compte n'est autorise par ce correctif. Ne pas choisir arbitrairement une instance.

Aucune action manuelle dans MT5 n'est prescrite sans observation du rapport. Si le compteur IPC est epuise, le diagnostic ne le contourne pas : une intervention autorisee doit d'abord resoudre la cause identifiee; reprise PAPER uniquement par les controles existants.

## Etat dans cette intervention

Les fichiers ont ete relus statiquement. Aucun acces au Windows/MT5 du PC, aucune execution PowerShell/Python ou verification de connexion reelle n'est disponible avec les outils de cette session. Aucun des 164 tests n'a ete relance et aucun succes IPC/cotation n'est annonce. L'instance reelle, son chemin, le compte, la cause exacte et l'etat des ticks restent a observer avec la tache V91.
