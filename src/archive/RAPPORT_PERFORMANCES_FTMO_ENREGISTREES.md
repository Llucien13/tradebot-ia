# FTMO 20K — résultats déjà enregistrés

## Nature et périmètre

Rapport établi par lecture des fichiers existants, sans appeler un moteur de stratégie, une optimisation, un replay ou une vérification de backtest. Les six scénarios sont des **simulations historiques**, pas des performances de compte réel ni des retraits FTMO.

Sources inspectées : `src/ftmo/reference/resultats/*.json`, les quatre journaux `*_trades.csv` (présents même s’ils sont ignorés par Git), `RECAP_20K_EUR.csv` et `src/ftmo/reference/RAPPORT_20K_EUR.md`. Le récapitulatif et le rapport ne sont pas de nouvelles expériences. Le ZIP de référence et `tradebot-ia.zip` sont conservés ; leur contenu binaire n’a pas été inspecté indépendamment avec les outils de cette intervention. Aucun résultat supplémentaire n’est revendiqué à partir de ces conteneurs.

Les exports de prix XAUUSD/EURUSD et les scripts Python sont des entrées/code, pas des preuves de nouvelles performances. La sauvegarde `backups/interface-v44-before-reorganization.json` contient du code et ne constitue pas un registre FTMO. Les résultats navigateur et registres Windows ne sont pas directement lisibles depuis l’éditeur : les vues existantes de consultation restent disponibles sans réactiver les moteurs.

## Synthèse des scénarios de référence (spread 0,30 USD/oz)

Capital de départ : **20 000 € par phase**, remis à ce montant au début de la phase 2.

| Année | Variante | Capital final phase 1 | Capital final phase 2 | Somme des gains de phase | Trades | Réussite archivée | Profit factor archivé | DD OHLC maximal |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 2025 | GOLD M15 2,5R | 22 178,38 € | 21 185,51 € | 3 363,89 € | 164 | 47,6 % | 1,43 | 6,10 % |
| 2025 | GOLD M15 5R | 22 115,73 € | 21 054,86 € | 3 170,59 € | 108 | 47,2 % | 1,59 | 5,71 % |
| 2026 | GOLD M15 2,5R | 22 256,34 € | 21 163,52 € | 3 419,86 € | 209 | 43,5 % | 1,338 | 5,22 % |
| 2026 | GOLD M15 5R | 22 240,97 € | 21 025,79 € | 3 266,76 € | 183 | 39,9 % | 1,362 | 6,54 % |

Réussite et profit factor de ce tableau : valeurs arrondies de `RECAP_20K_EUR.csv`. L’interface calcule également gagnants, perdants, neutres, réussite et profit factor directement depuis les P&L nets des quatre journaux, sans inférer les nombres gagnants/perdants à partir des taux arrondis. Les chiffres recalculés peuvent différer dans leur dernier chiffre d’affichage.

Les 664 transactions annoncées se répartissent en 164 + 108 + 209 + 183. Les dernières lignes inspectées des quatre journaux correspondent aux dates et capitaux finaux de leurs synthèses, aux arrondis près. Le lecteur affiche un avertissement si le nombre de transactions ou leur net total contredit la synthèse de plus de 0,02 € ; aucune source n’est corrigée ou écrasée.

Les quatre références atteignent les objectifs en replay, mais leurs durées ne sont pas identiques. Il ne s’agit ni d’une comparaison à durée égale, ni d’une validation hors échantillon. Le capital final de phase 2 n’inclut pas le gain de phase 1 retiré du capital lors du reset ; ne pas additionner à tort les gains au solde final affiché.

## Sensibilité aux frais déjà calculée (2026, spread 0,60)

| Variante | Capital final phase 1 | Capital final phase 2 | Gain total archivé | Trades | DD OHLC | État phase 2 |
|---|---:|---:|---:|---:|---:|---|
| 2,5R | 22 015,30 € | 21 058,51 € | 3 073,82 € | 209 | 5,37 % | Objectif atteint le 11 août |
| 5R | 22 163,19 € | 19 841,71 € | 2 004,90 € | 244 | 7,83 % | Non atteint au 9 octobre |

Pas de journal détaillé correspondant retrouvé pour ces deux scénarios : gagnants/perdants, réussite, profit factor et quotidien sont indiqués indisponibles, sans réutiliser les trades du spread 0,30. La synthèse 2,5R donne un net de 3 073,82 €, tandis que ses deux capitaux de phase arrondis impliquent 3 073,81 € : écart d’arrondi apparent de 0,01 €, sources conservées sans modification.

## Tableau jour par jour

Disponible dans **Historique et performances → Performances historiques FTMO 20K**, sans besoin de connexion Windows. Choisir l’un des quatre journaux détaillés, le premier mois et une fenêtre de **2 ou 3 mois**, puis exporter en CSV si souhaité. Par défaut : janvier à mars 2026, GOLD M15 2,5R.

- Les lignes sont regroupées par **date de sortie serveur brute archivée**. Aucune correction GMT/UTC ni la récente normalisation de la passerelle n’est appliquée aux anciens résultats.
- Gains = somme des P&L positifs ; pertes = somme des P&L négatifs ; total = leur somme. Comptages gagnants/perdants/neutres fournis par jour.
- Jours couverts sans clôture : zéro clôture et zéro P&L réalisé. Jours avant le début ou après la fin du scénario : **hors période**, jamais un zéro de performance inventé.
- Il s’agit de P&L nets réalisés par clôture, pas de suivi d’equity intrajournalière ni de solde quotidien complet incluant mouvements de phase ou positions ouvertes.
- Le tableau quotidien et ses métriques sont des agrégations des résultats existants ; ils ne constituent pas un nouveau backtest.

## Historique / simulations / PAPER

1. Historique de marché : entrées de prix archivées, pas des gains.
2. Simulations historiques : six scénarios ci-dessus, dont quatre journaux détaillés.
3. PAPER actuel : uniquement le registre retourné par la passerelle, présenté séparément. Si le registre est indisponible, aucune performance n’est inventée et aucune nouvelle simulation n’est lancée pour le remplir.
4. Anciens autres résultats : consultation/export dans « Historiques antérieurs conservés ». Ils ne sont pas assimilés automatiquement à un challenge FTMO EUR 20K sans preuve de paramètres et de provenance.
5. Trading réel broker : aucune performance vérifiée identifiée dans les sources inspectées.

## Limites de modèle archivées

2025 : change fixe hypothétique EUR/USD 1,15, sous-bougies M5 partielles avant mai. 2026 : proxy de change EURUSD M5. Swaps non modélisés, frais et exécution simulés, reset journalier serveur non certifié Prague. Les variations intrabar et conditions réelles peuvent modifier les résultats. Les données ont déjà servi à la sélection de stratégie.

## Vérification de cette intervention

Sources, en-têtes CSV, fins de journaux, routes et formules d’agrégation relus. Copie des journaux par l’outil de copie, sans édition des originaux. Le rapport est un module chargé uniquement dans la rubrique Historique. Aucun changement de moteur, risque, règle de stratégie, registre ou résultat historique ; aucune suppression. PAPER exclusivement et LIVE désactivé inchangés.

Les outils disponibles dans cette intervention ne permettent pas d’exécuter une compilation, TypeScript ou un navigateur. Aucune réussite de ces contrôles n’est revendiquée. Aucun backtest, autotest déjà réalisé ou contrôle Windows n’a été relancé.
