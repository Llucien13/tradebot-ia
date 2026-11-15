@echo off
setlocal
cd /d "%~dp0..\.."
echo TradeBot IA - collecte de preparation PAPER en lecture seule
echo Aucun bot, observateur MT5, ordre, verify ou backtest ne sera lance.
echo Une passerelle perimee peut etre rechargee uniquement apres controles et confirmation REDEMARRER.
echo Le GET feed optionnel lit M5/M15/M30/H1/H4/D1 et selectionne les symboles MT5.
echo Il exige une passerelle deja active, running=false, sans position et un vrai worker STOPPED.
echo PHASE_1 n'est pas un statut worker. Telemetrie/proof absente = NON VERIFIABLE.
echo Les rapports gardent des resumes; le JSON peut inclure chemins et identite du compte.
echo Un diagnostic conforme n'est PAS une autorisation de demarrer.
echo.
if /i "%~1"=="--observer" goto observe
if /i "%~1"=="--local" goto local
echo 1. Registre local, integrite archive/resultats, rapport existant, horloge et empreintes
 echo 2. En plus : preuve UTC et flux sur 7 observations pendant environ 180 secondes
 echo Q. Quitter
choice /c 12Q /n /m "Choix 1, 2 ou Q : "
if errorlevel 3 exit /b 0
if errorlevel 2 goto observe
:local

echo Commande exacte :
echo powershell.exe -NoProfile -File "src\mt5_bridge\controler_preparation_paper.ps1"
powershell.exe -NoProfile -File "src\mt5_bridge\controler_preparation_paper.ps1"
goto result

:observe
echo Commande exacte :
echo powershell.exe -NoProfile -File "src\mt5_bridge\controler_preparation_paper.ps1" -ObserverUTC -RestartBridgeIfStale
powershell.exe -NoProfile -File "src\mt5_bridge\controler_preparation_paper.ps1" -ObserverUTC -RestartBridgeIfStale

:result
set "RESULT=%ERRORLEVEL%"
echo.
echo Code diagnostic : %RESULT%
echo 2 signifie NON PRET : collecte bloquee/incomplete ou exigences residuelles non prouvees.
echo Aucun code de ce lanceur ne constitue une autorisation START.
echo Ne contournez pas la politique de securite PowerShell.
pause
exit /b %RESULT%
