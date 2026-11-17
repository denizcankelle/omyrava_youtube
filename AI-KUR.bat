@echo off
chcp 65001 >nul
title Omyrava Studio - Yapay zeka kurulumu
cd /d "%~dp0"
setlocal EnableExtensions
set "LOG=%~dp0ai\kurulum.log"
set "HF_HOME=%~dp0ai\hf-cache"
set "PY=%~dp0ai\.venv\Scripts\python.exe"
echo ============================================
echo   OMYRAVA STUDIO - YAPAY ZEKA (Stable Audio 3)
echo ============================================
echo Ayrintili kayit: ai\kurulum.log
echo.
echo === %date% %time% === > "%LOG%"

rem --- HF_TOKEN .env dosyasindan ---
if exist ".env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do if /i "%%a"=="HF_TOKEN" set "HF_TOKEN=%%b"
)
if not defined HF_TOKEN (
  echo HATA: .env dosyasinda HF_TOKEN yok.
  echo ai\YAPAY-ZEKA-KURULUM.txt dosyasindaki 1-3. adimlari yapip tekrar calistir.
  echo HF_TOKEN yok >> "%LOG%"
  goto :son
)

rem --- uv (Python paket yoneticisi) ---
call :pathyenile
where uv >nul 2>nul
if errorlevel 1 (
  echo [1/6] uv kuruluyor...
  winget install -e --id astral-sh.uv --accept-package-agreements --accept-source-agreements >> "%LOG%" 2>&1
  call :pathyenile
)
where uv >nul 2>nul
if errorlevel 1 (
  if exist "%USERPROFILE%\.local\bin\uv.exe" set "PATH=%USERPROFILE%\.local\bin;%PATH%"
)
where uv >nul 2>nul
if errorlevel 1 (
  echo HATA: uv bulunamadi. Pencereyi kapatip AI-KUR.bat'i tekrar calistir.
  goto :son
)
echo [1/6] uv hazir.

echo [2/6] Python 3.11 ve sanal ortam...
uv python install 3.11 >> "%LOG%" 2>&1
if not exist "%PY%" uv venv "%~dp0ai\.venv" --python 3.11 >> "%LOG%" 2>&1
if not exist "%PY%" (
  echo HATA: Python ortami olusturulamadi. ai\kurulum.log dosyasina bak.
  goto :son
)

echo [3/6] PyTorch (CUDA 12.8, RTX 50 serisi icin) indiriliyor... (birkac GB, uzun surebilir)
uv pip install --python "%PY%" torch==2.7.1 torchaudio==2.7.1 --index-url https://download.pytorch.org/whl/cu128 >> "%LOG%" 2>&1
if errorlevel 1 (
  echo HATA: PyTorch kurulamadi. ai\kurulum.log dosyasina bak.
  goto :son
)

echo [4/6] Stable Audio 3 ve bagimliliklari...
uv pip install --python "%PY%" "einops>=0.8.2" "einops-exts>=0.0.4" "numpy>=2.2.6" "packaging>=26.0" "safetensors>=0.7.0" "tqdm>=4.67.3" "huggingface-hub>=1.7.1" "transformers>=5.8.0" "soundfile>=0.13.1" >> "%LOG%" 2>&1
uv pip install --python "%PY%" --no-deps -e "%~dp0ai\stable-audio-3" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo HATA: Stable Audio 3 kurulamadi. ai\kurulum.log dosyasina bak.
  goto :son
)

echo [5/6] Flash Attention (Windows, CUDA 12.8)...
uv pip install --python "%PY%" "https://huggingface.co/lldacing/flash-attention-windows-wheel/resolve/main/flash_attn-2.7.4.post1%%2Bcu128torch2.7.0cxx11abiFALSE-cp311-cp311-win_amd64.whl" >> "%LOG%" 2>&1
if errorlevel 1 echo UYARI: Flash Attention kurulamadi; kucuk model (small-music) denenecek.

echo [6/6] Model indiriliyor ve 10 saniyelik deneme muzigi uretiliyor... (ilk seferde birkac GB indirir)
"%PY%" "%~dp0ai\omyrava_ai.py" --setup-test >> "%LOG%" 2>&1
if errorlevel 1 (
  echo.
  echo KURULUM TAMAMLANAMADI. ai\ai-durum.json ve ai\kurulum.log dosyalarina bak
  echo ya da Claude'a "yapay zeka kurulumu bitti" de, kaydi o okur.
  goto :son
)
echo.
echo ============================================
echo   YAPAY ZEKA HAZIR. Deneme muzigi: ai\test-*.wav
echo   Paneli yeniden baslat (BASLAT.bat).
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
