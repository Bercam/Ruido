$ErrorActionPreference = 'Stop'

$appDir = Join-Path $env:LOCALAPPDATA 'RuidoBrancoApp'
$downloadsDir = Join-Path $appDir 'Downloads'
$profileDir = Join-Path $appDir 'WebProfile'
$executablePath = Join-Path $appDir 'Ruido Ambiental.exe'
$desktopPath = [Environment]::GetFolderPath('Desktop')
$shortcutName = 'Ru' + [char]237 + 'do Ambiental.lnk'
$shortcutPath = Join-Path $desktopPath $shortcutName

try {
    Add-Type -AssemblyName System.Windows.Forms

    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'Desinstalar Ruido Ambiental'
    $form.Width = 450
    $form.Height = 205
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false

    $label = New-Object System.Windows.Forms.Label
    $label.Text = 'O aplicativo sera removido deste computador.'
    $label.AutoSize = $true
    $label.Location = New-Object System.Drawing.Point(18, 18)

    $dataOption = New-Object System.Windows.Forms.CheckBox
    $dataOption.Text = 'Tambem apagar downloads, sons locais e configuracoes salvas'
    $dataOption.AutoSize = $true
    $dataOption.Location = New-Object System.Drawing.Point(18, 55)

    $preserveNote = New-Object System.Windows.Forms.Label
    $preserveNote.Text = 'Por padrao, seus dados pessoais serao mantidos.'
    $preserveNote.AutoSize = $true
    $preserveNote.Location = New-Object System.Drawing.Point(18, 83)

    $uninstallButton = New-Object System.Windows.Forms.Button
    $uninstallButton.Text = 'Desinstalar'
    $uninstallButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $uninstallButton.Location = New-Object System.Drawing.Point(235, 120)

    $cancelButton = New-Object System.Windows.Forms.Button
    $cancelButton.Text = 'Cancelar'
    $cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $cancelButton.Location = New-Object System.Drawing.Point(335, 120)

    $form.AcceptButton = $uninstallButton
    $form.CancelButton = $cancelButton
    $form.Controls.AddRange([System.Windows.Forms.Control[]]@(
        $label,
        $dataOption,
        $preserveNote,
        $uninstallButton,
        $cancelButton
    ))

    if ($form.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        exit 2
    }

    $removeUserData = $dataOption.Checked
    $profilePath = [System.IO.Path]::GetFullPath($profileDir).TrimEnd('\')
    $processes = Get-CimInstance Win32_Process -Filter "Name='Ruido Ambiental.exe' OR Name='Ruido.exe' OR Name='chrome.exe' OR Name='msedge.exe' OR Name='yt-dlp.exe' OR Name='deno.exe'" -ErrorAction Stop
    $stoppedProcessIds = @()

    foreach ($process in $processes) {
        $matchesApp = @('Ruido Ambiental.exe', 'Ruido.exe') -contains $process.Name -and
            $process.ExecutablePath -and
            [System.String]::Equals(
                [System.IO.Path]::GetFullPath($process.ExecutablePath),
                [System.IO.Path]::GetFullPath((Join-Path $appDir $process.Name)),
                [System.StringComparison]::OrdinalIgnoreCase
            )
        $matchesProfileBrowser = @('chrome.exe', 'msedge.exe') -contains $process.Name -and
            $process.CommandLine -and
            $process.CommandLine.IndexOf($profilePath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
        $matchesDownloader = @('yt-dlp.exe', 'deno.exe') -contains $process.Name -and
            $process.ExecutablePath -and
            [System.String]::Equals(
                [System.IO.Path]::GetFullPath($process.ExecutablePath),
                [System.IO.Path]::GetFullPath((Join-Path $appDir $process.Name)),
                [System.StringComparison]::OrdinalIgnoreCase
            )

        if ($matchesApp -or $matchesProfileBrowser -or $matchesDownloader) {
            Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
            $stoppedProcessIds += [int]$process.ProcessId
        }
    }

    if ($stoppedProcessIds.Count -gt 0) {
        Wait-Process -Id $stoppedProcessIds -Timeout 5 -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $shortcutPath) {
        Remove-Item -LiteralPath $shortcutPath -Force
    }

    if ($removeUserData) {
        foreach ($dataPath in @($downloadsDir, $profileDir)) {
            if (Test-Path -LiteralPath $dataPath) {
                Remove-Item -LiteralPath $dataPath -Recurse -Force
            }
        }
    }

    $installedFiles = @(
        'Ruido Ambiental.exe',
        'Ruido.exe',
        'app.ico',
        'yt-dlp.exe',
        'deno.exe',
        'window.bounds',
        'Desinstalar_Ruido_Branco_Desktop.bat',
        'Desinstalar_Opcoes.ps1'
    )
    foreach ($fileName in $installedFiles) {
        $filePath = Join-Path $appDir $fileName
        if (Test-Path -LiteralPath $filePath -PathType Leaf) {
            Remove-Item -LiteralPath $filePath -Force
        }
    }

    if ((Test-Path -LiteralPath $appDir -PathType Container) -and
        @(Get-ChildItem -LiteralPath $appDir -Force).Count -eq 0) {
        Remove-Item -LiteralPath $appDir -Force
    }

    if ($removeUserData) {
        [System.Windows.Forms.MessageBox]::Show(
            'O aplicativo e os dados escolhidos foram removidos.',
            'Ruido Ambiental',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        ) | Out-Null
    } else {
        [System.Windows.Forms.MessageBox]::Show(
            "O aplicativo foi removido. Downloads e configuracoes salvas foram mantidos em:`n$appDir",
            'Ruido Ambiental',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        ) | Out-Null
    }

    if ([System.String]::Equals(
        [System.IO.Path]::GetFullPath($PSScriptRoot),
        [System.IO.Path]::GetFullPath($appDir),
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
        Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
    }
    exit 0
} catch {
    [System.Windows.Forms.MessageBox]::Show(
        "Nao foi possivel concluir a desinstalacao:`n$($_.Exception.Message)",
        'Erro ao desinstalar',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    exit 1
}
