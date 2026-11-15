# V87 — trading manuel MT5 séparé du bot PAPER

## Protection hebdomadaire anti-gap XAUUSD

La protection s'applique uniquement à la position enregistrée dans le registre ESSAI PAPER. Le service ne lit pas les positions MT5 pour cette fonction et ne comporte aucun chemin `order_send`, modification ou fermeture MT5. LIVE reste désactivé. Le worker FTMO challenge reste séparé. La stratégie GOLD M15, 2,5R, le risque maximal de 0,5 %, le capital virtuel de 20 000 EUR et la limite d'une position PAPER restent inchangés.

Le moteur consulte la politique anti-gap à chaque cycle (boucle de 2 s), avant le traitement d'un signal M15. La fenêtre T−60 min interdit toute nouvelle entrée; T−15 min provoque une tentative de clôture virtuelle. Une sortie n'est inscrite que lorsque le prix XAUUSD et la conversion EURUSD sont valides/frais (≤15 s), l'identité serveur/compte correspond à la position, et le marché est toujours ouvert. Prix exécuté simulé : BID pour clôture achat / ASK pour clôture vente, avec le slippage configuré dans le registre; coûts de sortie et P&L sont calculés par le moteur PAPER. Aucun prix de clôture n'est inféré après fermeture ou sur cotation périmée/invalide. Dans ces cas la position reste ouverte, la surveillance attend des cotations ou le marché et un événement est conservé pour Telegram/monitoring. Les interruptions avec position au redémarrage restent soumises à la reprise explicite existante : aucune clôture automatique au redémarrage.

### Calendrier vérifié requis (aucune heure supposée)

Aucun horaire hebdomadaire FTMO n'est codé en dur. Le fichier est lu depuis `%LOCALAPPDATA%\TradeBotIA\essai-paper20k\verified-weekly-market.json`, ou le chemin explicite contenu dans `TRADEBOT_PAPER_MARKET_SCHEDULE`. Sans calendrier valable, toutes les entrées sont bloquées. Le format version 1 attendu :

```json
{
  "schemaVersion": 1,
  "symbol": "XAUUSD",
  "server": "NOM_SERVEUR_MT5",
  "login": "IDENTIFIANT_COMPTE",
  "verifiedAtUTC": "AAAA-MM-JJTHH:MM:SSZ",
  "expiresAtUTC": "AAAA-MM-JJTHH:MM:SSZ",
  "evidence": {
    "sourceURL": "https://ftmo.com/…",
    "verifiedBy": "Nom du vérificateur",
    "exceptionsChecked": true,
    "utcAndDSTChecked": true,
    "file": "copie-locale-du-document-officiel.pdf",
    "sha256": "SHA256_HEXADECIMAL_DU_DOCUMENT"
  },
  "sessions": [
    {"openUTC": "…Z", "weeklyCloseUTC": "…Z", "reopenUTC": "…Z"}
  ],
  "exceptions": [
    {"closedFromUTC": "…Z", "closedUntilUTC": "…Z"}
  ]
}
```

Chaque session doit provenir des horaires applicables au symbole et au serveur de trading; vérifier explicitement le fuseau UTC, les transitions DST et les fermetures exceptionnelles (jours fériés/maintenance), puis dater l'attestation. La liste `exceptions` est obligatoire, même vide, et chaque fermeture doit être incluse dans une session. Le système impose serveur/login courants, URL HTTPS du domaine officiel FTMO, empreinte SHA-256 de la copie locale, date UTC, expiration ≤8 jours, 1–16 sessions, et cohérence ouverture < fermeture < réouverture. L'empreinte prouve l'intégrité de la copie comparée, pas l'authenticité de sa lecture. Ces contrôles techniques ne rendent pas le calendrier officiel par eux-mêmes. Si le calendrier change ou si une exception n'est pas confirmée, renouveler l'attestation depuis la source officielle avant reprise. Ne pas remplir le fichier à partir d'un horaire supposé.

Le tableau **Premium Control Desk → Positions** affiche statut, échéance et compte à rebours local. Le compte à rebours est figé si l'observation/heartbeat est obsolète ou le calendrier expiré; un moteur arrêté/en attente affiche un avertissement distinct, même si le thread continue à vérifier le calendrier. Les événements anti-gap persistent dans la file d'observation et les alertes utilisent l'option Telegram **SAFE_STOP et protection anti-gap**; l'alerte n'implique pas une clôture réalisée. Seule une sortie PAPER enregistrée atteint le statut `CLOSED`; le simple passage de l'heure de fermeture ne suffit pas. Après réouverture, il faut une session attestée couvrant le nouvel instant.

## V86/V87 : lecture des positions manuelles

V87 conserve la **lecture seule** des positions actuellement présentes dans MT5. L'API ne propose aucune ouverture, modification de SL/TP, fermeture, `order_send` ou reconnexion. Les positions manuelles ne sont ni comptées dans la limite PAPER, ni intégrées aux performances PAPER.

Le compte et les positions sont interrogés en lecture seule depuis le terminal déjà connecté, sous le verrou partagé. Déconnexion, incohérence d'identité ou réponse absente ne sont jamais affichées comme compte vide. `MANUAL` exige un compte hedging, une raison MT5 reconnue (client/mobile/web) et magic nul; en netting/exchange la position est une agrégation dont l'indépendance des contributions ne peut être promise.

## Tests et commande Windows

`test_weekly_gap_v87.py` apporte des tests déterministes avec calendrier, preuve documentaire factice et cotations simulées. Il couvre limites exactes T−60/T−15, horaires absents/expirés, cohérence identité, fermeture réussie/frais/frais simulés, quote trop ancien, absence de clôture fictive, cycle indépendant d'un nouveau signal M15, reprise après redémarrage et non-intervention sur un trade manuel. Le test de fichier ne prouve aucune heure réelle et n'authentifie pas FTMO.

Lancer depuis l'Explorateur Windows :

```bat
src\mt5_bridge\valider_monitor_v86.bat
```

ou depuis une invite de commandes ouverte à la racine du dépôt :

```bat
.venv-mt5\Scripts\python.exe src\mt5_bridge\run_monitor_v86_tests.py
```

Le premier BAT exécute aussi le contrôle TypeScript s'il est disponible; aucun bridge, worker, START, ordre MT5 ou backtest n'est lancé. Les rapports Python sont sous `%LOCALAPPDATA%\TradeBotIA\validation-v87\`. Des fixtures qui passent ne valident pas une session de marché réelle, le calendrier attesté ou la réception Telegram. Ne pas déclarer la protection validée avant exécution effective des tests et revue de l'attestation horaire applicable. Les tests disponibles doivent être lancés sur l'environnement Windows du produit.

## Architecture V86 conservée

L'observateur monitoring ne pilote pas le moteur PAPER. Le journal et l'outbox SQLite persistent indépendamment du registre de trades. Les notifications Telegram sont optionnelles, désactivées par défaut, sans secret transmis au navigateur. Un résultat de livraison réseau incertain n'est pas renvoyé automatiquement.
