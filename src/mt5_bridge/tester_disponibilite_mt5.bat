@echo off
setlocal
cd /d "%~dp0..\.."
if not exist ".venv-mt5\Scripts\python.exe" (
 echo Python .venv-mt5 absent : aucun test execute.
 pause
 exit /b 2
)
set "PYTHONPATH=%CD%\src\mt5_bridge"
echo Tests isoles uniquement : aucun MT5, ordre, worker ou backtest demarre.
".venv-mt5\Scripts\python.exe" -m unittest -v test_mt5_availability test_paper_trial_time test_paper_trial_waiting test_paper_safety test_quote_time test_time_basis test_manual_positions_v87 test_monitor_v86 test_weekly_gap_v87
set "RESULT=%ERRORLEVEL%"
echo Code tests : %RESULT%
echo Les fixtures ne valident pas une connexion MT5 reelle ni la compilation MQL5.
pause
exit /b %RESULT%
