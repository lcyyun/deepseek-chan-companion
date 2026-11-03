param(
  [ValidateSet('user', 'developer')][string]$Edition = 'user'
)
# A source-workspace shortcut helper. Released ZIPs use Install.ps1 instead.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$packageDir = Join-Path $root ('release\' + $Edition + '\DeepSeek-chan-win32-x64')
$exe = Join-Path $packageDir 'DeepSeek-chan.exe'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Portable build not found: $exe. Run npm run package -- --edition=$Edition first." }
$metadata = Get-Content -LiteralPath (Join-Path $packageDir 'package-info.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($metadata.edition -ne $Edition) { throw 'Portable package edition does not match this shortcut.' }
$displayName = -join @([char]0x5927, [char]0x80a5, [char]0x9c7c)
if ($Edition -eq 'developer') { $displayName += ' ' + [char]0x00b7 + ' ' + (-join @([char]0x5f00, [char]0x53d1, [char]0x7248)) }
$menuName = if ($Edition -eq 'developer') { 'DeepSeekChanDeveloper' } else { 'DeepSeekChan' }
$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) $menuName
[IO.Directory]::CreateDirectory($startMenu) | Out-Null
foreach ($target in @((Join-Path $desktop ($displayName + '.lnk')), (Join-Path $startMenu ($displayName + '.lnk')))) {
  if (Test-Path -LiteralPath $target) {
    $item = Get-Item -LiteralPath $target -Force
    if ($item.PSIsContainer -or $item.LinkType -in @('SymbolicLink', 'Junction')) { throw "Refusing a link or directory: $target" }
    $existing = $shell.CreateShortcut($target)
    if (-not $existing.TargetPath.Equals($exe, [StringComparison]::OrdinalIgnoreCase)) { throw "An existing shortcut points elsewhere and was preserved: $target. Use the released Install.ps1 for an installed-app upgrade." }
  }
  $shortcut = $shell.CreateShortcut($target)
  $shortcut.TargetPath = $exe
  $shortcut.Arguments = ''
  $shortcut.WorkingDirectory = $packageDir
  $shortcut.IconLocation = "$exe,0"
  $shortcut.Description = "DeepSeek-chan $Edition edition"
  $shortcut.Save()
  Write-Output "shortcut=$target"
}
