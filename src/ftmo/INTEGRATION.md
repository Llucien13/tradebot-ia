# GOLD M15 — FTMO 20K EUR : intégration et limites de validation

## Code original conservé

L'archive fournie est conservée sans modification dans `reference/TradeBot_FTMO_20K_EUR_Backtest_PAPER_2025_2026.zip`. Les scripts `REPRODUIRE_20K.py`, `FTMO_20K_EUR_RUN.py`, `lab/recherche_m15.py`, `lab/moteur_sortie_M5.py`, `lab/run_filters.py` et le rapport ont été extraits sans réécriture.

Au démarrage de la passerelle, `verify.extract_reference` extrait les CSV et autres résultats nécessaires depuis cette archive. Il refuse les chemins sortant du dossier de référence et refuse un fichier existant dont les octets diffèrent de l'archive. Un message « référence originale modifiée » bloque le module FTMO, sans réinitialiser vos données ni casser volontairement les routes MT5 historiques.

`frozen.py` exécute les expressions originales de préparation et de filtrage via l'AST Python. Seul le chargeur de CSV est remplacé par des DataFrames provenant de MT5. Les blocs `main`, les grilles de recherches et les anciennes optimisations ne sont jamais exécutés. Le replay de comparaison utilise directement `FTMO_20K_EUR_RUN.replay`.

### Règles originales réellement trouvées

- Cassure confirmée à la clôture de la dernière M15, avec bougie de déclenchement haussière/baissière dans le sens de la cassure.
- Huit M15 précédentes **excluant la bougie de déclenchement** : `shift(2).rolling(8)` ; pas une cassure de la bougie en formation.
- EMA50 supérieure/inférieure à EMA200, sans filtre de prix supplémentaire : `ewm(span=..., adjust=False, min_periods=...).mean().shift(1)`.
- Momentum M30, H4, D1 : clôture moins clôture trois barres auparavant. Une barre supérieure est libérée seulement à l'ouverture de la suivante (`htf_asof`).
- ATR14 = moyenne simple des true ranges des 14 M15 clôturées, **pas un ATR de Wilder**. Stop à 2,5 ATR ; distance admissible originale entre 0,60 et strictement 100 USD/oz.
- Aucun signal sur la première M15 après un trou de cotation ; une position à la fois. Pas de break-even ou trailing.
- TP2,5R pour la référence ; TP5R uniquement dans les comparaisons archivées/recalculées.
- Le replay original entre à l'ouverture M15 et utilise les sous-barres M5 complètes et cohérentes, sinon le fallback M15 conservateur. Si SL et TP touchés dans la même sous-barre, SL prioritaire. Il ne reprend pas une entrée dans le reste de la M15 de sortie.
- Timeout après 32 bougies natives M15, pas après huit heures civiles à travers un week-end.

La description « 25k » en tête du script original est un ancien intitulé : la constante effectivement utilisée dans ce fichier est `START_EQ=20000`. Le fichier n'a pas été corrigé pour préserver l'original.

## Démarrer sous Windows, sans commandes à saisir

1. Gardez les nouveaux fichiers dans leur arborescence actuelle sur le PC Windows. Python 64 bits 3.11/3.12 avec le Launcher est conseillé.
2. Si une ancienne passerelle tourne, fermez sa fenêtre. Double-cliquez sur `start_mt5_bridge.bat` à la racine. Il complète l'environnement existant avec pandas, numpy et tzdata si nécessaire. `tzdata` fournit Europe/Prague sur Windows.
3. Ouvrez MT5 sous le même utilisateur Windows et connectez votre compte **FTMO-Demo**. Affichez **XAUUSD** et EURUSD. Ouvrez/synchronisez les graphiques XAUUSD M5/M15/M30/H1/H4/D1. Le lecteur de signaux d'origine calcule également des indicateurs H1 auxiliaires, sans activer de filtre H1 supplémentaire. XAUUSD-ECN reste réservé aux anciens flux et backtests VT Markets ; leurs données ne sont pas renommées.
4. Ouvrez l'aperçu **HTTP localhost** de Dyad sur ce PC, puis **Connexion MT5**. Autorisez l'accès au réseau local si demandé. Pendant l'étape B, le démarrage est suspendu dans l'interface : les instructions START ci-dessous décrivent le service conservé, pas une autorisation de démarrage.
5. Cliquez sur **Tester la connexion MT5**, puis **Tester le flux FTMO / MT5**. Les cotations Gold et EUR/USD doivent avoir moins de 15 secondes pour le second test. Il vérifie aussi la présence de la M15 courante et les historiques nécessaires. `/ftmo/state` donne `feed.symbol: XAUUSD` et les comptes de bougies dans `feed.bars`. Aucune donnée manquante n'est inventée. Marché fermé : le test peut refuser un tick ancien. Détails : `src/mt5_bridge/INSTALLATION.md`.
6. Les contrôles **Vérifier le moteur original** se trouvent dans **Paramètres**. Ils relisent les quatre replays (2025/2026 × 2,5R/5R) uniquement sur action explicite. Aucun ancien programme d'optimisation n'est lancé. Le rapport doit devenir **PASSED**. En cas d'erreur ou d'écart, les champs/colonnes concernés sont affichés, et START reste bloqué.
7. Renseignez explicitement les **swaps signés USD par lot et par nuit**, et l'heure UTC du rollover broker. Les valeurs brutes MT5 peuvent être en points ou dans une autre devise selon `swap_mode` : elles ne sont **pas** automatiquement assimilées à des USD. Vérifiez leurs unités dans les spécifications. Le multiplicateur du jour triple vient de `swap_rollover3days`. Des swaps nuls ne sont pas présumés. Commission et slippage par défaut sont les hypothèses historiques, pas une certification des frais FTMO.
8. Cliquez volontairement sur **START BOT PAPER**. Le compte démarre sur 20 000 € virtuels, indépendamment de votre solde MT5. Une entrée n'est envisagée qu'à une nouvelle ouverture M15, jamais en rattrapant un signal manqué au START. Les 5R ne sont pas activés.
9. Gardez Windows, MT5 et la passerelle ouverts, sans veille. **STOP** bloque les nouvelles entrées ; une position virtuelle existante reste surveillée jusqu'à une sortie de stratégie ou de limite. Fermer la page n'arrête pas la passerelle. Fermer la passerelle interrompt le suivi.
10. Au redémarrage de la passerelle, le registre reste conservé mais le bot est **STOPPED**. La passerelle peut reprendre la surveillance d'une position virtuelle restante, mais jamais les nouvelles entrées automatiquement.

## Simulateur et stockage

- Journal indépendant : `%LOCALAPPDATA%/TradeBotIA/ftmo20k/challenge.json`, remplacement atomique et fsync, verrou intra-processus, un seul serveur Uvicorn. Aucun localStorage des stratégies existantes n'est modifié.
- Phase1 : capital 20 000 €, objectif de solde clôturé 22 000 €, minimum quatre jours avec une entrée virtuelle (Europe/Prague).
- Phase2 : nouveau capital 20 000 €, objectif 21 000 €, quatre nouveaux jours, résultats conservés séparément. Le succès global nécessite les deux phases et aucune position ouverte.
- Limite journalière : equity >= solde à minuit Prague - 1 000 €. Minuit Prague suit l'heure d'été/hiver grâce à zoneinfo/tzdata. Gains flottants et commissions sont pris en compte ; l'equity réserve aussi les frais d'une liquidation virtuelle.
- Limite totale fixe : equity >= 18 000 €, non glissante. Le pic d'equity sert uniquement à la statistique de drawdown, jamais au plancher FTMO.
- En cas de dépassement détecté, arrêt des entrées et liquidation **virtuelle** au tick observé. Aucune requête broker.
- Risque initial : au plus 0,5 % de l'equity disponible, donc 100 € au départ, sous les hypothèses de coût déclarées. Contract size, minimum/pas/maximum des lots viennent de MT5. Une réserve de coût pour un rollover triple négatif est ajoutée au sizing. Le levier virtuel reste 1:20. Gaps, spread futur et coûts variables peuvent dépasser ce risque initial planifié.
- P&L de prix calculé en USD, commissions et swaps convertis vers EUR au taux observé. Les commissions d'entrée et de sortie sont déduites séparément. Le taux est le midpoint du tick EUR/USD, pas un taux commercial garanti ; frais de conversion supplémentaires non modélisés.
- Le journal fournit les trades, positions, SL/TP, equity, mesures par phase, gains journaliers/mensuels, interruptions et export JSON. **Archiver / nouveau challenge** sauvegarde l'ancien registre dans le même dossier avant de repartir ; cela ne supprime pas l'archive historique.

## Vérification et fidélité : ce qui est prouvé et ce qui ne l'est pas

`verify.py` ajoute des tests de limites quotidiennes/totales, reset Prague hiver/été, minima de jours, transitions de phases, risque initial et comptabilité USD/EUR incluant commissions/swaps. Il compare les signaux, distances de stop et horodatages de l'adaptateur à des points ciblés de l'original.

Les quatre replays utilisent ensuite l'original et comparent dates de phase, gains, nombre de trades et **toutes les colonnes des transactions** aux CSV archivés (tolérance numérique explicite). Un rapport d'erreur n'est jamais remplacé par un succès supposé. Les versions pandas/numpy, l'empreinte de l'archive et l'empreinte du code sont enregistrées. Un rapport positif d'une ancienne version est marqué STALE et ne débloque pas START.

**La compilation web ne teste pas Python, le package natif MetaTrader5 ou votre terminal Windows.** Les replays et la connexion doivent être exécutés sur ce PC via les boutons ci-dessus ; aucune connexion ou reproduction n'est annoncée comme réussie avant leurs résultats.

### Écarts connus par rapport aux archives

1. Replay historique : jour serveur utilisé comme proxy du reset ; PAPER actuel : Europe/Prague réel. Cela peut changer les limites journalières et les jours comptabilisés.
2. 2025 : change fixe hypothétique 1,15. 2026 : prix EUR/USD M5 moyen ouverture/clôture indexé au début de barre. Ce dernier proxy peut utiliser une clôture qui n'était pas encore disponible à l'instant intrabar du trade. Il est conservé dans la reproduction, mais **pas utilisé pour le PAPER causal**, qui lit seulement les ticks déjà observés.
3. Les premières sorties 2025 utilisent parfois M15 faute de sous-barres M5. Le PAPER utilise les ticks BID/ASK lus et non un OHLC de sortie supposé.
4. Entrée PAPER au tick observé dans les dix premières secondes d'une nouvelle M15, pas un fill garanti à son ouverture historique. SL/TP restent construits depuis le BID de référence avec la distance originale ; fills exécutables virtuels ASK/BID et slippage sont comptabilisés. Les sorties peuvent dépasser SL/TP en cas de gap ou de retard.
5. Les EMA du PAPER sont initialisées depuis les 4 000 dernières M15 disponibles, et non depuis le tout premier CSV d'archive. La formule est identique ; le seed peut donner une différence proche d'un croisement.
6. Swaps PAPER : valeurs signées explicitement configurées, appliquées au rollover UTC déclaré avec multiplicateur triple. Attribution des jours de rollover selon dates UTC, taux fixes déclarés et conversion au tick disponible : ce n'est pas un relevé exact de swaps broker/FTMO. Vérifiez ces conventions et leurs changements. Les archives n'incluaient pas de swaps.
7. Suivi toutes les deux secondes, **pas tous les ticks**. Une excursion d'equity ou un contact SL/TP entre lectures peut être manqué. Toute déconnexion/absence de ticks arrête les entrées, marque le suivi non continu et conserve l'incident. Aucun résultat n'est une preuve de respect continu en conditions réelles, même sans interruption détectée.

Les quatre références positives sont des résultats de l'archive, pas des paiements ou une validation officielle FTMO. Les périodes ont participé à la sélection de la stratégie : ce n'est pas hors échantillon. Les mêmes réserves s'appliquent au test de spread 0,60 (2,5R atteint les deux phases ; 5R ne termine pas la phase2 avant le 9 octobre 2026).

## Sécurité et protection des autres stratégies

Il n'existe aucun appel d'envoi d'ordre dans ce module. Les routes POST ne contrôlent que le **journal virtuel**, les archives locales et le lancement d'une vérification Python à arguments fixes (`shell=False`). Les routes MT5 originales `/status` et `/candles` conservent leur contrat. CORS autorise GET/POST uniquement depuis les origines HTTP localhost/127.0.0.1 et le serveur reste limité à 127.0.0.1:8765. Aucun mot de passe n'est demandé.

Les seuls raccordements web sont la route `/ftmo-20k` dans `src/App.tsx`, la navigation et un lien sur l'accueil. Les moteurs Base/Scalping/M5/H1, Tendance Simple R, Multi-Positions, leurs configurations et leurs historiques n'ont pas été modifiés. Aucun sélecteur de régime n'a été réintroduit.
