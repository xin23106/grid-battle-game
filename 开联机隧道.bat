@echo off
chcp 65001 >nul
title HeroChess 联机隧道 (cloudflared)
set "CF=%LOCALAPPDATA%\cloudflared\cloudflared.exe"

if not exist "%CF%" (
  echo [错误] 未找到 cloudflared: "%CF%"
  echo 请先下载 cloudflared-windows-amd64.exe 放到该路径,
  echo 或从 https://github.com/cloudflare/cloudflared/releases 下载。
  pause
  exit /b 1
)

echo ============================================================
echo   正在为本地游戏服务器 (localhost:3000) 打开公网隧道...
echo ============================================================
echo.
echo  下面出现的 https://xxxx.trycloudflare.com 就是公网地址;
echo  对应的【联机地址】是  wss://xxxx.trycloudflare.com
echo  把它填进游戏 「在线真人对战 -^> 服务器」, 点连接即可。
echo.
echo  提示: 隧道地址每次重启都会变; 关掉本窗口隧道即断开。
echo  另外请确保另开了「游戏服务器」(启动游戏.bat 或 node server.js)。
echo.
"%CF%" tunnel --url http://localhost:3000 --no-autoupdate
pause
