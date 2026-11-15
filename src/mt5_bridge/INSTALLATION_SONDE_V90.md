# V90 — sonde native MT5 : verification et copie depuis VS Code

## Portee

Le source a ete annonce compile avec 0 erreur/0 avertissement et 164 tests Python reussis par l'utilisateur. Ces resultats ne sont pas reexecutes ni transformes en preuve d'installation par ce script.

Aucun fichier de strategie, de risque, d'interface, de demarrage automatique ou de registre PAPER n'est modifie. Aucun ordre, START, lancement automatique de sonde, arret de processus, installation Python, recompilation, redemarrage de MT5 ou de passerelle n'est effectue.

## Taches VS Code

Dans **Terminal > Executer la tache**, choisir :

1. **V90 : verifier la sonde MT5 sans installer** : inventaire et diagnostics uniquement.
2. **V90 : installer la sonde MT5 avec confirmation et sauvegarde** : meme inspection, puis confirmation explicite `INSTALLER` uniquement si les empreintes different.

Les deux taches executent `verifier_installer_sonde_v90.ps1` dans le terminal integre. Aucune execution-policy n'est contournee. Une restriction PowerShell doit etre traitee par la politique Windows habituelle, pas par un bypass ajoute au projet.

Le script accepte `-Install` et `-CompiledPath` (chemin explicite du binaire lorsque MetaEditor a compile ailleurs). Sans chemin explicite, il inventorie le dossier source du depot et le vrai dossier MQL5/Scripts, puis selectionne le candidat admissible le plus recent. A date identique, des empreintes differentes exigent une selection explicite.

## Identification de l'instance reelle

Le script utilise seulement des GET vers `http://127.0.0.1:8765` :

- `/status?symbol=XAUUSD` pour le terminal et le compte DEMO FTMO-Demo connecte;
- `/paper-trial/state` pour verifier PAPER/LIVE OFF et refuser un compte courant different de celui des donnees PAPER conservees;
- `/ftmo/clock-evidence` pour obtenir `nativeProbeSource`, le chemin construit par la passerelle depuis `terminal_info().data_path`, ainsi que les autotests/diagnostics existants.

Aucun chemin AppData de terminal n'est suppose. Aucun nouveau endpoint n'est necessaire. Les diagnostics horloge existants effectuent des lectures MT5, selectionnent des symboles et executent leurs autotests isoles; ils ne demarrent pas PAPER. Une panne IPC, une passerelle absente ou un changement de compte bloque la procedure.

La cible est `MQL5/Scripts/TradeBotClockProbe.ex5` sous le dossier de donnees identifie. Le dossier doit deja exister. Les chemins comportant liens/jonctions sont refuses.

## Verification et sauvegarde

Pour chaque EX5 : chemin, taille, date UTC et SHA-256 sont rapportes. L'admissibilite exige un MQ5 voisin identique au source courant du depot, et un EX5 dont la date n'est ni anterieure a ce MQ5 ni future. Cela ne decompile pas l'EX5 et ne prouve pas quel source MetaEditor a effectivement compile : le journal MetaEditor reste la preuve de compilation. Si le binaire est ailleurs, utiliser le parametre explicite; aucun balayage de tous les disques n'est fait.

Si la cible a deja la meme empreinte, aucune ecriture. Sinon, le script confirme a nouveau compte/dossier/source avant copie. La cible existante est ouverte exclusivement, son empreinte recontrolee, puis sauvegardee sous un nom unique `.bak`; la sauvegarde doit avoir la meme empreinte avant ecriture. La copie est verifiee et une erreur d'ecriture tente de restaurer la sauvegarde. En l'absence de cible, `CreateNew` interdit l'ecrasement d'un fichier apparu entre-temps. Une panne electrique pendant l'ecriture n'est pas couverte par une garantie transactionnelle; conserver la sauvegarde et le rapport.

Le script ne remplace jamais le binaire d'une autre instance par supposition et ne demande pas les droits administrateur.

## Resultats et action MT5

Rapports horodates uniques : `%LOCALAPPDATA%\TradeBotIA\validation-v90\sonde-*.json`. Ils contiennent chemins locaux et identifiant de compte : ne pas les publier sans masquage.

- Code **0** : binaire deja identique et observations horloge/cotations/PAPER actuelles conformes aux controles executes. Ce n'est pas une certification generale du bot ni une preuve d'execution du binaire par son empreinte.
- Code **2** : installation a confirmer, copie fraichement effectuee a recontroler apres activation MT5, observation incomplete, panne ou controle bloque. Le motif exact figure dans le terminal/rapport. Un marche ferme ou un SAFE_STOP n'est jamais transforme en succes.

Le seuil des cotations reste de 15 secondes. La disponibilite des champs sessions du nouveau releve, la presence du worker, son heartbeat et sa valorisation sont controles. Le script ne relance pas le moteur pour obtenir un resultat vert.

**Seule action manuelle dans MT5 si la nouvelle sonde n'est pas active :** dans **Navigateur > Scripts**, choisir **Actualiser**, puis glisser **TradeBotClockProbe** sur un graphique du compte **FTMO-Demo** et confirmer les parametres horaires deja verifies. Si une ancienne sonde tourne sur ce graphique, la retirer avant de lancer la nouvelle. Aucun fuseau ou regle DST ne doit etre invente pour remplir la boite de dialogue.

Ensuite, la tache de verification peut observer le nouveau releve. Le script ne pretend pas lancer automatiquement un script MQL5 ni distinguer deux binaires executes par leur seule date de fichier.

## Etat de verification dans Dyad

Revue statique des fichiers uniquement. Aucun disque Windows/MetaEditor/MT5, interpreteur PowerShell ou terminal d'execution n'est accessible avec les outils disponibles dans cette intervention. Le chemin reel de l'EX5, sa date, le dossier MT5, la copie, les autotests du diagnostic et la connexion PAPER restent **non observes ici**. Aucun resultat reel de verification n'est annonce avant execution de la tache sur le PC.
