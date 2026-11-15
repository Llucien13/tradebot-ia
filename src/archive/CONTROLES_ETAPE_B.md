# Contrôles de l’étape B

## Exécutés dans l’environnement de développement

- Contrôle TypeScript de tout le projet : aucune erreur.
- Compilation de production Vite + Nitro : réussie, y compris les modules chargés à la demande.
- Neuf assertions statiques réussies : quatre entrées de navigation, quatre routes actives, redirections des anciennes routes, anciens fournisseurs non montés, validation des coûts inchangée, formules de statistiques identiques à l’interface FTMO archivée, absence de création automatique de sauvegardes, transactions historiques sur ouverture explicite, démarrage PAPER désactivé dans l’interface.
- Différences du registre affiché : uniquement pagination et présentation. Agrégations journalières/mensuelles, durée des phases et export intégral inchangés.
- Différences du lecteur d’archives : liste légère des copies puis lecture individuelle ; collecte et déduplication des résultats inchangées.
- Différences du stockage de sauvegardes : ajout d’une lecture de résumés, sans changement du schéma, de version, d’encodage ou des méthodes d’écriture/restauration existantes.
- Aucun fichier moteur, contrôle de risque, signal GOLD, API FTMO, passerelle Windows ou fichier de dépendances changé. Aucune suppression de fichier.
- Aucun journal client de niveau erreur trouvé lors du contrôle disponible. Cela n’est pas une preuve de parcours interactif complet.

## Chargement de production

Le module d’entrée minifié passe d’environ 1 272 Ko dans la compilation précédente à 438 Ko. Les vues d’historique, graphiques, MT5 et sauvegardes sont des modules séparés. Cette comparaison mesure la taille compilée, pas un temps de réponse testé sur le PC Windows.

## À vérifier par interaction, sans démarrer de bot

1. Ouvrir les quatre rubriques sur ordinateur et mobile ; vérifier les boutons et redirections.
2. Dans Paramètres, afficher les outils de sauvegarde puis ouvrir la liste : vérifier la présence des copies existantes. Leur nombre de référence au moment de la sauvegarde extérieure était 493 ; des sauvegardes explicitement créées depuis peuvent l’augmenter.
3. Dans Historique, lire les résultats antérieurs et exporter les enregistrements souhaités. Les quatre enregistrements durables initiaux peuvent être complétés par des résultats récupérés des copies et dédupliqués ; le nombre présenté n’est pas nécessairement le nombre brut IndexedDB.
4. Fermer et rouvrir une vue : les données persistées doivent rester accessibles. Le brouillon de coûts non appliqué survit à la navigation, pas à un rechargement du navigateur.

## Restent non exécutés / non certifiés

- Connexion réelle au terminal MetaTrader 5 sur Windows.
- Initialisation et persistance du nouveau registre FTMO sur le PC Windows.
- Vérifications unitaires et quatre replays originaux exécutés par la passerelle Windows.
- Fidélité des résultats et respect continu des limites lors d’une simulation actuelle.

Aucun de ces contrôles Windows n’a été lancé automatiquement par l’étape B. Ne pas présenter compilation, inspection du code ou sauvegarde externe comme leur validation. Ne pas effacer le cache du navigateur ni supprimer de données pour effectuer ces contrôles. Toute suppression définitive attend une seconde autorisation explicite.
