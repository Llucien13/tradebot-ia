# Sauvegarde préalable à l’étape B

La simplification reste bloquée tant que la copie extérieure n’est pas vérifiée. Aucun moteur, signal, calcul de risque, fichier original ou historique n’est supprimé par ces outils.

1. Laisser les bots arrêtés, en PAPER exclusivement, LIVE désactivé. Fermer les autres onglets de l’application. Ne pas effacer le cache et ne pas rafraîchir l’aperçu avant l’export. L’export refuse une ancienne simulation active ou une position/entrée virtuelle en attente ; il ne les clôture pas.
2. Dans **Sauvegarde**, cliquer **Exporter toutes les données du navigateur**. Ce nouvel export inclut les configurations TradeBot enregistrées, les bases IndexedDB d’historiques et de sauvegardes, les sessions M1/M5 et les résultats actuellement accessibles. Une copie IndexedDB indépendante est restaurée et relue pour contrôle ; seules ses données temporaires sont ensuite retirées. Les bases originales ne sont jamais modifiées.
3. Fermer la passerelle locale après l’export, en conservant FTMO STOPPED / PAPER / LIVE OFF. Double-cliquer **sauvegarder_tradebot.bat** dans le dossier du projet sur le PC Windows de la passerelle. Python 3 et son interface Tkinter, normalement inclus avec Python pour Windows, sont nécessaires.
4. Sélectionner le nouvel export JSON, puis un dossier privé **extérieur au projet**. L’utilitaire réunit les sources, les configurations, les archives présentes dans le projet, l’export navigateur et `%LOCALAPPDATA%\TradeBotIA\ftmo20k`. Il refuse une destination interne et un registre FTMO actif ou incompatible. Il ne modifie aucun de ces fichiers.
5. Il vérifie le ZIP, l’extrait dans une copie temporaire extérieure, compare chaque fichier par taille et SHA-256, relit les données navigateur et FTMO et contrôle que les originaux n’ont pas changé entre-temps. Il écrit `verification.json` à côté du ZIP. Une erreur produit `FAILED`, jamais une certification.
6. Fournir **uniquement `verification.json`** à Dyad, avec la confirmation que l’export provenait de l’aperçu utilisé et que ce PC héberge bien la passerelle et ses historiques. Conserver le ZIP privé : il contient les données et les éventuels secrets `.env`. Ne pas téléverser cette archive dans l’application ni l’exposer dans `public/`.

## Périmètre et limites

- Le ZIP contient les éléments nécessaires à une restauration des sources et données présentes, pas une copie binaire de l’environnement installé. `.git`, `.dyad`, `node_modules`, `.venv`, `.venv-mt5`, `__pycache__`, `.output`, `dist`, `.vite` sont explicitement exclus comme métadonnées d’outils, environnements ou sorties régénérables. Les configurations et fichiers de dépendances présents sont inclus.
- Les résultats jamais persistés et déjà perdus avant cet export ne peuvent pas être récupérés. Les bases TradeBot inconnues et valeurs IndexedDB non portables entraînent un refus plutôt qu’un export incomplet présenté comme complet.
- Si le dossier FTMO n’existe pas, le rapport le signale. Ce statut ne prouve pas l’absence de données sur un autre PC : il faut alors sauvegarder le vrai PC de la passerelle avant l’étape B.
- Le rapport `VERIFIED` certifie l’extraction identique de cette archive. Il ne certifie **ni la connexion réelle au terminal MT5, ni la reproduction des backtests, ni le fonctionnement de l’application restaurée dans un environnement Windows indépendant**. Ces contrôles restent séparés.
- L’exécution de l’utilitaire sur votre PC n’a pas été effectuée par Dyad. La simple présence des outils dans le projet n’est pas une sauvegarde externe.
