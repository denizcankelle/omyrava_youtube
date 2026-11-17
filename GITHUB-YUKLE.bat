@echo off
chcp 65001 >nul
title Omyrava Studio - GitHub'a yukle
cd /d "%~dp0"
setlocal EnableExtensions
set "REPO=https://github.com/denizcankelle/omyrava_youtube.git"
echo ============================================
echo   OMYRAVA STUDIO - GITHUB'A YUKLE
echo   Depo: %REPO%
echo ============================================
echo Gizli/buyuk dosyalar gonderilmez: .env, data, output, node_modules,
echo yapay zeka ortamlari ve modelleri, SoundFont (.sf2). Liste: .gitignore
echo.

call :pathyenile
where git >nul 2>nul
if errorlevel 1 (
  echo [1/4] Git kuruluyor...
  winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements
  call :pathyenile
)
where git >nul 2>nul
if errorlevel 1 (
  if exist "%ProgramFiles%\Git\cmd\git.exe" set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
)
where git >nul 2>nul
if errorlevel 1 (
  echo HATA: Git bulunamadi. Pencereyi kapatip bu dosyayi tekrar calistir.
  goto :son
)
echo [1/4] Git hazir.

if not exist ".git" (
  echo [2/4] Depo hazirlaniyor...
  git init -b main
  git remote add origin %REPO%
) else (
  echo [2/4] Depo zaten hazir.
  git remote set-url origin %REPO%
)
git config user.name >nul 2>nul || git config user.name "Denizcan Kelle"
git config user.email >nul 2>nul || git config user.email "dccan0719@gmail.com"

echo [3/4] Degisiklikler kaydediliyor...
git add -A
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "Omyrava Studio guncelleme %date% %time:~0,5%"
) else (
  echo Yeni degisiklik yok.
)

echo [4/4] GitHub'a gonderiliyor... (ilk seferde tarayicida GitHub girisi istenebilir)
git push -u origin main
if errorlevel 1 (
  echo.
  echo GONDERILEMEDI. GitHub girisini tamamladigindan emin ol ve tekrar calistir.
  goto :son
)
echo.
echo ============================================
echo   TAMAM: https://github.com/denizcankelle/omyrava_youtube
echo ============================================
goto :son

:pathyenile
for /f "tokens=2,*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul ^| findstr /i "Path"') do set "SYSPATH=%%b"
for /f "tokens=2,*" %%a in ('reg query "HKCU\Environment" /v Path 2^>nul ^| findstr /i "Path"') do set "USRPATH=%%b"
call set "PATH=%SYSPATH%;%USRPATH%;%PATH%"
exit /b 0

:son
echo.
pause
