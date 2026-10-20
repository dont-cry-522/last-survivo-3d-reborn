@echo off
setlocal
chcp 65001 >nul
title Realm Echoes - Private Room
cd /d "%~dp0"
if not exist "runtime\node.exe" (
  echo Please extract the entire ZIP before starting the private room.
  pause
  exit /b 1
)
"runtime\node.exe" "game\packaging\rooms\start-room.mjs"
echo.
echo Private room service stopped. You may close this window.
pause
endlocal
