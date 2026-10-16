@echo off
chcp 65001 >nul
title HeroChess 联机隧道
set "CF=%LOCALAPPDATA%\cloudflared\cloudflared.exe"

if not exist "%CF%" (
  echo [错误] 未找到 cloudflared: "%CF%"
  echo 从 https://github.com/cloudflare/cloudflared/releases 下载
  echo cloudflared-windows-amd64.exe 放到该路径即可。
  pause
  exit /b 1
)

echo ============================================================
echo  正在打开两条公网隧道（会自动弹出两个窗口，别关）:
echo    1) 联机服务器隧道  ^-^>  本地 3000
echo    2) 游戏网页隧道    ^-^>  本地 8765
echo ============================================================
echo.
echo  请先确保游戏服务器和网页服务已启动（双击「启动游戏.bat」）。
echo  两个窗口里各会出现一条 https://xxxx.trycloudflare.com:
echo    * 联机窗口那条  =^> 对应的联机地址是 wss://xxxx.trycloudflare.com
echo      填进游戏「在线真人对战 ^-^> 服务器」后点「连接」。
echo    * 网页窗口那条  =^> 好友用浏览器打开 https://xxxx.trycloudflare.com/index.html
echo.
echo  地址每次重启都会变，变了重新填一次即可。
echo.

start "HeroChess 联机隧道 (3000)" cmd /k ""%CF%" tunnel --url http://localhost:3000 --no-autoupdate --protocol http2"
start "HeroChess 网页隧道 (8765)" cmd /k ""%CF%" tunnel --url http://localhost:8765 --no-autoupdate --protocol http2"
