# Serves a windows-x64 Daemon on a throwaway Polaris home and drives it over its named pipe
# with the real Client (windows-smoke.ts: hello, Harness availability, git.status, a Terminal):
#
#   ./apps/daemon/scripts/windows-pipe-smoke.ps1 -Daemon <polaris.exe> [-Repo <git repo>]
#
# Without -Repo it makes a one-commit repository in the throwaway home. Run it from a
# checkout with dependencies installed; Bun and git must be on PATH.
param(
  [Parameter(Mandatory = $true)][string]$Daemon,
  [string]$Repo
)

$ErrorActionPreference = 'Stop'
$daemonPath = (Resolve-Path $Daemon).Path
$polarisHome = Join-Path $env:TEMP "polaris-pipe-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
New-Item -ItemType Directory $polarisHome | Out-Null
$out = Join-Path $polarisHome 'serve.out.log'
$err = Join-Path $polarisHome 'serve.err.log'

if (!$Repo) {
  $Repo = Join-Path $polarisHome 'repo'
  New-Item -ItemType Directory $Repo | Out-Null
  & git -C $Repo init -q
  & git -C $Repo -c user.name=smoke -c user.email=smoke@polaris.invalid commit -q --allow-empty -m smoke
  if ($LASTEXITCODE -ne 0) { throw 'Could not make the smoke repository' }
}

$serve = Start-Process -FilePath $daemonPath -ArgumentList @('serve', '--home', "`"$polarisHome`"") `
  -PassThru -NoNewWindow -RedirectStandardOutput $out -RedirectStandardError $err
try {
  & bun (Join-Path $PSScriptRoot 'windows-smoke.ts') $polarisHome $Repo
  $smoke = $LASTEXITCODE
  if ($serve.HasExited) { throw "The Daemon exited during the smoke test: $($serve.ExitCode)" }
  if ($smoke -ne 0) { throw "The pipe smoke test failed: $smoke" }
  Write-Output "PIPE OK: $daemonPath served $polarisHome"
} catch {
  Write-Output '--- serve stdout'; Get-Content $out -ErrorAction SilentlyContinue
  Write-Output '--- serve stderr'; Get-Content $err -ErrorAction SilentlyContinue
  throw
} finally {
  # The Daemon's children (a Harness, a Terminal) go with it.
  if (!$serve.HasExited) { & taskkill /pid $serve.Id /t /f | Out-Null }
  $serve.WaitForExit(30000) | Out-Null
  for ($try = 1; ; $try++) {
    try { Remove-Item $polarisHome -Recurse -Force -ErrorAction Stop; break }
    catch { if ($try -ge 10) { Write-Warning "Left $polarisHome behind: $_"; break }; Start-Sleep -Milliseconds 500 }
  }
}
