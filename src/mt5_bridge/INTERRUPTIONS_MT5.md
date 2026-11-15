# Correctif ciblé : interruptions de cotations et IPC

## Comportement

- L'interface, le démarrage automatique, le risque, GOLD M15, les fichiers de données et les règles de stratégie ne sont pas modifiés. Aucun ordre MT5 n'est ajouté.
- La pause intrajournalière est reconnue uniquement sur un relevé natif MT5 récent (120 s maximum), lié au compte/serveur, avec la règle horaire serveur déjà vérifiée. `SymbolInfoSessionTrade` fournit les sessions du jour serveur pour XAUUSD et EURUSD. Aucune pause de 23 h n'est présumée. Les sessions absentes, incomplètes ou ambiguës restent inconnues, et non une preuve de marché fermé. Ces sessions décrivent le calendrier publié par le terminal, pas une garantie d'absence de fermeture exceptionnelle non publiée.
- Une pause confirmée utilise l'état existant `WAITING_QUOTES`, avec le motif « MARCHE FERME / EN ATTENTE DE COTATIONS ». Elle ne génère pas de SAFE_STOP de connexion et ne crée aucun trade. L'historique et les prix précédents ne sont pas effacés.
- Sans preuve de pause, les ticks périmés restent une attente de cotations non confirmée. Le seuil de 15 s, les conversions, le compte DEMO, les contrats et la synchronisation M15 restent contrôlés. Une connexion réellement défaillante est un arrêt de sécurité, pas une pause normale.
- À la reprise sans position, les séries sont revalidées avant MONITORING; aucun signal manqué n'est rejoué. Avec une position et une interruption supérieure à 15 s, le SAFE_STOP et la reprise explicite existants sont préservés : pas de reconstitution des excursions manquées.
- Les erreurs IPC natives (-10000 à -10005, notamment -10005) sont journalisées séparément. La passerelle limite les essais partagés à trois échecs IPC, espacés de 15 puis 30 s. Le worker PAPER arrêté sur IPC peut effectuer deux nouvelles vérifications de connexion, sans jamais lever SAFE_STOP. Après épuisement, intervention nécessaire; aucun redémarrage du terminal, compte de substitution ni reset du registre.
- Une liaison rétablie n'est pas une permission de trading. La reprise explicite repasse par les contrôles existants. Une pause utilisateur annule les tentatives du worker. Les délais sont mesurés par horloge monotone.

## Déploiement Windows

Le source `TradeBotClockProbe.mq5` existant est complété, mais son binaire `.ex5` n'a pas été recompilé ici. Dans MetaEditor, compiler le source actualisé (F7), vérifier zéro erreur puis relancer le relevé natif selon la procédure existante. Sans ce nouveau relevé, la détection de pause reste inconnue : les contrôles de fraîcheur continuent de bloquer les données périmées. Le démarrage automatique n'est pas modifié.

Le Python installé ne recharge pas ses modules à chaud; appliquer la mise à jour lors d'une relance contrôlée de la passerelle selon la procédure habituelle, sans lancer une seconde instance ni démarrer le PAPER pour tester.

## Tests préparés et état réel

Double-cliquer `tester_disponibilite_mt5.bat` dans l'Explorateur. Le lanceur utilise l'environnement `.venv-mt5` existant et lance les tests IPC/sessions et les suites de non-régression PAPER, horaires, V86/V87 et anti-gap. Il n'installe rien, ne démarre aucun worker et ne connecte aucun MT5. Le code de sortie 0 signifie uniquement réussite de la suite effectivement exécutée.

Pour référence technique, la commande Windows inscrite dans ce lanceur est :

```bat
.venv-mt5\Scripts\python.exe -m unittest -v test_mt5_availability test_paper_trial_time test_paper_trial_waiting test_paper_safety test_quote_time test_time_basis test_manual_positions_v87 test_monitor_v86 test_weekly_gap_v87
```

Elle nécessite le `PYTHONPATH` positionné par le BAT. Les tests ajoutés simulent une pause et sa reprise, une preuve expirée/autre compte, le timeout IPC, la temporisation et l'épuisement des tentatives, une connexion rétablie et le maintien de SAFE_STOP. Les suites existantes couvrent notamment cotations périmées, historique invalide, position conservée après interruption et absence d'ordres.

Dans cette intervention : revue statique uniquement. Aucun interpréteur Python, compilateur MetaEditor ou terminal MT5 n'est accessible via les outils disponibles. Aucun test Python/MQL5/Windows ni essai de reconnexion réel n'a été exécuté. Cette modification n'est donc pas déclarée validée. Les résultats de compilation web d'interventions antérieures ne valident pas ce correctif backend.
