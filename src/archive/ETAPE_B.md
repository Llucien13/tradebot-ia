# Étape B — archive non destructive

## Préalable retenu

Le rapport externe fourni par l’utilisateur annonce une archive hors projet VERIFIED, 253 fichiers extraits et comparés en SHA-256, 4 résultats durables, 493 copies navigateur et 12 entrées de configuration. Empreinte annoncée du ZIP : `f4dfc8002644f874f479ff66151c0f527752ae527b2888936662d1016332ab14`.

Le dossier `%LOCALAPPDATA%\TradeBotIA\ftmo20k` est absent selon le rapport et la vérification Windows de l’utilisateur. Le service crée ce dossier dès son initialisation. L’utilisateur confirme n’avoir jamais utilisé le simulateur FTMO 20K. Aucun registre FTMO préexistant n’est donc identifié pour cette installation. Cela ne constitue pas une recherche indépendante de tous les disques ou comptes Windows, ni une inspection directe du ZIP par Dyad.

## Interfaces conservées

Les versions précédentes de Index, Settings, Journal et FTMO20K ont été copiées sans modification dans `src/pages/archive/Legacy*.tsx`. L’ancienne navigation est dans `src/components/navigation/archive/LegacyAppNavigation.tsx`, et App.tsx est conservé textuellement dans `src/archive/App.before-stage-B.tsx.txt`.

Les pages ScalpingM1, ScalpingM5 et StrategyH1 restent à leur emplacement original. Leurs anciennes routes redirigent vers le tableau de bord ; elles ne sont plus proposées par la navigation. Leurs composants, laboratoires Multi-Positions, variantes, moteurs et historiques ne sont ni déplacés ni supprimés. Les anciennes interfaces ne sont pas importées par les routes actives.

## Périmètre actif

- `/` : tableau de bord FTMO 20 000 €, GOLD M15 2,5R.
- `/mt5` : connexion locale en lecture seule, bougies M15 et test du flux FTMO.
- `/historique` : registre PAPER, références GOLD M15 2,5R / 5R et exports des archives antérieures à la demande.
- `/settings` : cadre FTMO fixe, brouillon de frais non appliqué, vérifications Windows explicites, sauvegardes.

La page `/ftmo-20k` redirige vers `/`. Les coûts de présentation sont partagés pendant la navigation et ne sont jamais appliqués automatiquement. Le démarrage PAPER est suspendu dans l’interface pendant cette étape ; STOP reste accessible si la passerelle rapporte un bot actif. Les fonctions originales de démarrage et de réinitialisation sont conservées, mais aucun bouton actif ne les appelle. LIVE reste désactivé.

## Données et contrôles

Aucun moteur GOLD, simulateur, signal, calcul de risque, fichier de passerelle, format de stockage ou version IndexedDB n’est modifié. Aucune migration, suppression ou réinitialisation de données n’est exécutée. Les anciens fournisseurs de marché et moteurs PAPER ne sont plus montés dans la navigation active. Les exports d’archives lisent les données existantes sans les réexécuter.

Les références et leurs transactions, les anciens résultats et la liste des sauvegardes sont chargés à la demande. Le endpoint FTMO `state` et son contenu restent inchangés ; ses tableaux de registre restent inclus dans la réponse existante. La lecture différée concerne les archives et les vues lourdes, pas une nouvelle API de pagination du registre FTMO.

La compilation et les contrôles statiques doivent être distingués des essais interactifs du navigateur et des contrôles Windows. Connexion réelle MT5, replays historiques et fonctionnement du service FTMO sur Windows ne sont pas certifiés sans leur exécution. Toute suppression définitive nécessite une seconde validation explicite de l’utilisateur.
