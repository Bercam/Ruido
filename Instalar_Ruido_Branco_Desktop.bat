@echo off
chcp 65001 >nul
title Instalador - Ruído Ambiental

if not exist "%~dp0Instalar.ps1" (
    echo [ERRO] O arquivo Instalar.ps1 nao foi encontrado.
    echo Extraia novamente o conteudo completo do ZIP e tente outra vez.
    pause
    exit /b 1
)

powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0Instalar.ps1"
exit /b %ERRORLEVEL%
