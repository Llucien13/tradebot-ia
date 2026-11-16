# Synchronisation du monitoring PAPER PC vers Cloud

Le relais `tools/paper_cloud_sync.py` est un programme Python indépendant. Il lit exclusivement les routes locales de monitoring V86 à `127.0.0.1:8765`, ne démarre ni n'arrête le PAPER et ne contacte aucune API MT5. Il n'envoie par HTTPS que le résumé PAPER validé et les entrées du journal. Les cotations détaillées, options de notification, erreurs libres et données de compte MT5 sont filtrées localement.

La clé Supabase `anon` est publique; elle et les URL sont fournies par variables d'environnement sur le PC. Le mot de passe est demandé au lancement sans écho, n'est pas écrit sur disque et sert à obtenir des jetons Supabase conservés uniquement en mémoire. La clé `service_role` reste exclusivement dans les variables serveur Vercel. Les tables Cloud ont RLS et n'autorisent la lecture qu'au propriétaire; seules les API serveur authentifiées effectuent les écritures.

## Mise en service

1. Publier cette version et attendre un déploiement Vercel `Ready`.
2. Exécuter `supabase/migrations/202611160001_cloud_paper_monitor_sync.sql` une fois dans le SQL Editor Supabase. Cette migration ajoute deux tables et deux fonctions; elle ne supprime, ne vide ni ne réinitialise aucune donnée existante.
3. Vérifier les variables Vercel de production déjà documentées pour Cloud PAPER : `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`. Ne jamais copier `SUPABASE_SERVICE_ROLE_KEY` dans le PC. Redéployer après tout changement de variable.
4. Sur le PC Windows qui exécute déjà la passerelle, ouvrir PowerShell et définir les trois valeurs publiques/URL suivantes pour cette fenêtre :

   ```powershell
   $env:TRADEBOT_CLOUD_URL = "https://votre-domaine-vercel"
   $env:SUPABASE_URL = "https://votre-projet.supabase.co"
   $env:SUPABASE_ANON_KEY = "votre-cle-anon-publique"
   py -3 tools\paper_cloud_sync.py
   ```

   Le connecteur demande l'e-mail et le mot de passe du compte Supabase autorisé. Il synchronise immédiatement puis toutes les 15 secondes. Il faut laisser la fenêtre ouverte et le PC/la passerelle allumés.
5. Ouvrir `https://votre-domaine-vercel/cloud-monitor` et se connecter avec le même compte. Une synchronisation récente est confirmée quand le serveur a reçu une observation depuis moins d'une minute.

Avant le premier envoi, le mode hors connexion permet de vérifier la source sans identifiants ni transfert :

```powershell
py -3 tools\paper_cloud_sync.py --dry-run --once
```

Le site Cloud ne peut pas afficher une synchronisation actuelle lorsque le PC ou le connecteur est arrêté. Les données affichées sont horodatées; elles ne constituent pas une connexion Internet à MT5. Le connecteur peut être lancé automatiquement via le Planificateur de tâches Windows si souhaité, mais il n'est pas installé ni enregistré comme tâche par ce projet.
