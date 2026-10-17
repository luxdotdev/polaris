# ENG-322 on a real Host: a redirected home installs beside the real install without touching
# its task; a hijacked plain task is refused (exit 3) and taken back with --replace-task.
#   powershell -File task-identity.ps1 -Exe <C:\scratch\polaris.exe> -Scratch <C:\scratch>
# It installs into the real profile's .polaris and ends with uninstall --purge (keeping host-id).
param([Parameter(Mandatory)] [string] $Exe, [Parameter(Mandatory)] [string] $Scratch)
$ErrorActionPreference = 'Continue'
$exe = $Exe
$profileDir = [Environment]::GetFolderPath('UserProfile')
$real = Join-Path $profileDir '.polaris'
$fakeProfile = Join-Path $Scratch 'fake'
$fake = Join-Path $fakeProfile '.polaris'
$plain = 'dev.lux.polaris.' + $env:USERNAME
$keep = Join-Path $Scratch 'host-id.bak'
Remove-Item Env:POLARIS_HOME -ErrorAction SilentlyContinue

function Tasks { schtasks /Query /FO CSV /NH | Select-String -SimpleMatch 'dev.lux.polaris' | ForEach-Object { '  ' + $_ } }
function Runs($name) {
  $xml = schtasks /Query /TN $name /XML 2>$null | Out-String
  if ($xml -match '<WorkingDirectory>([^<]*)</WorkingDirectory>') { $Matches[1] } else { '(no task)' }
}
function Step($title) { ''; '== ' + $title }
function Show($out) { '  exit ' + $LASTEXITCODE; ($out | Select-Object -Last 1) | ForEach-Object { '  ' + $_ } }

if (Test-Path "$real\host-id") { Copy-Item "$real\host-id" $keep -Force }

Step 'before'
Tasks

Step 'real install (USERPROFILE as Windows has it)'
$env:USERPROFILE = $profileDir; $env:HOME = $profileDir
Show (& $exe install --json)
"  $plain runs: " + (Runs $plain)

Step 'redirected install (USERPROFILE=' + $fakeProfile + ', no POLARIS_HOME)'
New-Item -ItemType Directory -Force $fakeProfile | Out-Null
$env:USERPROFILE = $fakeProfile; $env:HOME = $fakeProfile
Show (& $exe install --json)
Tasks
"  $plain runs: " + (Runs $plain)

Step 'pre-fix hijack: the plain task re-pointed at the redirected home, as old code did'
schtasks /Create /F /TN $plain /XML "$fake\polaris-task.xml" | Out-Null
"  $plain runs: " + (Runs $plain)

Step 'real install again: refused'
$env:USERPROFILE = $profileDir; $env:HOME = $profileDir
Show (& "$real\bin\current\polaris.exe" install --json)
"  $plain runs: " + (Runs $plain)

Step 'real install --replace-task: taken back'
Show (& "$real\bin\current\polaris.exe" install --json --replace-task)
"  $plain runs: " + (Runs $plain)

Step 'redirected uninstall --purge: its own task only'
$env:USERPROFILE = $fakeProfile; $env:HOME = $fakeProfile
Show (& "$fake\bin\current\polaris.exe" uninstall --purge --json)
Tasks

Step 'real uninstall --purge'
$env:USERPROFILE = $profileDir; $env:HOME = $profileDir
Show (& "$real\bin\current\polaris.exe" uninstall --purge --json)
if (Test-Path $keep) { New-Item -ItemType Directory -Force $real | Out-Null; Move-Item $keep "$real\host-id" -Force; '  host-id restored' }

Step 'after'
Tasks
'  tasks: ' + @(schtasks /Query /FO CSV /NH | Select-String -SimpleMatch 'dev.lux.polaris').Count
'  polaris processes: ' + @(Get-Process polaris -ErrorAction SilentlyContinue).Count
