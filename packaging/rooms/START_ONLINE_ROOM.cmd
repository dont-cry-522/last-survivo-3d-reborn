@echo off
setlocal
chcp 65001 >nul
title Realm Echoes - Online Friends Room
cd /d "%~dp0"
if not exist "runtime\node.exe" (
  echo Please extract the entire ZIP before starting the online room.
  pause
  exit /b 1
)
"runtime\node.exe" "game\packaging\rooms\start-public-room.mjs"
echo.
echo Online room service stopped. You may close this window.
pause
endlocal
