param(
  [string]$Archive,
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeekChan'),
  [switch]$NoShortcuts
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression

# Ordinary user install only. No elevation, ACL edits, process termination, or data migration.
function Assert-ChildPath([string]$Parent, [string]$Candidate) {
  $prefix = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
  $full = [IO.Path]::GetFullPath($Candidate)
  if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Path escapes the installation root: $Candidate" }
  return $full
}
function Assert-NoReparseAncestor([string]$Candidate) {
  $current = [IO.Path]::GetFullPath($Candidate)
  while ($current) {
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Refusing a symbolic link or junction: $current" }
    }
    $current = [IO.Path]::GetDirectoryName($current)
  }
}
function Assert-EntryPath([string]$Relative) {
  if (-not $Relative -or $Relative -match '(^/|\\|:|[\x00-\x1f]|(^|/)\.{1,2}(/|$)|//)' -or $Relative -match '(^|/)[^/]*[. ](/|$)' -or $Relative -match '(^|/)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|/|$)') { throw "Invalid package path: $Relative" }
}
function Get-StreamHash($Stream) {
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($hasher.ComputeHash($Stream)).Replace('-', '').ToLowerInvariant() }
  finally { $hasher.Dispose() }
}
function Get-PayloadList([string]$Directory) {
  $prefix = [IO.Path]::GetFullPath($Directory).TrimEnd('\') + '\'
  $queue = [Collections.Generic.Queue[string]]::new()
  $queue.Enqueue($Directory)
  while ($queue.Count -gt 0) {
    foreach ($item in Get-ChildItem -LiteralPath $queue.Dequeue() -Force) {
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Refusing a package reparse point: $($item.FullName)" }
      if ($item.PSIsContainer) { $queue.Enqueue($item.FullName) }
      else { $item.FullName.Substring($prefix.Length).Replace('\', '/') }
    }
  }
}
function Confirm-PackageDirectory([string]$Directory, $ManifestData) {
  $expected = @{}
  foreach ($item in $ManifestData.files) { $expected[$item.path] = $item }
  $expected['release-manifest.json'] = $null
  $actual = @(Get-PayloadList $Directory)
  if ($actual.Count -ne $expected.Count) { throw "The package contains missing or unrecognized files: $Directory" }
  foreach ($relative in $actual) {
    if (-not $expected.ContainsKey($relative)) { throw "Unrecognized file in the package: $relative" }
    if ($relative -eq 'release-manifest.json') { continue }
    $item = $expected[$relative]
    $file = Assert-ChildPath $Directory (Join-Path $Directory $relative)
    $inputStream = [IO.File]::OpenRead($file)
    try {
      if ($inputStream.Length -ne $item.bytes -or (Get-StreamHash $inputStream) -ne $item.sha256) { throw "Package checksum mismatch: $relative" }
    } finally { $inputStream.Dispose() }
  }
}
function Write-Shortcut([string]$ShortcutPath, [string]$Executable, [string]$WorkingDirectory) {
  # Windows Known Folders can be redirected through OneDrive/cloud reparse points.
  # Trust that system-selected parent location, but never follow a shortcut leaf link.
  $shortcutItem = $null
  try { $shortcutItem = Get-Item -LiteralPath $ShortcutPath -Force }
  catch [System.Management.Automation.ItemNotFoundException] { }
  if ($shortcutItem -and ($shortcutItem.PSIsContainer -or $shortcutItem.LinkType -in @('SymbolicLink', 'Junction'))) { throw "Refusing a symbolic link or junction at the shortcut file: $ShortcutPath" }
  $shell = New-Object -ComObject WScript.Shell
  if (Test-Path -LiteralPath $ShortcutPath) {
    $existing = $shell.CreateShortcut($ShortcutPath)
    if (-not $existing.TargetPath.Equals($Executable, [StringComparison]::OrdinalIgnoreCase)) {
      $oldDirectory = [IO.Path]::GetDirectoryName($existing.TargetPath)
      $oldManifest = Join-Path $oldDirectory 'release-manifest.json'
      if ([IO.Path]::GetDirectoryName($oldDirectory) -ne $installBase -or [IO.Path]::GetFileName($oldDirectory) -notmatch '^app-[0-9A-Za-z][0-9A-Za-z.+-]*$' -or [IO.Path]::GetFileName($existing.TargetPath) -ne 'DeepSeek-chan.exe' -or -not (Test-Path -LiteralPath $oldManifest -PathType Leaf) -or (Get-Content -LiteralPath $oldManifest -Raw -Encoding UTF8 | ConvertFrom-Json).package -ne 'deepseek-chan-companion') { throw "An unrelated shortcut already exists; it was not changed: $ShortcutPath" }
    }
  }
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $Executable
  $shortcut.WorkingDirectory = $WorkingDirectory
  $shortcut.Arguments = ''
  $shortcut.IconLocation = "$Executable,0"
  $shortcut.Description = 'DeepSeek-chan desktop companion'
  $shortcut.Save()
}

$programsRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs'))
$installBase = Assert-ChildPath $programsRoot $InstallRoot
Assert-NoReparseAncestor $installBase
$target = $null
$zip = $null
$archiveStream = $null
$staging = $null
try {
  if ($Archive) {
    $archivePath = [IO.Path]::GetFullPath($Archive)
    Assert-NoReparseAncestor $archivePath
    $checksumPath = "$archivePath.sha256"
    if (-not (Test-Path -LiteralPath $checksumPath -PathType Leaf)) { throw "ZIP checksum file is missing: $checksumPath" }
    $checksum = (Get-Content -LiteralPath $checksumPath -Raw).Trim()
    if ($checksum -notmatch '^([0-9a-fA-F]{64})  (.+)$' -or $Matches[2] -cne [IO.Path]::GetFileName($archivePath)) { throw 'Invalid ZIP checksum file.' }
    $expectedZipHash = $Matches[1].ToLowerInvariant()
    $archiveStream = [IO.File]::OpenRead($archivePath)
    if ((Get-StreamHash $archiveStream) -ne $expectedZipHash) { throw 'ZIP checksum mismatch. Download the package again.' }
    $archiveStream.Position = 0
    $zip = [IO.Compression.ZipArchive]::new($archiveStream, [IO.Compression.ZipArchiveMode]::Read, $true)
    $manifestEntry = $zip.GetEntry('release-manifest.json')
    if ($null -eq $manifestEntry -or $manifestEntry.Length -gt 16777216) { throw 'ZIP release manifest is missing or too large.' }
    $reader = [IO.StreamReader]::new($manifestEntry.Open(), [Text.Encoding]::UTF8)
    try { $manifestText = $reader.ReadToEnd() } finally { $reader.Dispose() }
  } else {
    Assert-NoReparseAncestor $PSScriptRoot
    $manifestFile = Join-Path $PSScriptRoot 'release-manifest.json'
    if (-not (Test-Path -LiteralPath $manifestFile -PathType Leaf)) { throw 'Run Install.ps1 from the extracted release, or provide -Archive with the release ZIP.' }
    $manifestText = Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8
  }
  $metadata = $manifestText | ConvertFrom-Json
  if ($metadata.schemaVersion -ne 1 -or $metadata.package -ne 'deepseek-chan-companion' -or $metadata.platform -ne 'win32-x64' -or $metadata.version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$' -or $metadata.modelIncluded -ne $false -or $metadata.userDataIncluded -ne $false -or $metadata.files.Count -gt 50000 -or $metadata.files.Count -lt 3 -or $metadata.fileCount -ne $metadata.files.Count) { throw 'Unsupported release manifest.' }
  $target = Assert-ChildPath $installBase (Join-Path $installBase ('app-' + $metadata.version))
  $expected = @{}
  [long]$total = 0
  foreach ($item in $metadata.files) {
    Assert-EntryPath $item.path
    if ($item.path -eq 'release-manifest.json' -or $expected.ContainsKey($item.path) -or $item.sha256 -notmatch '^[0-9a-f]{64}$' -or $item.bytes -lt 0 -or $item.bytes -gt 8589934592 -or [Math]::Floor([double]$item.bytes) -ne $item.bytes) { throw "Invalid manifest entry: $($item.path)" }
    $expected[$item.path] = $item
    $total += $item.bytes
  }
  if ($total -ne $metadata.bytes -or $total -gt 8589934592) { throw 'Invalid release size.' }
  foreach ($required in @('DeepSeek-chan.exe', 'resources/app/package.json', 'package-info.json', 'Install.ps1')) { if (-not $expected.ContainsKey($required)) { throw "Missing package file: $required" } }
  if ($zip) {
    $seen = @{}
    foreach ($entry in $zip.Entries) {
      Assert-EntryPath $entry.FullName
      if ($seen.ContainsKey($entry.FullName) -or (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw "Duplicate or symbolic-link ZIP entry: $($entry.FullName)" }
      $seen[$entry.FullName] = $true
      if ($entry.FullName -eq 'release-manifest.json') { continue }
      if (-not $expected.ContainsKey($entry.FullName) -or $entry.Length -ne $expected[$entry.FullName].bytes) { throw "Unexpected ZIP entry: $($entry.FullName)" }
    }
    if ($seen.Count -ne $expected.Count + 1) { throw 'ZIP file inventory does not match its manifest.' }
  } else { Confirm-PackageDirectory $PSScriptRoot $metadata }

  if (Test-Path -LiteralPath $target) {
    Assert-NoReparseAncestor $target
    $existingManifest = Join-Path $target 'release-manifest.json'
    if (-not (Test-Path -LiteralPath $existingManifest -PathType Leaf) -or (Get-Content -LiteralPath $existingManifest -Raw -Encoding UTF8) -cne $manifestText) { throw "A different installation of this version was preserved at $target. This installer never overwrites existing files. Keep DeepSeek-chan-data, and use a new release version or a new -InstallRoot under LocalAppData\Programs." }
    Confirm-PackageDirectory $target $metadata
    Write-Host 'The identical installed release passed all checks; no files were replaced.'
  } else {
    [IO.Directory]::CreateDirectory($installBase) | Out-Null
    $staging = Assert-ChildPath $installBase (Join-Path $installBase ('.install-' + [Guid]::NewGuid().ToString('N')))
    [IO.Directory]::CreateDirectory($staging) | Out-Null
    foreach ($item in $metadata.files) {
      $destination = Assert-ChildPath $staging (Join-Path $staging $item.path)
      [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
      $inputStream = if ($zip) { $zip.GetEntry($item.path).Open() } else { [IO.File]::OpenRead((Join-Path $PSScriptRoot $item.path)) }
      $outputStream = $null
      try {
        $outputStream = [IO.File]::Open($destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $inputStream.CopyTo($outputStream)
      } finally {
        if ($outputStream) { $outputStream.Dispose() }
        $inputStream.Dispose()
      }
    }
    [IO.File]::WriteAllText((Join-Path $staging 'release-manifest.json'), $manifestText, [Text.UTF8Encoding]::new($false))
    Confirm-PackageDirectory $staging $metadata
    # Directory.Move refuses an existing destination. It never merges or overwrites.
    [IO.Directory]::Move($staging, $target)
    $staging = $null
    Write-Host "Installed version $($metadata.version): $target"
  }
  if (-not $NoShortcuts) {
    $installPrefix = $installBase.TrimEnd('\') + '\app-'
    foreach ($process in Get-Process -Name 'DeepSeek-chan' -ErrorAction SilentlyContinue) {
      if ($process.Path -and $process.Path.StartsWith($installPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'The new release is installed. Please exit DeepSeek-chan normally, then run this installer again to update the shortcuts. No process was stopped.' }
    }
    $exe = Join-Path $target 'DeepSeek-chan.exe'
    # Keep this script ASCII so Windows PowerShell 5.1 reads it without a BOM.
    $displayName = -join @([char]0x5927, [char]0x80a5, [char]0x9c7c)
    $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'DeepSeekChan'
    Assert-NoReparseAncestor $menu
    [IO.Directory]::CreateDirectory($menu) | Out-Null
    Write-Shortcut (Join-Path $menu ($displayName + '.lnk')) $exe $target
    $desktop = [Environment]::GetFolderPath('Desktop')
    Write-Shortcut (Join-Path $desktop ($displayName + '.lnk')) $exe $target
    Write-Host 'Desktop and Start menu shortcuts are ready. Start DeepSeek-chan when you are ready.'
  }
  Write-Host "User data stays separate: $(Join-Path $installBase 'DeepSeek-chan-data')"
  Write-Host 'No model, account, token, or personal settings were installed. Configure your own model and agent in the app.'
} finally {
  if ($zip) { $zip.Dispose() }
  if ($archiveStream) { $archiveStream.Dispose() }
  if ($staging -and (Test-Path -LiteralPath $staging)) {
    $checked = Assert-ChildPath $installBase $staging
    Assert-NoReparseAncestor $checked
    if ([IO.Path]::GetFileName($checked) -notmatch '^\.install-[0-9a-f]{32}$') { throw 'Refusing to remove an unrecognized staging directory.' }
    Remove-Item -LiteralPath $checked -Recurse -Force
  }
}
