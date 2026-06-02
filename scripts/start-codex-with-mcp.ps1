param(
  [string]$ServerName = 'trading_mcp_local',
  [string]$MexcServerName = 'trading_mcp_mexc_local',
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$CodexArgs
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

& (Join-Path $PSScriptRoot 'install-codex-mcp.ps1') -ServerName $ServerName
. (Join-Path $PSScriptRoot 'get-codex-mcp-config-overrides.ps1')

Set-Location $repoRoot

$launchArgs = @('-C', $repoRoot)
$launchArgs += Get-CodexMcpConfigOverrides -RepoRoot $repoRoot -ServerName $ServerName -MexcServerName $MexcServerName

if (-not ($CodexArgs -contains '--dangerously-bypass-approvals-and-sandbox')) {
  $launchArgs += '--dangerously-bypass-approvals-and-sandbox'
}

$launchArgs += $CodexArgs

& codex @launchArgs
exit $LASTEXITCODE
