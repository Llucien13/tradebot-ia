@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv-mt5\Scripts\python.exe" (
  echo Python Windows 64 bits requis. Creation de l'environnement local...
  py -3 -m venv .venv-mt5
  if errorlevel 1 goto failure
  ".venv-mt5\Scripts\python.exe" -m pip install -r "src\mt5_bridge\requirements.txt"
  if errorlevel 1 goto failure
)
".venv-mt5\Scripts\python.exe" -c "import pandas, numpy, tzdata" >nul 2>&1
if errorlevel 1 (
  ".venv-mt5\Scripts\python.exe" -m pip install -r "src\mt5_bridge\requirements.txt"
  if errorlevel 1 goto failure
)
echo.
echo TradeBot IA - MT5 lecture seule - PAPER - aucun ordre
 echo Ouvrez MT5 sur votre compte DEMO avant de tester la connexion.
echo Passerelle: http://127.0.0.1:8765/status
 echo Fermez cette fenetre pour arreter la passerelle.
".venv-mt5\Scripts\python.exe" "src\mt5_bridge\bridge.py"
if errorlevel 1 goto failure
goto end
:failure
echo.
echo Echec. Consultez src\mt5_bridge\INSTALLATION.md et le message ci-dessus.
echo Si l'installation initiale a echoue, supprimez le dossier .venv-mt5 puis relancez ce fichier.
pause
:end
endlocal
