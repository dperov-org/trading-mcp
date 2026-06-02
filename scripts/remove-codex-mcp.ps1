param(
  [string]$ServerName = 'trading_mcp_bybit_local'
)

$ErrorActionPreference = 'Stop'

$userConfigPath = Join-Path (Join-Path $env:USERPROFILE '.codex') 'config.toml'

if (-not (Test-Path $userConfigPath)) {
  Write-Host "Codex user config not found: $userConfigPath"
  exit 0
}

$targetPrefix = "mcp_servers.$ServerName"
$updatedLines = [System.Collections.Generic.List[string]]::new()
$skipping = $false

foreach ($line in Get-Content -Path $userConfigPath) {
  if ($line -match '^\[(.+)\]\s*$') {
    $sectionName = $matches[1]
    $skipping = $sectionName -eq $targetPrefix -or $sectionName.StartsWith("$targetPrefix.")
  }

  if ($line.TrimStart().StartsWith('#') -and $line.Contains($targetPrefix)) {
    continue
  }

  if (-not $skipping) {
    $updatedLines.Add($line)
  }
}

$updated = ($updatedLines -join [Environment]::NewLine).Trim()

if ($updated.Length -gt 0) {
  $updated += [Environment]::NewLine
}

Set-Content -Path $userConfigPath -Value $updated -Encoding UTF8
Write-Host "Removed MCP section [mcp_servers.$ServerName] from: $userConfigPath"
