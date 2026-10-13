param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [ValidateSet('x64', 'arm64')][string]$Arch = 'x64'
)

$ErrorActionPreference = 'Stop'
$installRoot = Join-Path $env:LOCALAPPDATA "Polaris-$Arch-win"
if (Test-Path $installRoot) { throw "Smoke test requires a fresh install: $installRoot already exists" }

$userData = Join-Path $env:TEMP "polaris-windows-smoke-$([guid]::NewGuid())"
New-Item -ItemType Directory $userData | Out-Null
'{"local":{"enabled":false},"automaticAppUpdates":false,"welcomeSeen":true}' |
  Set-Content (Join-Path $userData 'settings.json') -Encoding utf8
$previousUserData = $env:POLARIS_DESKTOP_USER_DATA
$env:POLARIS_DESKTOP_USER_DATA = $userData

try {
  $setup = Start-Process -FilePath (Resolve-Path $Installer) -ArgumentList '--silent' -PassThru
  if (!$setup.WaitForExit(120000)) { throw 'Installer timed out' }
  if ($setup.ExitCode -ne 0) { throw "Installer failed: $($setup.ExitCode)" }

  $shortcut = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\lux.dev LLC\Polaris.lnk'
  if (!(Test-Path $shortcut)) { throw 'Installer did not create the Start menu shortcut' }
  $link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
  if ($link.TargetPath -ne (Join-Path $installRoot 'Polaris.exe')) {
    throw 'Start menu shortcut does not target the installed Polaris launcher'
  }

  $application = Get-ChildItem $installRoot -Directory -Filter 'app-*' |
    ForEach-Object { Join-Path $_.FullName 'Polaris.exe' } |
    Where-Object { Test-Path $_ } |
    Select-Object -First 1
  if (!$application) { throw 'Installer did not create Polaris.exe' }
  Start-Process -FilePath $application | Out-Null

  $deadline = (Get-Date).AddSeconds(60)
  do {
    $window = Get-Process -Name Polaris -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -and $_.Path.StartsWith("$installRoot\", [System.StringComparison]::OrdinalIgnoreCase) -and $_.MainWindowHandle -ne 0 } |
      Select-Object -First 1
    if ($window) { break }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)

  if (!$window) { throw 'Installed Polaris did not open a window' }
  if (!(Test-Path (Join-Path $installRoot 'Update.exe'))) { throw 'Squirrel install root is missing Update.exe' }
  Write-Output "WINDOW OPEN: Windows $Arch; process $($window.Id); $($window.MainWindowTitle)"
} finally {
  Get-Process -Name Polaris -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path.StartsWith("$installRoot\", [System.StringComparison]::OrdinalIgnoreCase) } |
    Stop-Process -Force
  $env:POLARIS_DESKTOP_USER_DATA = $previousUserData
  Remove-Item $userData -Recurse -Force
}
