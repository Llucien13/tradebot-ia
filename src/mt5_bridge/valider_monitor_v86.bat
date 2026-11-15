@echo off
setlocal
cd /d "%~dp0..\.."
echo TradeBot IA V87 - tests isoles V85/V86, positions manuelles et protection anti-gap
echo Aucun worker, bridge, START, ordre MT5 ou backtest ne sera lance.
echo Les fixtures de calendrier et de cotations ne sont pas des preuves de marche reel.
echo.
if not exist ".venv-mt5\Scripts\python.exe" (
  echo Environnement .venv-mt5 absent. Aucun test Python execute.
  echo Ce lanceur n'installe rien et ne modifie aucun registre PAPER.
  pause
  exit /b 2
)
".venv-mt5\Scripts\python.exe" "src\mt5_bridge\run_monitor_v86_tests.py"
set "PY_RESULT=%ERRORLEVEL%"
echo.
echo Code tests Python : %PY_RESULT%
echo Rapport : %LOCALAPPDATA%\TradeBotIA\validation-v87\tests-v87.json
echo.
if not exist "node_modules\typescript\bin\tsc" goto no_types
where node.exe >nul 2>nul
if errorlevel 1 goto no_types
node.exe "node_modules\typescript\bin\tsc" -p "tsconfig.app.json" --noEmit
set "TS_RESULT=%ERRORLEVEL%"
echo Code controle TypeScript : %TS_RESULT%
if not "%PY_RESULT%"=="0" goto failed
if not "%TS_RESULT%"=="0" goto failed
echo Tests prepares termines selon les sorties ci-dessus.
echo V87 NON VALIDEE sur MT5 reel : validation PAPER, positions manuelles et Safari encore requises.
pause
exit /b 0
:no_types
echo Controle TypeScript NON EXECUTE : Node ou dependances locales indisponibles.
echo Les tests Python seuls ne valident pas l'interface.
pause
exit /b 2
:failed
echo Echec constate. Conserver les sorties exactes. Ne pas contourner les protections.
echo Aucune validation MT5 reelle supposee.
pause
exit /b 1
