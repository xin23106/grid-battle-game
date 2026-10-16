@echo off
chcp 65001 >nul
title HeroChess Launcher

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo ==========================================
echo    Hero Chess  -  one-click launcher
echo    Keep the TWO new windows running.
echo    (this window can be closed)
echo ==========================================
echo.

REM ---------- locate node ----------
cd /d "%ROOT%\server"
where node >nul 2>nul
if errorlevel 1 (
  echo [i] 'node' not on PATH, using full path...
  start "HeroChess Server (3000)" cmd /k ""%ProgramFiles%\nodejs\node.exe" server.js"
) else (
  start "HeroChess Server (3000)" cmd /k node server.js
)

REM ---------- locate python ----------
cd /d "%ROOT%"
where python >nul 2>nul
if errorlevel 1 (
  start "HeroChess Web (8765)" cmd /k py serve.py
) else (
  start "HeroChess Web (8765)" cmd /k python serve.py
)

REM ---------- open the game ----------
ping -n 3 127.0.0.1 >nul
start "" "http://localhost:8765/index.html"

echo.
echo Started. A browser should open the game.
echo Do NOT close the two black windows while playing.
echo.
ping -n 4 127.0.0.1 >nul
exit
