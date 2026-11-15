# V76 — frais FTMO, preuves historiques, UTC

## Périmètre strict

GOLD M15 2,5R, capital virtuel 20 000 EUR, PAPER, LIVE désactivé. Aucun changement de stratégie, de `core.py`, `frozen.py`, `ftmo_service.py`, `verify.py` ou des résultats historiques. Aucun lancement de service, bot, ordre MT5, replay ou deuxième stratégie dans cette intervention. Le diagnostic ne modifie ni les coûts du registre ni `verification.json`.

## 1. Frais : lecture des vraies unités MT5

`preparation_evidence_v76.py` collecte `symbol_info("XAUUSD")` sur le compte DEMO FTMO-Demo. Il conserve les données brutes, serveur/login, devise du compte, date d'observation, formule et facteur de conversion.

Modes ENUM_SYMBOL_SWAP_MODE traités :

- 0 DISABLED : zéro uniquement si le mode et les deux valeurs natives sont cohérents.
- 1 POINTS : `swap * point * trade_contract_size` uniquement pour un contrat linéaire explicitement reconnu et de profit USD.
- 2 CURRENCY_SYMBOL : devise **de base**, pas automatiquement devise de profit USD. XAU n'est pas traité comme USD.
- 3 CURRENCY_MARGIN : devise de marge déclarée.
- 4 CURRENCY_DEPOSIT : devise du compte déclarée.
- Pour les modes monétaires, USD reste inchangé; EUR exige EUR/USD validé en identité, BID/ASK et UTC, avec ancienneté 0–15 s. Le taux mid suit la convention FX existante du moteur PAPER.
- Les modes intérêt/réouverture et autres devises restent bloqués, sans approximation.

Les montants conservent leur signe et sont exprimés en USD/lot/rollover simple. Le jour triple est relevé séparément, jamais multiplié une seconde fois lors de la conversion. Le diagnostic compare ces montants au registre et signale les écarts sans les injecter.

**Limite non levée :** l'API Python `symbol_info` ne fournit pas l'heure de rollover. `swapHourUTC` reste null dans les preuves collectées; aucune heure n'est déduite de `swap_rollover3days`, de l'heure serveur ou des sessions. Une spécification FTMO confirmant l'heure et ses changements annuels est nécessaire. La disponibilité d'un montant converti ne rend pas la configuration complète.

## 2. NOT_RUN et rapports archivés

Le lecteur existant compare les quatre JSON et leurs CSV de transactions à l'archive ZIP locale sans extraction ni exécution. Il examine désormais aussi les fichiers `verification*.json` dans `src/ftmo`, ses références, le dossier du rapport moteur, ainsi que les membres correspondants du ZIP.

Chaque candidat est soumis aux contrôles existants d'empreintes, tests et preuves de replay/signaux. Aucun rapport n'est installé automatiquement et aucun statut moteur PASSED n'est créé. Les résumés de backtests seuls ne prouvent pas l'exécution des contrôles du moteur. Les erreurs de recherche, candidats rejetés et raison de NOT_RUN sont conservés dans le rapport final.

Le fichier joint `attachments:verification.json` a été lu : format `tradebot-external-backup-verification`, statut `VERIFIED`, `mt5WindowsConnectionVerified=false`, `backtestReproductionVerified=false`. Il atteste une sauvegarde externe, pas la validation du moteur. Le lecteur le rejette désormais avec cette explication précise. Il n'a pas été copié dans le registre.

L'intégrité des vrais fichiers ZIP/CSV locaux n'a pas été calculée dans cette session : elle sera contrôlée sous Windows. Une empreinte locale ne constitue pas, à elle seule, une attestation indépendante de provenance.

## 3. UTC : cause Python conservée, sans correction arbitraire

Le collecteur indique l'étape exacte : lecture du fichier, schéma, identité compte, drapeau Tester, autotests, validation Python de la base temporelle. Il conserve le message d'erreur Python original, même si le script PowerShell s'arrête ensuite pour cotations indisponibles.

Le rapport inclut désormais :

- serveur/login connectés et capture native, correspondances d'identité;
- temps UTC Python, âge signé de la preuve, écarts serveur–GMT et TimeCurrent–TimeTradeServer;
- captures Python de ticks/bougies et résultats des autotests UTC;
- règle IANA **déjà déclarée** dans la preuve, source déclarée, offset attendu à la capture et éventuelle contradiction;
- calendrier des transitions de l'année de la capture calculé depuis ce fuseau déclaré.

Aucun fuseau n'est choisi automatiquement. Ce calendrier décrit la règle déclarée, pas une preuve que FTMO l'applique. `annualPolicyExternallyVerified=false` reste explicite : la présence d'un texte de source ne certifie pas son contenu. Une confirmation FTMO de la règle annuelle reste requise pour lever ce blocage. Les validations de `time_basis.py` et la sonde native sont inchangées : preuve 120 s, ticks 0–15 s, refus de compte différent, DST ambiguë et données futures inchangés.

La cause actuelle sur le PC ne peut être affirmée avant lecture du nouveau rapport Windows. Aucun rapport local de la session courante n'a été fourni ici.

## Fichiers créés ou modifiés dans cette intervention

- `src/mt5_bridge/preparation_evidence_v76.py` : nouveau collecteur des frais et du contexte UTC/DST.
- `src/mt5_bridge/clock_evidence.py` : intégration en lecture seule, schéma diagnostic 76.
- `src/mt5_bridge/historical_evidence.py` : recherche de rapports archivés et rejet explicite des attestations de sauvegarde.
- `src/mt5_bridge/controler_preparation_paper.ps1` : conservation des preuves avant arrêt, comparaison des frais, motifs précis NOT_RUN/UTC et détection d'un collecteur ancien.
- `src/mt5_bridge/test_preparation_v76.py` : 14 tests isolés sur les conversions et le contexte UTC.
- `src/mt5_bridge/test_historical_evidence.py` : tests de l'attestation de sauvegarde et de la recherche sans restauration.
- `src/mt5_bridge/test_clock_diagnostic_v75.py` : assertions sur les nouvelles preuves V76 et leur conservation lors d'un échec.
- `src/mt5_bridge/test_preparation_diagnostic.py` : contrat de conservation des erreurs avant arrêt cotations.
- `src/mt5_bridge/valider_diagnostic_v75.bat` : ajoute les tests V76 ciblés; nom conservé pour le lanceur existant.
- `.vscode/tasks.json` : tâche unique de diagnostic final V76.
- Le présent rapport.

## Vérifications réalisées et prochaines vérifications

Effectués ici : lecture des sources, du fichier de sauvegarde joint, revue statique finale des imports, conversions et appels. Aucun appel MT5 ni exécution des tests n'était disponible avec les outils de cette session. Les tests ont été préparés, pas annoncés réussis.

Commande unique **dans la palette VS Code sous Windows** : `Tasks: Run Task` / `Tâches : Exécuter la tâche`, puis **FTMO PAPER V76 : diagnostic final sans demarrer**.

La tâche valide d'abord les tests ciblés et le SelfTest, puis collecte environ trois minutes d'observations si les gardes passent. Les BAT peuvent attendre une touche à la fin de leur étape. La passerelle doit être déjà disponible sur 127.0.0.1:8765 et avoir chargé le collecteur V76; sinon le diagnostic signale une version ancienne et s'arrête. Il ne recharge ni ne redémarre un processus Python ou MT5 automatiquement.

Les rapports privés sont dans `%LOCALAPPDATA%\TradeBotIA\diagnostics-paper`. Lire `historicalEvidence`, `ftmoFeesEvidence`, `utcValidationDetails`, `nativeProofReadError` et `clockTests`.

**Verdict conservé : NON_PRET_CONTROLES_PARTIELS, code 2.** Aucun démarrage n'est autorisé par cette collecte. Ni NOT_RUN, ni heure de rollover manquante, ni preuve UTC insuffisante ne sont contournés.
