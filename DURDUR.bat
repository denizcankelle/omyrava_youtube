@echo off
chcp 65001 >nul
title Omyrava Studio - Durdur
echo Omyrava Studio (panel ve worker) kapatiliyor...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*omyrava-studio*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo Tamam.
timeout /t 3 >nul
