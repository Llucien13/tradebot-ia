# Synchronisation du monitoring PAPER PC vers Cloud

Le relais `tools/paper_cloud_sync.py` est un programme Python indépendant. Il lit exclusivement les routes locales de monitoring V86 à `127.0.0.1:8765`, ne démarre ni n'arrête le PAPER et ne contacte aucune API MT5. Il n'envoie par HTTPS que le résumé PAPER validé et les entrées du journal. Les cotations détaillées, options de notification, erreurs libres et données de compte MT5 sont filtrées localement.

La clé Supabase `anon` est publique; elle et les URL sont fournies par variables d'environnement sur le PC. Le mot de passe est demandé au lancement sans écho, n'est pas écrit sur disque et sert à obtenir des jetons Supabase conservés uniquement en mémoire. La clé `service_role` reste exclusivement dans les variables serveur Vercel. Les tables Cloud ont RLS et n'autorisent la lecture qu'au propriétaire; seules les API serveur authentifiées effectuent les écritures.

## Mise en service

1. Publier cette version et attendre un déploiement Vercel `Ready`.
2. Exécuter `supabase/migrations/202611160001_cloud_paper_monitor_sync.sql` une fois dans le SQL Editor Supabase. Cette migration ajoute deux tables et deux fonctions; elle ne supprime, ne vide ni ne réinitialise aucune donnée existante.
3. Vérifier les variables Vercel de production déjà documentées pour Cloud PAPER : `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`. Ne jamais copier `SUPABASE_SERVICE_ROLE_KEY` dans le PC. Redéployer après tout changement de variable.
4. Sur le PC Windows, démarrer l’observateur autonome dans un premier terminal PowerShell :

   ```powershell
   Set-Location C:\chemin\vers\tradebot-ia
   py -3 tools\paper_monitor_observer.py
   ```

   Cet observateur standard-library écoute uniquement sur `127.0.0.1:8765` et lit directement le registre `%LOCALAPPDATA%\TradeBotIA\essai-paper20k\essai.json`. Il ne lance pas `bridge.py`, n’importe pas MT5, ne verrouille ni n’écrit le registre, et n’appelle aucun contrôle moteur. Il exporte uniquement les champs PAPER autorisés. Faute de flux live indépendant, il marque les cotations et la valorisation comme non fraîches; un `SAFE_STOP`/`monitoringBlocked` est conservé et présenté, jamais effacé.
5. Dans un second terminal PowerShell, définir l’URL Cloud. L’URL Supabase et la clé anon sont lues depuis l’endpoint public same-origin; aucune clé service n’est nécessaire sur le PC :

   ```powershell
   $env:TRADEBOT_CLOUD_URL = "https://votre-domaine-vercel"
   $publicConfig = Invoke-RestMethod "$env:TRADEBOT_CLOUD_URL/api/cloud-paper/public-config"
   $env:SUPABASE_URL = $publicConfig.url
   $env:SUPABASE_ANON_KEY = $publicConfig.anonKey
   py -3 tools\paper_cloud_sync.py --interval 15
   ```

   Le connecteur demande l’e-mail puis le mot de passe Supabase sans écho; ils ne sont pas enregistrés. Il synchronise immédiatement puis toutes les 15 secondes. Il faut laisser les deux processus et le PC actifs.
6. Ouvrir `https://votre-domaine-vercel/cloud-monitor` et se connecter avec le même compte. Une synchronisation récente est confirmée quand le serveur a reçu une observation depuis moins d’une minute. Les champs non valorisables restent explicitement indisponibles.

Avant le premier envoi, le mode hors connexion permet de vérifier la source sans identifiants ni transfert :

```powershell
py -3 tools\paper_cloud_sync.py --dry-run --once
```

Le site Cloud ne peut pas afficher une synchronisation actuelle lorsque le PC ou le connecteur est arrêté. Les données affichées sont horodatées; elles ne constituent pas une connexion Internet à MT5. Le connecteur peut être lancé automatiquement via le Planificateur de tâches Windows si souhaité, mais il n'est pas installé ni enregistré comme tâche par ce projet.
