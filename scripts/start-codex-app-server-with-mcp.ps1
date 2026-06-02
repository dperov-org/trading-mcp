param(
  [string]$ServerName = 'trading_mcp_bybit_local',
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$AppServerArgs
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'get-codex-mcp-config-overrides.ps1')

$launchArgs = @('-C', $repoRoot, 'app-server', '--listen', 'stdio://')
$launchArgs += Get-CodexMcpConfigOverrides -RepoRoot $repoRoot -ServerName $ServerName
$launchArgs += $AppServerArgs

Set-Location $repoRoot
& codex @launchArgs
exit $LASTEXITCODE
