@echo off
chcp 65001 >nul
title Omyrava Studio - 4K gorsel yapay zekasi kurulumu
cd /d "%~dp0"
setlocal EnableExtensions
set "LOG=%~dp0ai\gorsel-kurulum.log"
set "HF_HOME=%~dp0ai\hf-cache"
set "PY=%~dp0ai\.venv-img\Scripts\python.exe"
echo ============================================
echo   OMYRAVA STUDIO - 4K GORSEL (FLUX.1-schnell)
echo ============================================
echo Ayrintili kayit: ai\gorsel-kurulum.log
echo.
echo === %date% %time% === > "%LOG%"

rem --- HF_TOKEN .env dosyasindan ---
if exist ".env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do if /i "%%a"=="HF_TOKEN" set "HF_TOKEN=%%b"
)
if not defined HF_TOKEN (
  echo HATA: .env dosyasinda HF_TOKEN yok.
  echo ai\GORSEL-KURULUM.txt dosyasindaki 1-3. adimlari yapip tekrar calistir.
  echo HF_TOKEN yok >> "%LOG%"
  goto :son
)

call :pathyenile
where uv >nul 2>nul
if errorlevel 1 (
  echo [1/5] uv kuruluyor...
  winget install -e --id astral-sh.uv --accept-package-agreements --accept-source-agreements >> "%LOG%" 2>&1
  call :pathyenile
)
where uv >nul 2>nul
if errorlevel 1 (
  if exist "%USERPROFILE%\.local\bin\uv.exe" set "PATH=%USERPROFILE%\.local\bin;%PATH%"
)
where uv >nul 2>nul
if errorlevel 1 (
  echo HATA: uv bulunamadi. Pencereyi kapatip GORSEL-KUR.bat'i tekrar calistir.
  goto :son
)
echo [1/5] uv hazir.

echo [2/5] Python 3.11 ve ayri sanal ortam (muzik ortamini etkilemez)...
uv python install 3.11 >> "%LOG%" 2>&1
if not exist "%PY%" uv venv "%~dp0ai\.venv-img" --python 3.11 >> "%LOG%" 2>&1
if not exist "%PY%" (
  echo HATA: Python ortami olusturulamadi. ai\gorsel-kurulum.log dosyasina bak.
  goto :son
)

echo [3/5] PyTorch (CUDA 12.8, RTX 50 serisi icin) indiriliyor... (birkac GB)
uv pip install --python "%PY%" torch==2.7.1 torchvision==0.22.1 --index-url https://download.pytorch.org/whl/cu128 >> "%LOG%" 2>&1
if errorlevel 1 (
  echo HATA: PyTorch kurulamadi. ai\gorsel-kurulum.log dosyasina bak.
  goto :son
)

echo [4/5] Diffusers, GGUF ve 4K buyutucu kutuphaneleri...
uv pip install --python "%PY%" diffusers==0.43.0 transformers==5.23.0 accelerate==1.15.0 gguf==0.19.0 spandrel==0.4.2 sentencepiece==0.2.3 protobuf safetensors "huggingface-hub>=1.7.1" pillow numpy >> "%LOG%" 2>&1
if errorlevel 1 (
  echo HATA: Kutuphaneler kurulamadi. ai\gorsel-kurulum.log dosyasina bak.
  goto :son
)

echo [5/5] Modeller indiriliyor (~20 GB, ilk seferde) ve deneme gorseli uretiliyor...
"%PY%" "%~dp0ai\omyrava_image.py" --setup-test >> "%LOG%" 2>&1
if errorlevel 1 (
  echo.
  echo KURULUM TAMAMLANAMADI. ai\gorsel-durum.json ve ai\gorsel-kurulum.log dosyalarina bak
  echo ya da Claude'a "gorsel kurulumu bitti" de, kaydi o okur.
  goto :son
)
echo.
echo ============================================
echo   GORSEL YAPAY ZEKASI HAZIR. Deneme: ai\test-gorsel.png
echo   Paneli yeniden baslat (DURDUR.bat, sonra BASLAT.bat).
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
