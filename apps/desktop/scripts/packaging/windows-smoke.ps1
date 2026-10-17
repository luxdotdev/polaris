param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [ValidateSet('x64', 'arm64')][string]$Arch = 'x64',
  # The Daemon to serve and reach over its pipe when the package carries none for -Arch.
  [string]$Daemon
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

function Stop-InstalledPolaris {
  $running = @(Get-Process -Name Polaris -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path.StartsWith("$installRoot\", [System.StringComparison]::OrdinalIgnoreCase) })
  $running | Stop-Process -Force
  # Stop-Process returns before the processes exit, and they hold user data open until then.
  $running | Wait-Process -Timeout 30 -ErrorAction SilentlyContinue
}

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
  if ($Arch -eq 'x64') {
    # This PC's Daemon and the pipe owner check's native module (ADR 0062).
    $resources = Join-Path (Split-Path $application) 'resources'
    foreach ($file in @('daemon\windows-x64\polaris.exe', 'daemon\manifest.json', 'koffi\win32_x64\koffi.node')) {
      if (!(Test-Path (Join-Path $resources $file))) { throw "The x64 app is missing resources\$file" }
    }
  }
  Start-Process -FilePath (Join-Path $installRoot 'Polaris.exe') | Out-Null

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

  # The Daemon the package carries for this architecture, else -Daemon.
  $bundled = Join-Path (Split-Path $application) "resources\daemon\windows-$Arch\polaris.exe"
  $local = if (Test-Path $bundled) { $bundled } else { $Daemon }
  if ($local) {
    & (Join-Path $PSScriptRoot '..\..\..\daemon\scripts\windows-pipe-smoke.ps1') -Daemon $local
  } else {
    Write-Warning 'No Daemon in the package and no -Daemon: the pipe was not checked'
  }

  Stop-InstalledPolaris
  $env:POLARIS_DESKTOP_USER_DATA = $previousUserData
  if (Test-Path $bundled) {
    # NEGATIVE CHECK (ENG-331, never merged): the app has no Daemon to install, so it must not connect.
    $moved = Join-Path $env:TEMP 'polaris-moved.exe'
    Move-Item $bundled $moved
    & (Join-Path $PSScriptRoot 'windows-connect.ps1') -Application $application -Daemon $moved -TimeoutSeconds 90
  } else {
    Write-Warning "No Daemon in the $Arch package: the app's connection to This PC was not checked"
  }
} finally {
  Stop-InstalledPolaris
  $env:POLARIS_DESKTOP_USER_DATA = $previousUserData
  for ($try = 1; ; $try++) {
    try { Remove-Item $userData -Recurse -Force -ErrorAction Stop; break }
    catch { if ($try -ge 10) { throw }; Start-Sleep -Milliseconds 500 }
  }
}
