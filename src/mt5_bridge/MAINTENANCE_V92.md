# Maintenance V92 — audit et reconnexion MT5 sécurisés

Cette procédure sépare l’étiquette affichée, le serveur web, les assets du frontend, la passerelle Python et l’exécutable Electron. Un libellé V86 en dur n’est pas la preuve qu’un vieux processus tourne. Les preuves sont consignées dans un rapport local horodaté; aucune valeur n’est supposée.

## Tâches VS Code

Dans **Terminal → Exécuter la tâche** :

- **V92 : audit versions sans action** — inventorie les PID, chemins, sessions, propriétaires des ports 3088/8765, empreintes sur disque et versions retournées par les services loopback. La sonde bridge est en lecture seule et n’initialise pas MT5.
- **V92 : préparer livraison isolée (confirmation)** — demande `PREPARER V92`, puis construit le frontend/serveur Nitro dans un nouveau dossier sous `%LOCALAPPDATA%\TradeBotIA\maintenance-v92\`. Ne remplace pas `.output`, l’installation Electron, la passerelle, MT5 ni les registres PAPER. Ce n’est pas un déploiement.
- **V92 : vérifier IPC et PAPER (confirmation)** — demande `VERIFIER IPC`, puis utilise la passerelle existante pour une lecture normale de `/status` et un contrôle de fraîcheur. N’effectue ni START ni reset SAFE_STOP. Cela peut essayer l’initialisation normale par la passerelle si sa porte IPC l’autorise; ce n’est pas une simple inspection passive.

Les rapports d’audit sont dans `%LOCALAPPDATA%\TradeBotIA\maintenance-v92\`; les rapports de connexion dans `%LOCALAPPDATA%\TradeBotIA\diagnostic-v91\`. Ils peuvent contenir des chemins, noms d’utilisateur et numéro de compte : masquer ces éléments avant transmission.

## Interprétation

- `api/runtime-version` prouve l’identité du serveur web qui répond, pas celle du DOM déjà affiché dans Electron.
- `tradebot-build.json` et les SHA-256 d’assets comparés prouvent les fichiers servis, pas un cache navigateur Electron. Le rapport note explicitement que ce cache n’est pas directement attesté.
- `/diagnostics/mt5-ipc` rapporte la version et l’empreinte des sources chargées par le processus passerelle, puis les compare à l’empreinte calculée des sources du projet. Un endpoint absent, PID incohérent ou hash divergent signifie que la version de cette passerelle n’est pas certifiée.
- L’API MT5, le chemin du terminal, le compte FTMO-Demo et les ticks ne sont déclarés valides que s’ils sont réellement renvoyés par le processus de passerelle. Le code retour 0 d’un audit ou d’une construction ne valide jamais la connexion.

## Si une relance devient nécessaire

Ne procéder qu’après examen du rapport et une confirmation distincte de l’utilisateur. D’abord déterminer le PID exact du serveur/passerelle, l’éventuel lanceur automatique et le dossier de données effectif; ne jamais arrêter tous les Python ou tous les `terminal64.exe`. Fermer proprement **la seule passerelle concernée**, préserver et sauvegarder son registre et ses historiques pendant qu’elle est arrêtée, puis relancer une unique passerelle depuis le dépôt et le Python identifiés. Relancer l’interface n’est nécessaire que si son serveur web ou conteneur est également identifié comme ancien. Ne redémarrer MT5 que si un rapport ultérieur démontre qu’une action manuelle côté terminal est indispensable et après accord séparé.

Ne pas utiliser `lancer_tradebot_total.ps1` pour une maintenance: il lance `autostart_paper.ps1`. Ne jamais utiliser les scripts de démarrage général pendant que la connexion est incertaine. Aucun PAPER START, ordre, login, changement de compte, modification de GOLD M15, risque, design ou fichier de trading n’est effectué ici. LIVE reste désactivé et SAFE_STOP n’est jamais levé.
