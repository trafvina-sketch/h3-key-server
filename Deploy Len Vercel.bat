@echo off
chcp 65001 >nul 2>&1
title Deploy H3 Key Server Len Vercel
cd /d "%~dp0"
echo ====================================================
echo    DEPLOY H3 STUDIO KEY SERVER LEN VERCEL (FREE)
echo ====================================================
echo.
call npx vercel --prod
echo.
pause
