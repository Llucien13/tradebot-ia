# Architecture multi-actifs et garde-risque Shadow

## État et périmètre

`multi-asset-shadow-risk.ts` est une bibliothèque pure : pas d'accès réseau, de stockage, de moteur PAPER, de terminal MT5 ni de fonction d'envoi d'ordre. Elle n'est pas branchée au runner XAUUSD ni au moteur actif.

Le catalogue déclare 18 instruments candidats. Seul `XAUUSD` est marqué `READ_ONLY_ROUTE_PRESENT`, car la route locale de bougies a été identifiée pour ce symbole. Les 17 autres sont des candidats de conception uniquement : aucun symbole courtier, flux de bougies, frais ou spécification de contrat n'est déclaré disponible ou vérifié.

Le classement garde le signal le plus récent par instrument (puis le score le plus élevé si l'horodatage est identique), et classe sans imposer de quota. Un score doit être fourni par une stratégie existante; ce module ne crée aucun signal.

## Garde de risque

`planShadowRisk` ne fournit une estimation de taille que si les entrées sont présentes et fraîches : cotation, contrat, tick size/value en EUR, volume min/max/pas, coûts aller-retour, marge par lot, limites vérifiées du compte et corrélations récentes avec chaque position ouverte.

Le risque demandé est plafonné à 0,5 % de l'equity courant. Le volume est arrondi vers le bas au pas déclaré et contrôlé contre le risque de portefeuille restant, les marges journalière/totale restantes après pertes réalisées et risque ouvert, ainsi que la marge libre. Les corrélations manquantes, périmées, trop fortement liées, les volumes minimaux dépassant le budget et toutes spécifications/coûts/limites inconnus entraînent un refus explicite.

Les limites FTMO ne sont pas codées comme des faits dans cette bibliothèque : elles doivent provenir d'une source de règles et d'un état de compte vérifiés par un futur appelant. Les résultats des tests utilisent des fixtures synthétiques pour vérifier les calculs; ils ne constituent pas les spécifications du compte ou du symbole réel.

## Préparation restante

Avant tout dimensionnement Shadow réel, il faut obtenir en lecture seule des cotations et métadonnées à jour pour chaque symbole, les frais et la marge applicables, l'equity et les limites de risque du compte, ainsi que des corrélations calculées sur des données synchronisées. Aucune valeur de fixture de test ne doit être réutilisée comme configuration de marché.
