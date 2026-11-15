# TradeBot IA — passerelle MT5 locale Windows

## V87 — positions manuelles et PAPER

**Premium Control Desk → Positions** sépare le registre simulé du bot des positions réellement retournées en lecture seule par MT5. Pour trader, utilisez MT5 sur le PC ou l'application MT5 iPhone ; le dashboard n'envoie aucun ordre, ne modifie pas SL/TP et ne clôture aucune position. En NETTING/EXCHANGE, positions sur un même instrument peuvent fusionner ou compenser ; aucune indépendance n'est promise. LIVE reste désactivé.

Voir [MONITORING_V87.md](MONITORING_V87.md) pour la politique anti-gap, le format du calendrier FTMO attesté, les règles d'identification, les tests et la commande Windows. Le relevé manuel MT5 n'est pas mélangé aux performances PAPER. La protection ne doit pas être déclarée validée avant exécution du lanceur et vérification des heures applicables; aucun test Python n'a été exécuté dans cette session Dyad.

## V86 — Monitoring PRO

L’accueil présente maintenant le monitoring en lecture seule. L’ancien accueil et les commandes manuelles restent dans **Espace V85**. Consulter [MONITORING_V86.md](MONITORING_V86.md) pour l’audit, les fichiers, le journal SQLite additionnel, Telegram, les tests Windows, les sauvegardes/retour V85 et les limites d’accès iPhone. La V86 reste à valider sur Windows ; aucun test ni envoi Telegram n’a été exécuté dans la session Dyad.

## Lancer l’ESSAI PAPER (sans diagnostic ni backtest)

1. Dans MT5 DEMO FTMO, afficher XAUUSD et EURUSD, synchroniser les historiques nécessaires, puis laisser l’horloge Windows correctement réglée.
2. Fermer la fenêtre de passerelle Python déjà ouverte, démarrer une seule fois **`start_mt5_bridge.bat`** et la laisser ouverte.
3. Dans **ESSAI PAPER · compte indépendant**, cliquer sur **Démarrer l’essai PAPER**. Aucun ordre MT5 ni backtest n’est lancé; une entrée n’est évaluée qu’au prochain signal M15.

L’essai réutilise les expressions de signal GOLD M15 2,5R, le dimensionnement à 0,5 %, les coûts de commission/slippage de simulation, SL/TP et l’expiration à 32 bougies. Le spread vient de MT5. **Les swaps ne sont pas inclus dans ce modèle d’essai** : le résultat n’est pas un résultat net FTMO. Les garde-fous de perte de 1 000 EUR/jour et 2 000 EUR au total sont conservés, sans objectifs ni resets de phases.

Le registre est séparé : `%LOCALAPPDATA%\TradeBotIA\essai-paper20k\essai.json`. Le challenge FTMO et son `verification.json` ne sont ni modifiés ni requis par l’essai. Un challenge actif ou une vérification en cours interdit de démarrer l’essai.

**Arrêter** arrête le cycle de l’essai et annule les nouvelles tentatives automatiques; une position virtuelle reste conservée sans clôture supposée. Une cotation XAUUSD ou EURUSD de plus de 15 secondes met la session lancée en **En attente de cotations fraîches**, avec raison et âge, sans signal ni transaction. Le worker réessaie toutes les 2 secondes, sans accumuler de messages identiques. Au retour des cotations fraîches, les séries requises sont contrôlées avant la reprise. Les erreurs permanentes (configuration, timestamp invalide ou futur, convention ambiguë, séries incohérentes) restent bloquantes et prioritaires sur une cotation périmée. Après une interruption de suivi de plus de 15 secondes avec une position ouverte, la sécurité existante impose une reprise explicite; aucune excursion ni sortie manquée n’est inventée. Ne pas interpréter une equity figée comme une valorisation actuelle.

L’essai utilise `src/mt5_bridge/paper_time_config.json`, sans le relevé natif du challenge. Les périodes GMT+2/GMT+3 sont exclusivement celles de ce fichier, non modifié par ce correctif; aucune règle de transition n’est déduite. Chaque tick est pris comme UTC direct s’il est déjà âgé de 0–15 s; sinon, la conversion configurée est vérifiée. Une cotation ancienne reste inexploitable et déclenche l’attente; un timestamp futur ou invalide reste bloquant. Les bougies M15 des deux symboles passent par la même convention que leurs ticks et doivent être alignées. Les dates historiques non couvertes restent refusées. La configuration actuelle s’arrête au 31 décembre 2026, sans supposer la prochaine transition DST.

## Vérification finale du challenge FTMO (distincte de l’essai)

Dans la palette VS Code Windows, choisir **Tasks: Run Task / Tâches : Exécuter la tâche**, puis **FTMO PAPER : verification finale sans demarrer**. Cette tâche existante exécute les tests ciblés, le SelfTest et la collecte. Aucun replay historique, ordre ou START n'est appelé. Les BAT peuvent attendre une touche entre les étapes.

- Le moteur lit désormais les swaps dans les spécifications MT5 et dérive les coûts au START. Une valeur manuelle contradictoire est refusée. Les champs de swap peuvent être omis dans la requête; ni zéro ni un tarif fictif ne servent de valeur par défaut.
- Le rollover est calculé à **minuit serveur**, événement par événement, et non par incréments UTC fixes de 86 400 secondes. Son heure UTC est 22 h sous GMT+2 et 21 h sous GMT+3 lorsque la règle et les mesures correspondantes sont établies. Le jour triple se rapporte au jour serveur qui se termine; les frais du registre gardent leur signe.
- Le jour de perte FTMO reste calculé séparément à minuit **Europe/Prague** dans `core.py`, inchangé. Le capital fictif reste 20 000 EUR et GOLD M15 2,5R reste la seule stratégie autorisée au START.
- Les contrôles du START incluent le worker vivant/heartbeat 0–15 s, les preuves historiques, la base UTC native, les ticks frais, les séries synchronisées, les coûts, les positions broker et les marges FTMO. Les changements de spécification pendant une position entraînent un arrêt sécurisé, jamais une clôture supposée.
- `/ftmo/state` expose séparément `historicalVerification` et `paperPreparation`. Un rapport historique absent reste `NOT_RUN`; la préparation courante ne crée pas un `PASSED`. Un rapport aux anciennes empreintes reste `STALE`. Il faut retrouver le rapport original avec ses preuves et ses sources pour examiner sa compatibilité; une attestation de sauvegarde `VERIFIED` ne suffit pas. Ne pas relancer la vérification historique existante pour recréer ce fichier.
- `runtimeBuild` expose le PID et les empreintes des sources au démarrage et sur disque. Le lanceur compare avec les fichiers locaux. S'ils diffèrent, il ne recharge la passerelle qu'après vérification du propriétaire Windows, du chemin Python, de la ligne de commande, du port, du worker, du stockage, de l'absence de bot/position et confirmation **REDEMARRER**. Le moteur PAPER reste arrêté après rechargement. Une identité non démontrée interdit l'arrêt; aucun autre processus n'est tué et aucun second serveur n'est lancé tant que l'ancien subsiste.

### Limite du calendrier officiel actuellement fourni

Références communiquées : https://ftmo.com/fr/trading-updates/ et https://ftmo.com/fr/faq/quelles-sont-les-specifications-du-compte/ . La confirmation reçue établit GMT+2 à partir du **2 novembre 2026**, GMT+3 en période estivale et minuit serveur pour les swaps. Elle ne donne pas les dates/heures exactes de début/fin de la période estivale ni une règle de récurrence annuelle. Il serait incorrect d'en déduire Europe/Prague, Helsinki ou les transitions américaines.

Le moteur accepte donc une règle annuelle IANA **déjà confirmée dans la preuve**, contrôlée contre les horloges natives, ou la période GMT+2 explicitement bornée de novembre–décembre 2026. La seconde option n'autorise pas de convertir l'historique antérieur : les bougies requises hors période restent bloquantes. Les ambiguïtés/trous DST restent refusés. Pour lever ce blocage, obtenir **la règle annuelle complète et les heures des transitions auprès de FTMO**, puis la confronter à la capture native, sans simplement choisir un fuseau présentant l'offset actuel.

Les tests de calendrier couvrent également les journées de 23/25 heures avec un fuseau de test synthétique : ce n'est pas une attribution de cette règle à FTMO. Ils sont préparés dans le lanceur; **aucun test Python/PowerShell ni mesure MT5 n'a pu être exécuté dans la session de modification dépourvue d'exécuteur**. Le verdict reste NON PRÊT tant que les preuves historiques, le calendrier complet et les contrôles Windows ne sont pas démontrés.

## Ce qui est installé

La passerelle utilise **le package officiel MetaTrader5**, FastAPI, Uvicorn, psutil, numpy, pandas et tzdata. Les dépendances et leurs plages de versions sont dans `requirements.txt`. `start_mt5_bridge.bat` crée un environnement Python isolé `.venv-mt5` à la racine et installe ces dépendances au premier lancement, ou complète l'environnement existant pour FTMO. Un accès Internet est nécessaire lors de l'installation. Les lancements suivants réutilisent cet environnement. Pour le module GOLD M15, consultez également `src/ftmo/INTEGRATION.md`.

L'API écoute **uniquement sur http://127.0.0.1:8765**, avec un seul processus. Aucun tunnel, aucune redirection de port, aucune ouverture réseau public. Ne lancez pas Uvicorn avec une autre adresse d'écoute.

## Compte FTMO-Demo actuel — XAUUSD

- Le panneau actif **Connexion MT5** demande explicitement `symbol=XAUUSD`. Le simulateur FTMO lit exclusivement XAUUSD et exige un compte DEMO sur un serveur FTMO-Demo. Aucun repli silencieux vers XAUUSD-ECN.
- L'ancien comportement VT Markets ci-dessous reste conservé : `/status` et `/candles` sans paramètre utilisent XAUUSD-ECN. Les moteurs, adaptateurs et fichiers historiques VT Markets ne sont pas modifiés.
- Après une mise à jour des fichiers Python, fermer puis relancer **la passerelle Windows** avec `start_mt5_bridge.bat`. Le rechargement de l'aperçu ne recharge pas ce processus Python. Ne pas fermer le terminal MT5 et ne pas supprimer l'environnement ou les historiques.
- Dans MT5, rester connecté à FTMO-Demo, afficher XAUUSD et EURUSD, ouvrir les graphiques XAUUSD M5/M15/M30/H1/H4/D1 et attendre leur synchronisation.
- Vérification directe, en lecture seule : **http://127.0.0.1:8765/status?symbol=XAUUSD** puis **http://127.0.0.1:8765/candles?symbol=XAUUSD&timeframe=M15&count=10**. Vérifier `symbol: XAUUSD`, le compte/serveur retourné, les BID/ASK horodatés et les OHLC avec MT5. Les bougies du panneau sont clôturées, sans interpolation.
- Dans **Connexion MT5**, le premier bouton teste le connecteur. **Tester le flux FTMO / MT5** vérifie aussi EUR/USD, la M15 courante et les séries requises par le moteur. Ce second test conserve la limite de fraîcheur existante de 15 secondes : marché fermé ou tick ancien peut entraîner un refus légitime. Aucun test ne démarre le bot.
- Les réponses doivent identifier leur symbole. Une ancienne passerelle qui retourne ECN pour une demande XAUUSD est refusée par le client, pas réétiquetée.
- PAPER exclusivement, LIVE désactivé, START suspendu dans l'interface de l'étape B. Le capital FTMO virtuel demeure indépendant du solde réel du compte MT5, même si tous deux sont initialement de 20 000 €.
- Les replays et résultats originaux restent inchangés. La modification du connecteur peut rendre un ancien rapport de vérification `STALE` par son empreinte de code ; aucun replay n'est lancé automatiquement et aucun ancien résultat n'est remplacé.
- Une position virtuelle d'un ancien flux sans provenance XAUUSD bloque la reprise du service : son registre est conservé, jamais converti ou repricé automatiquement sur un autre contrat.

## Installation et lancement VT Markets historiques, sans terminal de commandes

1. Installez **Python Windows 64 bits** depuis python.org (Python 3.11 ou 3.12 conseillé). Activez le Python Launcher / `py` dans l'installateur. Le package MetaTrader5 nécessite Windows et un Python compatible ; cette passerelle ne fonctionne pas dans un conteneur Linux ou sur un serveur distant.
2. Placez les fichiers actuels de cette application dans un dossier Windows accessible en écriture. Conservez `start_mt5_bridge.bat` à la racine, et `src/mt5_bridge/bridge.py` ainsi que `requirements.txt` à leur emplacement. Un ancien ZIP de l'application peut ne pas contenir ces nouveaux fichiers.
3. Ouvrez **MetaTrader 5 64 bits**, dans la même session utilisateur Windows que Dyad et la passerelle. Vérifiez dans MT5 que le compte connecté est **VT Markets DEMO**. La passerelle ne vous connecte pas à un compte et ne reçoit aucun identifiant.
4. Dans l'Observation du marché, affichez **XAUUSD-ECN**. Ouvrez ses graphiques M1, M5, M15, M30, H1, H4 et D1 et attendez leur synchronisation. L'historique disponible dépend du broker et du réglage MT5 du nombre maximal de barres.
5. Double-cliquez sur **start_mt5_bridge.bat**. La première installation peut prendre quelques minutes. Si Windows affiche SmartScreen, vérifiez d'abord le contenu du fichier avant de l'autoriser. Gardez la fenêtre ouverte. Si vous voyez une erreur, lisez la section dépannage ci-dessous.
6. Dans le navigateur de ce même PC, ouvrez **http://127.0.0.1:8765/status**. Le JSON doit indiquer `source: "MT5"`, `connected: true`, `readOnly: true`, `mode: "PAPER"`, `liveEnabled: false`. Vérifiez `account.type`, `account.company`, `account.server` et `account.login`. Ces valeurs proviennent du terminal, pas d'une étiquette DEMO imposée par l'application.
7. Dans l'aperçu **local HTTP** de Dyad, ouvrez le tableau de bord, puis cliquez sur **Tester la connexion MT5**. Autorisez l'accès au réseau local si le navigateur le demande. Le panneau affiche le solde, l'equity, BID/ASK et les bougies. Après ce clic, il relit les données toutes les 10 secondes tant que le panneau est ouvert. Changez l'unité de temps pour lire chacune des sept séries. Le test ne lance ni bot ni backtest.
8. Pour arrêter la passerelle, fermez sa fenêtre. Au prochain rafraîchissement, le panneau passera à Déconnecté et retirera les données indisponibles.

## Vérifier que les données viennent vraiment de MT5

- Comparez le numéro de compte, le serveur, le type DEMO/REAL, le solde et l'equity avec MT5. En cas de compte REAL ou de broker différent de VT Markets, un avertissement apparaît ; la passerelle ne change jamais le compte et n'envoie aucun ordre.
- Comparez BID/ASK avec l'Observation du marché **XAUUSD-ECN**, à des instants proches. Le panneau donne l'horodatage du dernier tick MT5, distinct de l'heure de lecture. Les prix peuvent différer légèrement entre deux instants de rafraîchissement.
- Consultez **http://127.0.0.1:8765/candles?timeframe=M5&count=10**. Remplacez `M5` dans la barre d'adresse par M1, M15, M30, H1, H4 ou D1 pour vérifier toutes les séries. Comparez les OHLC avec la fenêtre des données MT5. Les horaires JSON sont des timestamps Unix en millisecondes, et le panneau les affiche en **UTC** ; l'heure des graphiques MT5 peut être celle du serveur broker.
- Seules les **bougies clôturées** sont retournées : la bougie courante, position 0 dans MT5, est exclue. Le panneau affiche les huit dernières parmi les 300 demandées. Aucun OHLC, volume ou intervalle manquant n'est synthétisé. `tickVolume` désigne le volume en ticks, pas un volume réel négocié garanti.
- Un tick ancien est signalé. Marché fermé ou terminal sans nouveaux ticks : le dernier tick réel peut rester identique ; ce n'est pas une nouvelle cotation.
- Fermez la passerelle : le test doit échouer et aucun prix de secours ne doit apparaître. Rouvrez-la pour reconnecter. Si MT5 est déconnecté du broker, `/status` indique `connected: false` avec une erreur.
- `quote.maxLot` est le volume maximal **lu dans MT5**. Cette lecture ne réécrit pas le plafond de 100 lots confirmé de votre profil V3.

## Sécurité et conservation de l'application

- Routes MT5 originales : **GET /status** et **GET /candles**. Le module indépendant ajoute `/ftmo/*` : GET pour le registre/les références/données et POST pour START/STOP PAPER, archivage et vérification. Ces POST ne soumettent aucun ordre MT5. Il n'existe aucune route d'ordre, de login ou d'activation LIVE.
- Aucun appel d'envoi d'ordre, aucun mot de passe demandé ou enregistré, aucune modification des paramètres de stratégie. Le compte retourné n'est pas enregistré dans le localStorage par ce panneau. Les journaux d'accès HTTP sont désactivés.
- La passerelle cible uniquement un `terminal64.exe` déjà ouvert et vérifie le chemin retourné. `initialize` reçoit le chemin et un timeout, **pas de login/password/server**. L'API officielle peut réutiliser les paramètres mémorisés par MT5 lui-même ; vérifiez donc toujours le compte effectivement retourné.
- Le marqueur historique `botState: "STOPPED"` de `/status` reste celui du connecteur en lecture seule, pas le statut du nouveau simulateur. Le statut FTMO est `state.running` dans `/ftmo/state`. Le bot PAPER existant démarre en pause ; le nouveau bot FTMO aussi, au démarrage de la passerelle. Les positions virtuelles restent conservées et surveillées au retour des données. Tout démarrage d'entrées reste une action explicite.
- Le panneau MT5 est une source **distincte** : il ne remplace pas Twelve Data, le connecteur historique MT5 existant ou les sources des moteurs M1/M5/H1. Les backtests et le fonctionnement V3 en un clic sont inchangés.
- Pour une protection supplémentaire dans MT5, gardez désactivé le trading automatique et activez l'option de blocage du trading via l'API Python externe dans les paramètres des Expert Advisors, si disponible. La lecture de données ne nécessite pas d'autoriser l'envoi d'ordres.
- L'API est accessible aux autres logiciels de confiance exécutés sur votre PC. Le loopback n'est pas une protection contre un logiciel malveillant déjà installé sur Windows. Le JSON contient des informations de compte : ne le partagez pas publiquement.

## CORS et navigateur Dyad

Les origines acceptées sont **http://localhost** et **http://127.0.0.1**, avec n'importe quel port local : cela couvre le port dynamique de l'aperçu Dyad. Les credentials/cookies sont exclus, les origines distantes ou `null` refusées. L'adresse Host et l'adresse cliente doivent aussi être locales, afin de limiter notamment les attaques de DNS rebinding.

Les anciens précontrôles Chromium Private Network Access sont pris en charge pour une origine locale autorisée. Les navigateurs récents peuvent également demander une permission « accès au réseau local » ; CORS ne peut pas contourner un refus de permission du navigateur.

Un aperçu hébergé à distance, HTTPS, sandboxé avec une origine `null`, ou ouvert sur un autre ordinateur peut être bloqué par CORS, mixed content ou les permissions réseau local. **Utilisez l'aperçu HTTP localhost de l'application sur le même PC Windows**. Si l'iframe bloque, ouvrez ce même aperçu local dans un onglet de navigateur. N'exposez pas la passerelle à Internet et n'ajoutez pas `*` aux origines autorisées.

## Dépannage

- **Python / py introuvable** : modifiez l'installation Python Windows 64 bits pour installer le Launcher, puis relancez le fichier BAT.
- **Pas de distribution MetaTrader5 compatible** : utilisez Python Windows 64 bits compatible (3.11/3.12 conseillé). Supprimez uniquement `.venv-mt5` si l'installation initiale a échoué, puis relancez le BAT. Cela ne supprime aucun paramètre ou historique de l'application.
- **Port 8765 déjà utilisé** : fermez l'autre instance de la passerelle, puis relancez. Ne changez pas le bind en adresse réseau publique.
- **Aucun terminal accessible** : ouvrez MT5 64 bits sous le même utilisateur Windows, sans différence d'élévation administrateur entre MT5 et la passerelle.
- **Plusieurs terminaux ouverts** : le plus simple est de fermer ceux qui ne sont pas votre terminal VT Markets DEMO. Sinon, dans Windows, recherchez « Modifier les variables d'environnement pour votre compte », ajoutez une variable utilisateur **MT5_TERMINAL_PATH** dont la valeur est le chemin complet du `terminal64.exe` voulu (sans guillemets), puis relancez le BAT depuis l'Explorateur. Le terminal ciblé doit déjà être ouvert. Aucun mot de passe n'est ajouté.
- **Initialisation refusée / -6** : vérifiez le Journal du terminal et la connexion du compte DEMO dans MT5. La passerelle ne réessaie pas un autre compte et ne demande aucun identifiant.
- **Bougies absentes** : vérifiez le symbole exact et ouvrez son graphique pour charger les données. Un nombre inférieur à 300 est affiché tel quel. Aucun historique futur ou prix manquant n'est inventé.
- **BID/ASK absent mais compte connecté** : vérifiez l'Observation du marché et l'état du marché. L'état du terminal et l'absence de cotation sont affichés séparément.
- **JSON accessible mais test UI bloqué** : vérifiez l'origine HTTP localhost de l'aperçu, ses permissions d'accès au réseau local et les restrictions de l'iframe. Ouvrez l'aperçu local dans un onglet si nécessaire.

La compilation TypeScript ne peut pas valider le package natif MetaTrader5 ni votre terminal Windows. La vérification réelle doit être faite sur ce PC avec les comparaisons ci-dessus ; aucun résultat de connexion n'est simulé.
