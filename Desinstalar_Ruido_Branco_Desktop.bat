@echo off
chcp 65001 >nul
title Desinstalador - Ruido Ambiental

set "APP_DIR=%LocalAppData%\RuidoBrancoApp"
set "SCRIPT_PATH=%~dp0Desinstalar_Opcoes.ps1"
if not exist "%SCRIPT_PATH%" (
    echo [ERRO] Arquivo Desinstalar_Opcoes.ps1 nao encontrado.
    pause
    exit /b 1
)

powershell -NoProfile -STA -ExecutionPolicy Bypass -File "%SCRIPT_PATH%"
set "RESULT=%ERRORLEVEL%"
if "%RESULT%"=="0" if /I "%~dp0"=="%APP_DIR%\" del /f /q "%~f0" >nul 2>&1
exit /b %RESULT%
