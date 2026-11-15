@echo off
setlocal
cd /d "%~dp0..\.."
echo Tests cibles moteur PAPER et preparation - aucun bot, ordre, VERIFY ni backtest.
echo Les anciens replays et le build ne seront pas relances.
echo.
if not exist ".venv-mt5\Scripts\python.exe" (
  echo Environnement .venv-mt5 absent : tests Python NON EXECUTES.
  pause
  exit /b 2
)
echo Commande ciblee preparee :
echo ".venv-mt5\Scripts\python.exe" -m unittest discover -s "src\mt5_bridge" -p "test_preparation_diagnostic.py" -v
".venv-mt5\Scripts\python.exe" -m unittest discover -s "src\mt5_bridge" -p "test_preparation_diagnostic.py" -v
if errorlevel 1 goto failed
echo Commande ciblee preparee :
echo ".venv-mt5\Scripts\python.exe" -m unittest discover -s "src\mt5_bridge" -p "test_clock_diagnostic_v75.py" -v
".venv-mt5\Scripts\python.exe" -m unittest discover -s "src\mt5_bridge" -p "test_clock_diagnostic_v75.py" -v
if errorlevel 1 goto failed
echo Controle isole du lecteur de preuves historiques - fichiers temporaires uniquement.
".venv-mt5\Scripts\python.exe" -m unittest discover -s "src\mt5_bridge" -p "test_historical_evidence.py" -v
if errorlevel 1 goto failed
echo Frais et contexte UTC sur fixtures uniquement.
".venv-mt5\Scripts\python.exe" -m unittest discover -s "src\mt5_bridge" -p "test_preparation_v76.py" -v
if errorlevel 1 goto failed
echo Calendrier et securites du moteur sur donnees synthetiques uniquement.
".venv-mt5\Scripts\python.exe" -m unittest discover -s "src\mt5_bridge" -p "test_server_clock.py" -v
if errorlevel 1 goto failed
".venv-mt5\Scripts\python.exe" -m unittest discover -s "src\mt5_bridge" -p "test_paper_safety.py" -v
if errorlevel 1 goto failed
echo Commande PowerShell isolee preparee :
echo powershell.exe -NoProfile -File "src\mt5_bridge\controler_preparation_paper.ps1" -SelfTest
powershell.exe -NoProfile -File "src\mt5_bridge\controler_preparation_paper.ps1" -SelfTest
if errorlevel 1 goto failed
echo.
echo Validation ciblee terminee selon les sorties ci-dessus. Verdict bot : NON PRET.
echo Aucun registre utilisateur ou endpoint n'est utilise par ces tests synthetiques.
pause
exit /b 0
:failed
echo.
echo Validation interrompue. Conserver le message exact; ne pas demarrer le bot.
echo Ne pas contourner la politique PowerShell. Aucun succes suppose.
pause
exit /b 2
