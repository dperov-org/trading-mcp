param(
  [string]$ServerName = 'trading_mcp_local'
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$artifactsDir = Join-Path $repoRoot 'artifacts\codex'
$outputPath = Join-Path $artifactsDir 'codex-mcp-smoke-last-message.txt'

New-Item -ItemType Directory -Force -Path $artifactsDir | Out-Null

& (Join-Path $PSScriptRoot 'install-codex-mcp.ps1') -ServerName $ServerName
. (Join-Path $PSScriptRoot 'get-codex-mcp-config-overrides.ps1')

$prompt = @'
Use the MCP server named trading_mcp_local if it is available.
Tell me my current Bybit wallet balance summary in a short answer.
If the MCP server is unavailable, reply with exactly MCP_UNAVAILABLE.
'@

Set-Location $repoRoot
$launchArgs = @()
$launchArgs += Get-CodexMcpConfigOverrides -RepoRoot $repoRoot -ServerName $ServerName
$launchArgs += @(
  'exec',
  '--ignore-user-config',
  '--cd', $repoRoot,
  '--dangerously-bypass-approvals-and-sandbox',
  '--output-last-message', $outputPath,
  '--color', 'never',
  $prompt
)

& codex @launchArgs

if ($LASTEXITCODE -ne 0) {
  throw "codex exec failed with exit code $LASTEXITCODE"
}

$message = (Get-Content -Path $outputPath -Raw).Trim()
if (-not $message) {
  throw "Codex smoke test produced an empty final message."
}

if ($message -eq 'MCP_UNAVAILABLE') {
  throw "Codex smoke test could not access the configured MCP server."
}

Write-Host "Codex MCP smoke output:"
Write-Host $message
