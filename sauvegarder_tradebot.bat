@echo off
setlocal
title TradeBot IA - Sauvegarde externe avant etape B
where py >nul 2>&1
if errorlevel 1 (
  where python >nul 2>&1
  if errorlevel 1 (
    echo Python 3 est requis, comme pour la passerelle MT5. Aucune sauvegarde creee.
    pause
    exit /b 1
  )
  python "%~dp0src\backup\external_backup.py"
) else (
  py -3 "%~dp0src\backup\external_backup.py"
)
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" echo Verification non reussie : ne pas commencer la simplification.
pause
exit /b %RESULT%
