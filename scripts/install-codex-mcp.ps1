param(
  [string]$ServerName = 'trading_mcp_local',
  [string]$MexcServerName = 'trading_mcp_mexc_local'
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$templatePath = Join-Path $repoRoot 'codex\trading-mcp.codex.template.toml'
$renderedPath = Join-Path $repoRoot 'codex\trading-mcp.codex.toml'
$wrapperScriptPath = (Resolve-Path (Join-Path $repoRoot 'scripts\run-trading-mcp-for-codex.ps1')).Path
$mexcWrapperScriptPath = (Resolve-Path (Join-Path $repoRoot 'scripts\run-mexc-mcp-for-codex.ps1')).Path
$powershellPath = (Get-Command powershell).Source

if (-not (Test-Path $templatePath)) {
  throw "Codex MCP template not found: $templatePath"
}

$template = Get-Content -Path $templatePath -Raw
$rendered = $template.Replace('__SERVER_NAME__', $ServerName)
$rendered = $rendered.Replace('__MEXC_SERVER_NAME__', $MexcServerName)
$rendered = $rendered.Replace('__POWERSHELL_PATH__', $powershellPath)
$rendered = $rendered.Replace('__WRAPPER_SCRIPT__', $wrapperScriptPath)
$rendered = $rendered.Replace('__MEXC_WRAPPER_SCRIPT__', $mexcWrapperScriptPath)
$rendered = $rendered.Replace('__REPO_ROOT__', $repoRoot)

$rendered = $rendered.TrimEnd() + [Environment]::NewLine
Set-Content -Path $renderedPath -Value $rendered -Encoding UTF8

& (Join-Path $PSScriptRoot 'remove-codex-mcp.ps1') -ServerName $ServerName | Out-Null
& (Join-Path $PSScriptRoot 'remove-codex-mcp.ps1') -ServerName $MexcServerName | Out-Null

Write-Host "Rendered project Codex config: $renderedPath"
Write-Host "Global Codex config was not modified. Use inline -c overrides via project launchers."
