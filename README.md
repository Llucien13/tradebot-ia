# TradeBot IA

## Données de marché XAU/USD

Le Dashboard utilise `MarketDataProvider`, séparé de l’interface. Il appelle uniquement `/api/market-data`. Le proxy Nitro interroge Twelve Data avec une clé privée ; la clé n’est ni envoyée au navigateur, ni incluse dans les URLs, réponses ou messages d’erreur.

### Configuration sécurisée

#### Dans le projet local / Preview Dyad

1. Dans **Configure > Environment Variables**, renseignez **`TWELVE_DATA_API_KEY`** comme variable privée du serveur. Ne transmettez pas la valeur dans le chat, dans le Dashboard ou dans un fichier TypeScript.
2. Redémarrez le serveur avec **Restart App** après modification de l’environnement. Un simple rafraîchissement du Preview ne recharge pas les variables du processus.
3. Ouvrez le Dashboard ou utilisez son bouton **Actualiser**. Le statut devient **LIVE** seulement après réception d’un historique XAU/USD valide. Le cours, les bougies et les indicateurs utilisent alors Twelve Data.

Pour un environnement de développement local hors de cette configuration, `.env` à la racine du projet (ignoré par Git) peut contenir `TWELVE_DATA_API_KEY=` suivi de votre clé. Ne placez jamais ce fichier dans `src/` ou `public/`.

La route `/api/market-data` lit en priorité `process.env.TWELVE_DATA_API_KEY` côté serveur. Si cette variable est absente ou vide, la configuration Nitro `twelveDataApiKey`, alimentée par `NITRO_TWELVE_DATA_API_KEY`, reste prise en charge pour les configurations déjà existantes. Une variable `TWELVE_DATA_API_KEY` non vide est prioritaire, même si la clé est invalide : le repli est alors DEMO, sans essai d’une seconde clé.

Le plugin Nitro installé charge `.env` côté serveur en développement. Aucun formulaire de clé API n’est ajouté au navigateur. Les diagnostics serveur indiquent uniquement si la clé est détectée, le statut HTTP Twelve Data et si la série XAU/USD est valide. Ils n’affichent jamais la valeur, les en-têtes d’authentification ou la réponse brute.

#### Sur un hébergement de production

Dans les paramètres **Environment Variables / Secrets** de votre hébergeur, ajoutez le nom **`TWELVE_DATA_API_KEY`** et votre clé comme valeur privée du **serveur**. Redéployez ou redémarrez le serveur après modification. Le fichier `.env` local n’est pas envoyé au dépôt et ne configure pas automatiquement l’hébergement.

#### Si les données réelles ne sont pas accessibles

- Clé vide ou variable absente : **DEMO**, données fictives conservées.
- Clé invalide, quota dépassé, XAU/USD non autorisé ou réponse invalide : **ERROR**, retour automatique aux données fictives.
- Problème réseau ou délai dépassé : **OFFLINE**, retour automatique aux données fictives.

L’offre Twelve Data doit autoriser XAU/USD et l’historique 1h demandé. Les erreurs peuvent être conservées dans le cache serveur pendant une minute. Pour remplacer une clé, modifiez uniquement la configuration privée, puis redémarrez le serveur.

N’utilisez jamais de variable `VITE_*` pour cette clé : ces variables sont publiques. Ne commitez ni ne partagez le fichier `.env`. `.env.example` reste un modèle sans secret ; ni la clé ni les réponses brutes d’erreur Twelve Data ne sont retournées au frontend.

### États de connexion

- **LIVE** : réponse Twelve Data validée ; prix, bougies et indicateurs issus du marché réel. Ce n’est pas un flux tick par tick. La date de récupération et celle de la dernière bougie sont visibles.
- **DEMO** : API non configurée, ou vérification initiale ; données fictives existantes conservées.
- **OFFLINE** : navigateur hors ligne, connexion impossible ou délai dépassé ; retour aux données fictives.
- **ERROR** : clé/quota/droits refusés, réponse invalide ou erreur de service ; retour aux données fictives.

Les nouvelles données sont demandées toutes les cinq minutes. Le serveur mutualise les appels simultanés et conserve un cache de cinq minutes (une minute après échec). Le bouton Actualiser réessaie la connexion, mais respecte ce cache pour préserver le quota. Un nouveau processus serveur dispose de son propre cache.

Les bougies Twelve Data sont demandées en UTC (1h, jusqu’à 1000 points), validées et triées. Le graphique conserve son agrégation 4h, ses EMA et marqueurs. Si le volume n’est pas fourni pour XAU/USD, il est annoncé indisponible : aucun volume fictif n’est superposé aux cours réels. Les indicateurs sont calculés localement sur le même historique.

**Les signaux du bot, le PnL, le drawdown et le budget de risque restent DEMO, même en LIVE. Aucun broker n’est connecté et aucun ordre n’est envoyé.**

Sans clé configurée, le Dashboard reste intégralement fonctionnel en mode DEMO. La connexion LIVE doit être testée après configuration d’une clé valide ; les logs seuls ne permettent pas de confirmer les interactions visuelles du Preview.
