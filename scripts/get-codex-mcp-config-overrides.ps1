function Get-CodexMcpConfigOverrides {
  param(
    [string]$RepoRoot,
    [string]$ServerName = 'trading_mcp_bybit_local',
    [string]$MexcServerName = 'trading_mcp_mexc_local'
  )

  $wrapperScriptPath = (Resolve-Path (Join-Path $RepoRoot 'scripts\run-trading-mcp-for-codex.ps1')).Path
  $mexcWrapperScriptPath = (Resolve-Path (Join-Path $RepoRoot 'scripts\run-mexc-mcp-for-codex.ps1')).Path
  $powershellPath = (Get-Command powershell).Source

  return @(
    '-c',
    "mcp_servers.$ServerName.command='$powershellPath'",
    '-c',
    "mcp_servers.$ServerName.args=['-ExecutionPolicy','Bypass','-File','$wrapperScriptPath']",
    '-c',
    "mcp_servers.$ServerName.cwd='$RepoRoot'",
    '-c',
    "mcp_servers.$MexcServerName.command='$powershellPath'",
    '-c',
    "mcp_servers.$MexcServerName.args=['-ExecutionPolicy','Bypass','-File','$mexcWrapperScriptPath']",
    '-c',
    "mcp_servers.$MexcServerName.cwd='$RepoRoot'"
  )
}
