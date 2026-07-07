@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem ============================================================
rem  WordMiner - 本机字幕服务 (helper)
rem  YouTube 封锁了云服务器 IP，抓字幕必须在你本机(住宅IP)进行。
rem  Render 上的网页会调用这个本机服务来抓字幕。
rem
rem  用法：双击本文件启动，保持这个黑窗口开着即可。
rem  前提：你的代理正在运行(端口 17890)，本机能访问 YouTube。
rem  若你的代理端口不是 17890，请改下面两行的端口号。
rem ============================================================

set NODE_USE_ENV_PROXY=1
set HTTPS_PROXY=http://127.0.0.1:17890
set HTTP_PROXY=http://127.0.0.1:17890

echo.
echo  WordMiner 本机字幕服务启动中...
echo  地址: http://127.0.0.1:3000
echo  代理: %HTTPS_PROXY%
echo.
echo  保持本窗口开着。用完直接关闭本窗口即可。
echo ------------------------------------------------------------
echo.

node server.js

echo.
echo  服务已停止。按任意键关闭窗口。
pause >nul
