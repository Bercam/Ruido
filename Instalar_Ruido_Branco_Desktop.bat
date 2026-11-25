@echo off
chcp 65001 >nul
title Instalador - Ruído Ambiental

set "APP_DIR=%LocalAppData%\RuidoBrancoApp"
if not exist "%APP_DIR%" mkdir "%APP_DIR%"
copy /Y "%~dp0app.ico" "%APP_DIR%\app.ico" >nul
copy /Y "%~dp0Desinstalar_Ruido_Branco_Desktop.bat" "%APP_DIR%\Desinstalar_Ruido_Branco_Desktop.bat" >nul
if errorlevel 1 goto install_error
copy /Y "%~dp0Desinstalar_Opcoes.ps1" "%APP_DIR%\Desinstalar_Opcoes.ps1" >nul
if errorlevel 1 goto install_error

set "CSC_PATH=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC_PATH%" set "CSC_PATH=%SystemRoot%\Microsoft.NET\Framework\v4.0.30319\csc.exe"

echo Fechando instancia anterior, se houver...
taskkill /F /IM "Ruido Ambiental.exe" >nul 2>&1
taskkill /F /IM "Ruido.exe" >nul 2>&1

if exist "%~dp0Ruido Ambiental.exe" (
    echo Instalando o executavel pronto...
    copy /Y "%~dp0Ruido Ambiental.exe" "%APP_DIR%\Ruido Ambiental.exe" >nul
    if errorlevel 1 goto install_error
) else (
    if not exist "%~dp0dist\index.html" (
        echo [ERRO] Interface compilada nao encontrada.
        echo Baixe o pacote de uma Release ou execute npm ci e npm run build antes de instalar.
        pause
        exit /b 1
    )
    if not exist "%CSC_PATH%" (
        echo [ERRO] Compilador .NET nativo do Windows nao encontrado.
        pause
        exit /b 1
    )
    echo Compilando o executavel com a interface integrada...
    "%CSC_PATH%" /nologo /target:winexe /win32icon:"%~dp0app.ico" /resource:"%~dp0dist\index.html",RuidoBrancoLauncher.index.html /out:"%APP_DIR%\Ruido Ambiental.exe" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Management.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll "%~dp0Launcher.cs"
    if errorlevel 1 goto install_error
)

for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"`) do set "DESKTOP_DIR=%%D"
set "OUT_EXE=%APP_DIR%\Ruido Ambiental.exe"
set "SHORTCUT_PATH=%DESKTOP_DIR%\Ruído Ambiental.lnk"
powershell -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0Instalar_Opcoes.ps1" -ExecutablePath "%OUT_EXE%" -AppDirectory "%APP_DIR%" -ShortcutPath "%SHORTCUT_PATH%"
if errorlevel 1 goto install_error

ie4uinit.exe -show >nul 2>&1
echo.
echo Instalacao concluida em:
echo %OUT_EXE%
echo.
start "" "%OUT_EXE%"
exit /b 0

:install_error
echo.
echo [ERRO] Nao foi possivel concluir a instalacao.
pause
exit /b 1
