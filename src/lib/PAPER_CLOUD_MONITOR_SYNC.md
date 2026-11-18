# Synchronisation du monitoring PAPER PC vers Cloud

Le relais `tools/paper_cloud_sync.py` est un programme Python indépendant. Il lit exclusivement l’observateur en lecture seule sur `127.0.0.1:8766`; le port `8765` reste réservé à la passerelle MT5 existante. Il ne démarre ni n'arrête le PAPER et ne contacte aucune API MT5. Il n'envoie par HTTPS que le résumé PAPER validé et les entrées du journal. Les cotations détaillées, options de notification, erreurs libres et données de compte MT5 sont filtrées localement.

La configuration Supabase publique est obtenue depuis l’endpoint same-origin du Cloud. Le mot de passe est demandé au lancement sans écho, n'est pas écrit sur disque et sert à obtenir les jetons Supabase. Seul le jeton de renouvellement est conservé localement, chiffré par DPAPI pour le compte Windows courant. La clé `service_role` reste exclusivement dans les variables serveur Vercel. Les tables Cloud ont RLS et n'autorisent la lecture qu'au propriétaire; seules les API serveur authentifiées effectuent les écritures.

## Mise en service

1. Publier cette version et attendre un déploiement Vercel `Ready`.
2. Exécuter `supabase/migrations/202611160001_cloud_paper_monitor_sync.sql` une fois dans le SQL Editor Supabase. Cette migration ajoute deux tables et deux fonctions; elle ne supprime, ne vide ni ne réinitialise aucune donnée existante.
3. Vérifier les variables Vercel de production déjà documentées pour Cloud PAPER : `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`. Ne jamais copier `SUPABASE_SERVICE_ROLE_KEY` dans le PC. Redéployer après tout changement de variable.
4. Sur le PC Windows, démarrer l’observateur autonome dans un premier terminal PowerShell :

   ```powershell
   Set-Location C:\chemin\vers\tradebot-ia
   py -3 tools\paper_monitor_observer.py
   ```

   Cet observateur standard-library écoute uniquement sur `127.0.0.1:8766` et lit directement le registre `%LOCALAPPDATA%\TradeBotIA\essai-paper20k\essai.json`. Il ne lance pas `bridge.py`, n’importe pas MT5, ne verrouille ni n’écrit le registre, et n’appelle aucun contrôle moteur. Il exporte uniquement les champs PAPER autorisés. Faute de flux live indépendant, il marque les cotations et la valorisation comme non fraîches; un `SAFE_STOP`/`monitoringBlocked` est conservé et présenté, jamais effacé. Le port `8765` n’est ni modifié ni arrêté.
5. Dans un second terminal PowerShell, effectuer une seule fois la connexion initiale. L’URL Supabase et la clé anon sont lues depuis l’endpoint public same-origin; le mot de passe est demandé sans écho, puis seul le jeton de renouvellement est chiffré par DPAPI pour le compte Windows courant :

   ```powershell
   py -3 tools\paper_cloud_sync.py --configure-auth --cloud-url "https://votre-domaine-vercel" --once
   ```

   Le connecteur envoie une première observation puis quitte. Le mot de passe n’est jamais écrit sur disque; la clé anon publique et l’URL Supabase sont rechargées depuis le site Cloud. Le connecteur sans `--configure-auth` restaure la session avec DPAPI, actualise le jeton et réessaie les coupures réseau avec temporisation exponentielle.
6. Après cette première synchronisation confirmée, installer les deux tâches limitées au compte Windows courant :

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\register_paper_cloud_tasks.ps1
   ```

   Elles démarrent à l’ouverture de session l’observateur en lecture seule et le connecteur toutes les 15 secondes, avec redémarrage limité après panne et refus des instances simultanées. Elles ne démarrent ni le moteur PAPER, ni MT5; elles nécessitent que l’utilisateur Windows soit connecté.
7. Ouvrir `https://votre-domaine-vercel/cloud-monitor` et se connecter avec le même compte. Une synchronisation récente est confirmée quand le serveur a reçu une observation depuis moins d’une minute. Les champs non valorisables restent explicitement indisponibles.

### iPhone

Dans Safari sur l’iPhone, ouvrir `https://votre-domaine-vercel/cloud-monitor`, se connecter au même compte Cloud, puis choisir **Partager > Sur l’écran d’accueil**. L’icône ouvre directement le monitoring Cloud en lecture seule; la page actualise l’état toutes les 15 secondes. La session iPhone est distincte de celle du PC et doit être ouverte une fois sur l’iPhone. Le PC et son connecteur doivent rester actifs pour que les observations soient récentes. Cette page ne démarre pas le moteur PAPER et n’émet aucun ordre MT5.

Avant le premier envoi, le mode hors connexion permet de vérifier la source sans identifiants ni transfert :

```powershell
py -3 tools\paper_cloud_sync.py --dry-run --once
```

Le script d’enregistrement des tâches est prévu pour un lancement automatique au logon utilisateur; il ne démarre pas le moteur PAPER ou MT5 et ne fonctionne que lorsque cette session Windows est ouverte.

Le site Cloud ne peut pas afficher une synchronisation actuelle lorsque le PC ou le connecteur est arrêté. Les données affichées sont horodatées; elles ne constituent pas une connexion Internet à MT5.
