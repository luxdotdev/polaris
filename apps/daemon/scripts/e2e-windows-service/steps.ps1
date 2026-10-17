# The Windows side of e2e-windows-service.ts: install A, kill the Daemon, upgrade to B,
# uninstall, with a real Client connected throughout. Run from a throwaway directory.
param(
  [Parameter(Mandatory = $true)][string]$Dir,
  [Parameter(Mandatory = $true)][string]$Bun
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$env:POLARIS_HOME = "$Dir\home"
$clientLog = "$Dir\client.log"
$stopFile = "$Dir\client.stop"

function Step($name) { "`n== $name ($(Get-Date -Format HH:mm:ss.fff))" }
function Daemons { @(Get-CimInstance Win32_Process -Filter "Name='polaris.exe'" | ? { $_.CommandLine -like '*serve*' -and $_.ExecutablePath -like "$env:POLARIS_HOME\*" }) }
function Show-Daemons {
  Daemons | % {
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.ParentProcessId)"
    $grand = Get-CimInstance Win32_Process -Filter "ProcessId=$($parent.ParentProcessId)"
    "polaris.exe pid=$($_.ProcessId) session=$($_.SessionId) parent=$($parent.Name)($($parent.ProcessId)) grandparent=$($grand.Name)($($grand.ProcessId))"
    "  cmdline: $($_.CommandLine)"
  }
}
function Wait-Until($what, [scriptblock]$check, $seconds = 30) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) { if (& $check) { return } ; Start-Sleep -Milliseconds 200 }
  throw "timed out waiting for $what"
}
function Client-Lines { if (Test-Path $clientLog) { @(Get-Content $clientLog | % { $_ | ConvertFrom-Json }) } else { @() } }
function Json($text) { ($text | Select-Object -Last 1) | ConvertFrom-Json }

# A previous run's leftovers; a failed step stops the Client too.
trap { New-Item -ItemType File -Force $stopFile | Out-Null; break }
Get-CimInstance Win32_Process -Filter "Name='bun.exe'" | ? { $_.CommandLine -like "*$Dir\client.js*" } | % { Stop-Process -Id $_.ProcessId -Force }
if (Test-Path "$env:POLARIS_HOME\bin\current\polaris.exe") { & "$env:POLARIS_HOME\bin\current\polaris.exe" uninstall --purge --json | Out-Null }
Remove-Item -Recurse -Force "$env:POLARIS_HOME", $clientLog, $stopFile, "$Dir\upload" -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$Dir\ws", "$Dir\upload" | Out-Null

Step "versions"
& "$Dir\polaris-a.exe" version
& "$Dir\polaris-b.exe" version
$versionB = ((& "$Dir\polaris-b.exe" version) -split ' ')[1]

Step "install A (from this SSH session: $((whoami /groups | Select-String 'Mandatory Label') -replace '\s+', ' '))"
$installed = Json (& "$Dir\polaris-a.exe" install --json)
$installed | ConvertTo-Json -Compress
if (-not $installed.ok) { throw "install failed" }
$task = $installed.serviceDomain -replace '^task-scheduler ', ''

Step "the task"
$t = Get-ScheduledTask -TaskName $task
"name=$($t.TaskName) state=$($t.State) user=$($t.Principal.UserId) logonType=$($t.Principal.LogonType) runLevel=$($t.Principal.RunLevel)"
"trigger=$($t.Triggers[0].CimClass.CimClassName) user=$($t.Triggers[0].UserId)"
"action=$($t.Actions[0].Execute) $($t.Actions[0].Arguments)"
"workingDirectory=$($t.Actions[0].WorkingDirectory)"
"battery: disallowStart=$($t.Settings.DisallowStartIfOnBatteries) stopOnBattery=$($t.Settings.StopIfGoingOnBatteries) timeLimit=$($t.Settings.ExecutionTimeLimit) multiple=$($t.Settings.MultipleInstances) idleStop=$($t.Settings.IdleSettings.StopOnIdleEnd)"
Show-Daemons

Step "a real Client connects over the pipe and seeds an Agent Session"
$client = Start-Process -FilePath $Bun -ArgumentList "`"$Dir\client.js`" `"$env:POLARIS_HOME`" `"$clientLog`" `"$stopFile`" --seed `"$Dir\ws`"" -PassThru -WindowStyle Hidden
Wait-Until "the seeded session" { @(Client-Lines | ? { $_.ev -eq 'snapshot' -and $_.sessions.Count -gt 0 }).Count -gt 0 }
Client-Lines | % { $_ | ConvertTo-Json -Compress -Depth 5 }

Step "kill the Daemon; the task's loop restarts it"
$before = @(Daemons)[0].ProcessId
$killedAt = Get-Date
Stop-Process -Id $before -Force
Wait-Until "a new Daemon" { $d = @(Daemons); $d.Count -eq 1 -and $d[0].ProcessId -ne $before }
"restarted in $([int]((Get-Date) - $killedAt).TotalMilliseconds) ms"
Show-Daemons
Wait-Until "the Client's reconnection" { @(Client-Lines | ? { $_.ev -eq 'snapshot' }).Count -ge 2 }
Client-Lines | Select-Object -Last 3 | % { $_ | ConvertTo-Json -Compress -Depth 5 }

Step "upgrade to B, as a Client does: upload, then current\polaris.exe upgrade"
Copy-Item "$Dir\polaris-b.exe" "$Dir\upload\polaris.exe"
$upgradeAt = Get-Date
$upgraded = Json (& "$env:POLARIS_HOME\bin\current\polaris.exe" upgrade "$Dir\upload\polaris.exe" --json)
"upgrade took $([int]((Get-Date) - $upgradeAt).TotalMilliseconds) ms"
$upgraded | ConvertTo-Json -Compress
Show-Daemons
cmd /c dir "$env:POLARIS_HOME\bin" | Select-String 'JUNCTION|DIR'
Wait-Until "the Client on B" { @(Client-Lines | ? { $_.ev -eq 'status' -and $_.state -eq 'connected' -and $_.version -eq $versionB }).Count -gt 0 }
Wait-Until "a snapshot from B" { @(Client-Lines | ? { $_.ev -eq 'snapshot' }).Count -ge 3 }
Client-Lines | Select-Object -Last 4 | % { $_ | ConvertTo-Json -Compress -Depth 5 }

Step "the Daemon's log"
Get-Content "$env:POLARIS_HOME\logs\daemon.out.log" | Select-String 'listening|stopping'

Step "uninstall"
New-Item -ItemType File $stopFile | Out-Null
$client.WaitForExit(10000) | Out-Null
$removed = Json (& "$env:POLARIS_HOME\bin\current\polaris.exe" uninstall --json)
$removed | ConvertTo-Json -Compress
Start-Sleep 2
"task still registered: $([bool](Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue))"
"Daemons left: $(@(Daemons).Count)"
"loops left: $(@(Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | ? { $_.CommandLine -like '*bin\current\polaris.exe*' }).Count)"
"bin left: $(Test-Path "$env:POLARIS_HOME\bin")"
