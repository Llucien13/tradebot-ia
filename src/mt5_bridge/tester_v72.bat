@echo off
setlocal
cd /d "%~dp0..\.."
if not exist ".venv-mt5\Scripts\python.exe" (
  echo Environnement Python .venv-mt5 absent. Aucun test execute.
  echo Ce lanceur ne cree pas d'environnement et ne demarre pas la passerelle.
  pause
  exit /b 1
)
echo V72 - 45 tests attendus - donnees synthetiques uniquement.
echo Aucun bot, ordre MT5 ou backtest ne sera lance.
echo Commande exacte :
echo ".venv-mt5\Scripts\python.exe" -m unittest discover -s "src\mt5_bridge" -p "test_*.py" -v
".venv-mt5\Scripts\python.exe" -m unittest discover -s "src\mt5_bridge" -p "test_*.py" -v
set "RESULT=%ERRORLEVEL%"
echo.
echo Code de sortie des tests : %RESULT%
echo Le resultat reel est indique par unittest ci-dessus. Aucun succes n'est suppose.
pause
exit /b %RESULT%
