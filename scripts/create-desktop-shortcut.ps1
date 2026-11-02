# Create user-level shortcuts for the portable DeepSeek-chan build.
# Run from any PowerShell; it does not require administrator rights.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'release\DeepSeek-chan-win32-x64\DeepSeek-chan.exe'
if (-not (Test-Path -LiteralPath $exe)) {
  throw "Portable build not found: $exe. Run npm run package first."
}
$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) '大肥鱼'
New-Item -ItemType Directory -Path $startMenu -Force | Out-Null
foreach ($target in @((Join-Path $desktop '大肥鱼.lnk'), (Join-Path $startMenu '大肥鱼.lnk'))) {
  $shortcut = $shell.CreateShortcut($target)
  $shortcut.TargetPath = $exe
  $shortcut.Arguments = '--no-sandbox'
  $shortcut.WorkingDirectory = Split-Path -Parent $exe
  $shortcut.IconLocation = "$exe,0"
  $shortcut.Description = '大肥鱼 · DeepSeek-chan 桌面伙伴'
  $shortcut.Save()
  Write-Output "shortcut=$target"
}
