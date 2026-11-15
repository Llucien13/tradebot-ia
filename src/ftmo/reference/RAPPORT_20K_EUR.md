# GOLD M15 — Replay FTMO 2-Step de 20 000 €

Date de préparation : 14 octobre 2026. Simulation historique uniquement, aucune exécution MT5 ou passage FTMO officiel.

## Comparaison des deux phases, capital remis à 20 000 € pour la phase 2

| Année | TP | Phase 1 (gain €) | Phase 1 (date) | Phase 2 (gain €) | Phase 2 (date) | Somme des gains virtuels de phase | Trades |
|---|---|---:|---|---:|---|---:|---:|
| 2025 | 2,5R | +2 178,38 | 16 avril | +1 185,51 | 13 juin | +3 363,89 € | 164 |
| 2025 | 5R | +2 115,73 | 16 avril | +1 054,86 | 22 avril | +3 170,59 € | 108 |
| 2026 | 2,5R | +2 256,34 | 19 mai | +1 163,52 | 11 août | +3 419,86 € | 209 |
| 2026 | 5R | +2 240,97 | 29 janvier | +1 025,79 | 7 août | +3 266,76 € | 183 |

Toutes les lignes ont atteint les objectifs en replay (10 % puis 5 %) avec 4 jours de trading minimum par phase. Pas de violation des limites détectée dans l'approximation OHLC utilisée, mais aucune conformité FTMO réelle n'est certifiée.

## Test de frais 2026

- Spread 0,30 USD/oz : 2,5R réussit le 11 août ; 5R réussit le 7 août.
- Spread 0,60 USD/oz : 2,5R réussit le 11 août (phase 1 +2 015,30 €, phase 2 +1 058,51 €) ; 5R NE réussit PAS la phase 2 avant le 9 octobre (solde 19 841,71 €).

## Hypothèses et réserves

- Source : archive historique GOLD M15 + données XAUUSD M5/M15/M30/H4/D1 2025-2026 de l'utilisateur. Moteur GOLD M15 figé (breakout 8, EMA50/200, confirmations M30/H4/D1, stop 2,5 ATR, timeout 32 bougies), risque par ordre 0,5 %, lot minimum/pas 0,01, levier hypothétique 1:20.
- Spread simulé de référence 0,30 $/once, glissement 0,05 $/once par sens, commission de 3 $ par lot par sens ; swaps et conversion commerciale éventuelle du courtier non modélisés.
- Pour 2026 : conversion USD vers EUR à partir de l'export EURUSD M5 de décembre 2025 à octobre 2026 (proxy prix moyen ouverture/clôture de bougie, même horodatage MT5, dernier prix connu).
- Pour 2025 : PAS d'historique EURUSD complet dans le paquet ; simulation sous hypothèse FIXE 1 € = 1,15 USD. Elle ne doit pas être interprétée comme une simulation exacte avec change historique variable.
- Historique XAUUSD M5 partiel en 2025 avant mai : les positions anciennes s'appuient sur les M15 faute de sous-bougies M5.
- Les limites journalières et le franchissement des stops sont contrôlés sur les OHLC disponibles en utilisant le jour serveur MT5 comme proxy, et non des ticks avec le fuseau minuit CE(S)T vérifié ; aucun audit FTMO officiel. Les écarts de cotation intrabar, swaps, frais de conversion et d'exécution peuvent modifier les résultats.
- Les mêmes historiques 2025/2026 ont participé à la sélection de stratégie ; forte exposition au surajustement, pas de validation hors échantillon.
- Les montants indiqués sont des gains du compte virtuel pendant la phase, PAS des paiements encaissables.

## Reproduction

`python REPRODUIRE_20K.py` après installation de Python, pandas, numpy. Les archives CSV et l'exécution de 2026 sont contenues dans ce ZIP. Les résultats historiques ne garantissent pas les performances futures. 
