# Cloud PAPER — préparation et déploiement

## Architecture

- La page `/cloud-paper` est une interface web responsive commune aux navigateurs Windows et iPhone.
- Le shell Electron peut charger cette page depuis une URL `https://` fournie par `TRADEBOT_CLOUD_URL`; sans cette variable, son comportement local existant reste inchangé.
- Les routes Nitro authentifient chaque utilisateur auprès de Supabase Auth. Le rôle service n’est utilisé que côté serveur.
- Le cycle planifié Vercel appelle `/api/cloud-paper/cycle` à la cinquième minute de chaque heure. Il traite les bougies XAU/USD 1h et 4h réelles fournies par Twelve Data, avec un garde-fraîcheur de six heures.
- Le moteur réutilise `advancePaper`, le schéma de compte et les règles de risque du PAPER web existant. Aucun appel de trading MT5 ou broker n’est ajouté.
- Supabase/Postgres persiste l’état, la révision atomique et les événements de stratégie et de positions. La contrainte unique sur l’identifiant d’événement et le contrôle de révision rendent la reprise idempotente face aux cycles concurrents.
- Un nouveau compte est créé par défaut avec 20 000 EUR; 45 000 EUR est proposé comme option alternative pour un compte distinct. Chaque compte reste arrêté après création. Le démarrage PAPER exige une action explicite. Une pause arrête les nouvelles entrées, mais un cycle continue à suivre une position déjà ouverte.

## Prérequis externes (pas encore configurés)

1. Un projet Vercel pour ce dépôt et un déploiement HTTPS.
   - Configurer l’installation avec `npm ci` et le build avec `npm run build` : le dépôt contient `package-lock.json` et `pnpm-lock.yaml`; choisir explicitement npm évite une sélection ambiguë du gestionnaire.
   - Vérifier que l’offre Vercel autorise bien le cron horaire déclaré dans `vercel.json`. La cadence réelle dépend de l’offre et de ses limites.
2. Un projet Supabase avec Auth activé et un utilisateur créé. Ne pas activer l’inscription publique sans politique dédiée.
3. Exécuter `supabase/migrations/202611150001_cloud_paper.sql` dans le SQL Editor Supabase ou via la CLI officielle.
4. Configurer les variables **serveur uniquement** dans Vercel :
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `TWELVE_DATA_API_KEY`
   - `CRON_SECRET` (Vercel uses this to send the protected `Authorization: Bearer ...` header to scheduled functions)
5. Configurer les variables publiques de build :
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   La clé anon est destinée au client et reste protégée par les politiques RLS. Ne jamais placer la clé `service_role`, la clé Twelve Data ou le secret cron dans une variable `VITE_*`.
6. Vérifier que l’offre Vercel choisie autorise le cron horaire déclaré dans `vercel.json`, ainsi que les limites d’exécution et la facturation.
7. Vérifier l’offre Twelve Data pour XAU/USD 1h/4h et les quotas. Une clé présente dans `.env.local` ne configure pas Vercel. Vérifier aussi les spécifications et frais réellement retenus pour cette simulation.
8. Après déploiement, vérifier les journaux Vercel et un cycle cron réussi avant de démarrer un compte.

## Première configuration

1. Ouvrir `/cloud-paper` sur le site HTTPS depuis Windows ou Safari iPhone et se connecter avec le compte Supabase autorisé.
2. Depuis le navigateur où la stratégie est enregistrée, configurer `Trend Master XAU` en 1h/4h, vérifier qu’elle est activée, puis entrer des coûts et paramètres contractuels vérifiés. Les champs ne proposent pas de valeurs arbitraires.
3. Sélectionner le capital initial (20 000 EUR par défaut ou 45 000 EUR comme option), puis créer le compte. Le dimensionnement du risque utilise le capital et l’equity sélectionnés. Cette action seule ne lance aucun cycle de trading.
4. Vérifier le compte et le journal. Démarrer ensuite le PAPER uniquement par le bouton de la page, après validation du flux.
5. Confirmer les cycles cron réussis, les heures des bougies, puis l’apparition des événements de signal/position dans le journal partagé.

La page utilise `sessionStorage` pour la session utilisateur; elle ne partage ni le mot de passe ni les données de compte dans le stockage local. Les sessions Windows et iPhone sont séparées, mais lisent le même compte et le même journal côté serveur.

## Limites de validation actuelle

Le code, la migration SQL et le cycle planifié sont préparés, mais aucune ressource externe n’a été créée, aucun secret configuré, aucune migration appliquée et aucun déploiement ni cycle réel vérifié. Le shell Electron empaqueté dans `release/` n’est pas reconstruit par cette modification; pour l’instant, le chemin commun Windows/iPhone est le site HTTPS dans le navigateur.

Les comptes déjà créés, ainsi que les soldes, signaux, positions et rapports des anciennes simulations locales ou FTMO à 20 000 EUR, ne sont ni réinitialisés ni modifiés. Le dimensionnement du risque utilise le capital et l’equity du compte sélectionné. Ce moteur Cloud utilise la stratégie enregistrée 1h/4h; il ne remplace pas l’essai GOLD M15 indépendant.
