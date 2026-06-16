param(
  [string]$ServerName = 'trading_mcp_bybit_local',
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$AppServerArgs
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'get-codex-mcp-config-overrides.ps1')

$listenUrl = if ([string]::IsNullOrWhiteSpace($env:CODEX_APP_SERVER_LISTEN_URL)) {
  'stdio://'
} else {
  $env:CODEX_APP_SERVER_LISTEN_URL
}

$launchArgs = @('-C', $repoRoot, 'app-server', '--listen', $listenUrl)
$launchArgs += Get-CodexMcpConfigOverrides -RepoRoot $repoRoot -ServerName $ServerName
$launchArgs += $AppServerArgs

Set-Location $repoRoot
& codex @launchArgs
exit $LASTEXITCODE
