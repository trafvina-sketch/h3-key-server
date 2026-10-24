@echo off
chcp 65001 >nul 2>&1
title H3 Studio Pro - Key Server (Local Test)
cd /d "%~dp0"
echo ====================================================
echo    H3 STUDIO PRO - KEY SERVER (http://127.0.0.1:4050)
echo ====================================================
start "" cmd /c "timeout /t 1 /nobreak >nul & start http://127.0.0.1:4050"
node api/index.js
pause
