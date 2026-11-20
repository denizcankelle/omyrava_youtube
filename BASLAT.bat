@echo off
chcp 65001 >nul
title Omyrava Studio
cd /d "%~dp0"
if not exist "node_modules" (
  echo Once KUR.bat dosyasini calistir.
  pause
  exit /b 1
)
echo Onceden acik kalan Omyrava Studio surecleri kapatiliyor...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*omyrava-studio*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
timeout /t 2 >nul
echo Paketler kontrol ediliyor (yeni surum varsa yuklenir)...
call npm install --no-audit --no-fund --loglevel=error
echo Omyrava Studio baslatiliyor...
echo Panel birazdan tarayicida acilacak: http://127.0.0.1:3000
echo Kapatmak icin bu pencereyi kapat veya DURDUR.bat dosyasini calistir.
echo.
rem Masaustu kisayolu (ACILIS.vbs) tarayiciyi kendisi acar; o zaman --sessiz ile cagrilir
if /i not "%~1"=="--sessiz" start "" cmd /c "timeout /t 10 >nul & start http://127.0.0.1:3000"
call npm run dev:all
pause
