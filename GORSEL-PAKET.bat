@echo off
chcp 65001 >nul
title Omyrava Studio - Video arka plani gorsel paketi
cd /d "%~dp0"
echo ============================================
echo   VIDEO ARKA PLANI GORSELLERI (4K + 2K)
echo ============================================
echo Her tur grubu icin yazisiz sahneler uretilir:
echo   gorseller\uyku, piyano, nordic viking, dark blues ve lofi
echo Ilk calistirmada model yuklenir; toplam 15-30 dakika surebilir.
echo Yarida kalirsa tekrar calistir, kaldigi yerden devam eder.
echo.
if exist ".env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do if /i "%%a"=="HF_TOKEN" set "HF_TOKEN=%%b"
)
set "HF_HOME=%~dp0ai\hf-cache"
if not exist "ai\.venv-img\Scripts\python.exe" (
  echo HATA: Gorsel yapay zekasi kurulu degil. Once GORSEL-KUR.bat'i calistir.
  goto :son
)
call npx tsx scripts\gorsel-paketi.ts
if exist "gorseller" start "" explorer "%~dp0gorseller"
:son
echo.
pause
