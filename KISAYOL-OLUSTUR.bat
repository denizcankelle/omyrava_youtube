@echo off
chcp 65001 >nul
title Omyrava Studio - Masaustu kisayolu
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\kisayol.ps1"
if errorlevel 1 (
  echo HATA: Kisayol olusturulamadi.
  pause
  exit /b 1
)
echo.
echo Masaustundeki "Omyrava Studio" simgesine cift tikla: panel acilir.
timeout /t 5 >nul
