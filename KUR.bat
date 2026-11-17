@echo off
chcp 65001 >nul
title Omyrava Studio - Kurulum
cd /d "%~dp0"
echo ============================================
echo   OMYRAVA STUDIO - KURULUM
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [1/5] Node.js bulunamadi, winget ile kuruluyor...
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
) else (
  echo [1/5] Node.js zaten kurulu.
)

where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo [2/5] FFmpeg bulunamadi, winget ile kuruluyor...
  winget install -e --id Gyan.FFmpeg --accept-package-agreements --accept-source-agreements
) else (
  echo [2/5] FFmpeg zaten kurulu.
)

rem Yeni kurulan programlar icin PATH'i yenile
for /f "tokens=2,*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul ^| findstr /i "Path"') do set "SYSPATH=%%b"
for /f "tokens=2,*" %%a in ('reg query "HKCU\Environment" /v Path 2^>nul ^| findstr /i "Path"') do set "USRPATH=%%b"
call set "PATH=%SYSPATH%;%USRPATH%;%PATH%"

where node >nul 2>nul
if errorlevel 1 goto :yeniden

set "FFMPEG_OK="
where ffmpeg >nul 2>nul && set "FFMPEG_OK=1"
if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\ffmpeg.exe" set "FFMPEG_OK=1"
if exist "C:\ffmpeg\bin\ffmpeg.exe" set "FFMPEG_OK=1"
if not defined FFMPEG_OK (
  echo.
  echo UYARI: FFmpeg hala bulunamadi. Kurulum devam ediyor ama analiz/render calismaz.
  echo Cozum: bu pencereyi kapatip KUR.bat'i tekrar calistir. Olmazsa
  echo https://www.gyan.dev/ffmpeg/builds/ adresinden "release essentials" zip'ini indir,
  echo C:\ffmpeg klasorune ac ^(C:\ffmpeg\bin\ffmpeg.exe olacak sekilde^).
  echo.
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo.
  echo HATA: Node.js surumu eski. En az 22.13 gerekli. Bulunan:
  node -v
  echo Guncellemek icin: winget upgrade OpenJS.NodeJS.LTS
  goto :son
)

echo [3/5] Ayar dosyasi hazirlaniyor...
if not exist ".env" copy ".env.example" ".env" >nul

echo [4/5] Paketler yukleniyor (birkac dakika surebilir)...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo HATA: npm install basarisiz oldu. Yukaridaki mesaji Claude'a gonder.
  goto :son
)

if not exist "soundfonts\FluidR3_GM.sf2" (
  echo UYARI: soundfonts\FluidR3_GM.sf2 bulunamadi. Muzik (piyano, keman, viking) uretilemez.
)
echo [5/5] Veritabani hazirlaniyor...
call npm run migrate
if errorlevel 1 (
  echo HATA: Veritabani olusturulamadi.
  goto :son
)

echo.
echo ============================================
echo   KURULUM TAMAM. Simdi BASLAT.bat dosyasini
echo   cift tiklayarak paneli acabilirsin.
echo ============================================
goto :son

:yeniden
echo.
echo Node.js yeni kuruldu ama bu pencere henuz goremiyor.
echo Bu pencereyi kapatip KUR.bat dosyasini TEKRAR cift tikla.

:son
echo.
pause
