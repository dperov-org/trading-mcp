param(
  [string]$ServerName = 'trading_mcp_bybit_local',
  [string]$MexcServerName = 'trading_mcp_mexc_local',
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$CodexArgs
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Load-ProjectEnv {
  param([string]$Root)

  $envPath = Join-Path $Root '.env'
  if (-not (Test-Path -LiteralPath $envPath)) {
    return
  }

  foreach ($rawLine in Get-Content -LiteralPath $envPath) {
    $line = $rawLine.Trim()
    if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith('#') -or -not $line.Contains('=')) {
      continue
    }

    $separatorIndex = $line.IndexOf('=')
    $key = $line.Substring(0, $separatorIndex).Trim()
    if ([string]::IsNullOrWhiteSpace($key) -or -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($key, 'Process'))) {
      continue
    }

    $value = $line.Substring($separatorIndex + 1).Trim().TrimEnd("`r")
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    [Environment]::SetEnvironmentVariable($key, $value, 'Process')
  }
}

Load-ProjectEnv -Root $repoRoot

$remoteUrl = if (-not [string]::IsNullOrWhiteSpace($env:CODEX_TUI_REMOTE_URL)) {
  $env:CODEX_TUI_REMOTE_URL
} elseif (-not [string]::IsNullOrWhiteSpace($env:CODEX_APP_SERVER_URL)) {
  $env:CODEX_APP_SERVER_URL
} else {
  $env:WEB_UI_CODEX_APP_SERVER_URL
}
$remoteCwd = if (-not [string]::IsNullOrWhiteSpace($env:CODEX_TUI_REMOTE_CWD)) {
  $env:CODEX_TUI_REMOTE_CWD
} else {
  '/root/projects/trading-mcp'
}

Set-Location $repoRoot

if (-not [string]::IsNullOrWhiteSpace($remoteUrl)) {
  $launchArgs = @('--remote', $remoteUrl)
  $launchArgs += @('-C', $remoteCwd)
} else {
  & (Join-Path $PSScriptRoot 'install-codex-mcp.ps1') -ServerName $ServerName
  . (Join-Path $PSScriptRoot 'get-codex-mcp-config-overrides.ps1')

  $launchArgs = @('-C', $repoRoot)
  $launchArgs += Get-CodexMcpConfigOverrides -RepoRoot $repoRoot -ServerName $ServerName -MexcServerName $MexcServerName
}

if (-not ($CodexArgs -contains '--dangerously-bypass-approvals-and-sandbox')) {
  $launchArgs += '--dangerously-bypass-approvals-and-sandbox'
}

$launchArgs += $CodexArgs

& codex @launchArgs
exit $LASTEXITCODE
