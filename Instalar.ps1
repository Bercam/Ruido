$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms

function Show-InstallError {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message,

        [Parameter(Mandatory = $true)]
        [System.Exception]$Exception
    )

    $logPath = Join-Path $env:TEMP ("RuidoAmbiental-installer-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    $logContent = @"
Falha na instalacao do Ruido Ambiental
Data: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
Mensagem: $Message

Detalhes tecnicos:
$($Exception.ToString())
"@

    try {
        Set-Content -LiteralPath $logPath -Value $logContent -Encoding UTF8
        $logMessage = "`n\nUm registro com detalhes foi salvo em:`n$logPath"
    } catch {
        $logMessage = "`n\nNao foi possivel salvar o registro de detalhes."
    }

    $reason = $Exception.Message.Trim()
    if ($reason.Length -gt 600) {
        $reason = $reason.Substring(0, 600) + '...'
    }

    [System.Windows.Forms.MessageBox]::Show(
        "$Message`n`nMotivo: $reason`n`nConfira se o ZIP foi extraido por completo e tente novamente. Se o problema continuar, envie o registro de detalhes ao suporte.$logMessage",
        'Nao foi possivel instalar o Ruido Ambiental',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
}

function Show-InstallOptions {
    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'Ruído Ambiental'
    $form.Width = 390
    $form.Height = 155
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false

    $label = New-Object System.Windows.Forms.Label
    $label.Text = 'Opções de instalação'
    $label.AutoSize = $true
    $label.Location = New-Object System.Drawing.Point(18, 16)

    $shortcutOption = New-Object System.Windows.Forms.CheckBox
    $shortcutOption.Text = 'Criar atalho na Área de Trabalho'
    $shortcutOption.Checked = $true
    $shortcutOption.AutoSize = $true
    $shortcutOption.Location = New-Object System.Drawing.Point(18, 48)

    $continueButton = New-Object System.Windows.Forms.Button
    $continueButton.Text = 'Continuar'
    $continueButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $continueButton.Location = New-Object System.Drawing.Point(270, 82)

    $form.AcceptButton = $continueButton
    $form.Controls.AddRange([System.Windows.Forms.Control[]]@(
        $label,
        $shortcutOption,
        $continueButton
    ))

    $dialogResult = $form.ShowDialog()
    if ($dialogResult -ne [System.Windows.Forms.DialogResult]::OK) {
        return $null
    }

    return [bool]$shortcutOption.Checked
}

try {
    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        throw 'A pasta local do usuário não foi encontrada. Entre novamente no Windows e tente instalar.'
    }

    $installerDirectory = $PSScriptRoot
    $appDirectory = Join-Path $env:LOCALAPPDATA 'RuidoBrancoApp'
    $appExecutable = Join-Path $appDirectory 'Ruido Ambiental.exe'
    $bundledExecutable = Join-Path $installerDirectory 'Ruido Ambiental.exe'
    $interfaceFile = Join-Path $installerDirectory 'dist\index.html'
    $iconFile = Join-Path $installerDirectory 'app.ico'
    $uninstallerBatch = Join-Path $installerDirectory 'Desinstalar_Ruido_Branco_Desktop.bat'
    $uninstallerScript = Join-Path $installerDirectory 'Desinstalar_Opcoes.ps1'

    foreach ($requiredFile in @($iconFile, $uninstallerBatch, $uninstallerScript)) {
        if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
            throw "Um arquivo necessário não foi encontrado: $([System.IO.Path]::GetFileName($requiredFile)). Extraia novamente todos os arquivos do ZIP."
        }
    }

    $compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) {
        $compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
    }

    $useBundledExecutable = Test-Path -LiteralPath $bundledExecutable -PathType Leaf
    if (-not $useBundledExecutable) {
        if (-not (Test-Path -LiteralPath $interfaceFile -PathType Leaf)) {
            throw 'O executável do aplicativo não veio no pacote e a interface compilada também não foi encontrada. Baixe o pacote completo da página Releases.'
        }
        if (-not (Test-Path -LiteralPath (Join-Path $installerDirectory 'Launcher.cs') -PathType Leaf)) {
            throw 'O executável do aplicativo não veio no pacote e o código-fonte do launcher também não foi encontrado. Baixe o pacote completo da página Releases.'
        }
        if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) {
            throw 'O compilador do Windows não está disponível. Baixe o pacote pronto da página Releases em vez do código-fonte.'
        }
    }

    $createShortcut = Show-InstallOptions
    if ($null -eq $createShortcut) {
        exit 0
    }

    [System.IO.Directory]::CreateDirectory($appDirectory) | Out-Null

    $installedProcesses = Get-CimInstance Win32_Process -Filter "Name='Ruido Ambiental.exe' OR Name='Ruido.exe'" -ErrorAction SilentlyContinue
    foreach ($process in $installedProcesses) {
        $expectedPath = Join-Path $appDirectory $process.Name
        if ($process.ExecutablePath -and [System.String]::Equals(
            [System.IO.Path]::GetFullPath($process.ExecutablePath),
            [System.IO.Path]::GetFullPath($expectedPath),
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
            Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
        }
    }

    if ($useBundledExecutable) {
        Copy-Item -LiteralPath $bundledExecutable -Destination $appExecutable -Force
    } else {
        $compilerArguments = @(
            '/nologo',
            '/target:winexe',
            "/win32icon:$iconFile",
            "/resource:$interfaceFile,RuidoBrancoLauncher.index.html",
            "/out:$appExecutable",
            '/reference:System.Windows.Forms.dll',
            '/reference:System.Drawing.dll',
            '/reference:System.Management.dll',
            '/reference:System.IO.Compression.dll',
            '/reference:System.IO.Compression.FileSystem.dll',
            (Join-Path $installerDirectory 'Launcher.cs')
        )
        $compilerOutput = & $compiler @compilerArguments 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Não foi possível compilar o aplicativo:`n$($compilerOutput -join [Environment]::NewLine)"
        }
    }

    Copy-Item -LiteralPath $iconFile -Destination (Join-Path $appDirectory 'app.ico') -Force
    Copy-Item -LiteralPath $uninstallerBatch -Destination $appDirectory -Force
    Copy-Item -LiteralPath $uninstallerScript -Destination $appDirectory -Force

    if ($createShortcut) {
        $desktopDirectory = [Environment]::GetFolderPath('Desktop')
        if ([string]::IsNullOrWhiteSpace($desktopDirectory)) {
            throw 'A pasta Área de Trabalho do usuário não foi encontrada. Tente novamente ou desmarque a criação do atalho.'
        }

        $shortcutPath = Join-Path $desktopDirectory 'Ruído Ambiental.lnk'
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $appExecutable
        $shortcut.WorkingDirectory = $appDirectory
        $shortcut.IconLocation = Join-Path $appDirectory 'app.ico'
        $shortcut.Save()
    }

    Start-Process -FilePath $appExecutable
} catch {
    Show-InstallError -Message 'A instalação não foi concluída. Verifique as orientações abaixo e tente novamente.' -Exception $_.Exception
    exit 1
}
