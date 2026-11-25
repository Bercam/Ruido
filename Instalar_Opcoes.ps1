param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath,

    [Parameter(Mandatory = $true)]
    [string]$AppDirectory,

    [Parameter(Mandatory = $true)]
    [string]$ShortcutPath
)

$ErrorActionPreference = 'Stop'

try {
    Add-Type -AssemblyName System.Windows.Forms

    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'Ruído Ambiental'
    $form.Width = 390
    $form.Height = 155
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
    $form.MaximizeBox = $false

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
    if ($dialogResult -ne [System.Windows.Forms.DialogResult]::OK -or -not $shortcutOption.Checked) {
        exit 0
    }

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = $ExecutablePath
    $shortcut.WorkingDirectory = $AppDirectory
    $shortcut.IconLocation = Join-Path $AppDirectory 'app.ico'
    $shortcut.Save()
} catch {
    [Console]::Error.WriteLine("Não foi possível criar o atalho: $($_.Exception.Message)")
    exit 1
}
