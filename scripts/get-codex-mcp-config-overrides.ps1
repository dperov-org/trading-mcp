function Get-CodexMcpConfigOverrides {
  param(
    [string]$RepoRoot,
    [string]$ServerName = 'trading_mcp_local'
  )

  $wrapperScriptPath = (Resolve-Path (Join-Path $RepoRoot 'scripts\run-trading-mcp-for-codex.ps1')).Path
  $powershellPath = (Get-Command powershell).Source

  return @(
    '-c',
    "mcp_servers.$ServerName.command='$powershellPath'",
    '-c',
    "mcp_servers.$ServerName.args=['-ExecutionPolicy','Bypass','-File','$wrapperScriptPath']",
    '-c',
    "mcp_servers.$ServerName.cwd='$RepoRoot'"
  )
}
