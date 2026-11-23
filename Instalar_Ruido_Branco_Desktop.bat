@echo off
chcp 65001 >nul
title Instalador - Ruido Ambiental (YouTube ^& Local Fix)

set "APP_DIR=%LocalAppData%\RuidoBrancoApp"
if not exist "%APP_DIR%" mkdir "%APP_DIR%"

copy /Y "%~dp0index.html" "%APP_DIR%\index.html" >nul
copy /Y "%~dp0app.ico" "%APP_DIR%\app.ico" >nul

for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"`) do set "DESKTOP_DIR=%%D"
set "OUT_EXE=%DESKTOP_DIR%\Ruido Ambiental.exe"

set "CSC_PATH=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC_PATH%" (
    set "CSC_PATH=%SystemRoot%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)

if not exist "%CSC_PATH%" (
    echo [ERRO] Compilador .NET nativo do Windows nao encontrado.
    pause
    exit /b 1
)

echo Fechando instancia antiga (se houver)...
taskkill /F /IM "Ruido Ambiental.exe" >nul 2>&1
taskkill /F /IM "Ruido.exe" >nul 2>&1

echo Atualizando executavel na Area de Trabalho...
"%CSC_PATH%" /nologo /target:winexe /win32icon:"%~dp0app.ico" /out:"%OUT_EXE%" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Management.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll "%~dp0Launcher.cs"

if %errorlevel% neq 0 (
    echo [ERRO] Falha ao compilar o executavel.
    pause
    exit /b 1
)

ie4uinit.exe -show >nul 2>&1

echo.
echo ==========================================================
echo  PRONTO! Executavel atualizado na sua Area de Trabalho:
echo  %OUT_EXE%
echo ==========================================================
echo.
start "" "%OUT_EXE%"
ping -n 2 127.0.0.1 >nul