$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envFilePath = Join-Path $repoRoot '.env'
$tsxLoaderPath = (Resolve-Path (Join-Path $repoRoot 'node_modules\tsx\dist\loader.mjs')).Path
$tsxLoaderUrl = [System.Uri]::new($tsxLoaderPath).AbsoluteUri
$srcIndexPath = (Resolve-Path (Join-Path $repoRoot 'src\index.ts')).Path
$nodePath = (Get-Command node).Source

if (Test-Path $envFilePath) {
  foreach ($line in Get-Content -Path $envFilePath) {
    if ($line -match '^\s*#') { continue }
    if ($line -match '^\s*$') { continue }
    if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') { continue }

    $name = $matches[1]
    $rawValue = $matches[2].Trim()
    if (
      ($rawValue.StartsWith('"') -and $rawValue.EndsWith('"')) -or
      ($rawValue.StartsWith("'") -and $rawValue.EndsWith("'"))
    ) {
      $rawValue = $rawValue.Substring(1, $rawValue.Length - 2)
    }

    [System.Environment]::SetEnvironmentVariable($name, $rawValue)
  }
}

if (-not $env:BYBIT_API_KEY -and $env:BYBIT_RO_API_KEY) {
  $env:BYBIT_API_KEY = $env:BYBIT_RO_API_KEY
}

if (-not $env:BYBIT_API_SECRET -and $env:BYBIT_RO_API_SECRET) {
  $env:BYBIT_API_SECRET = $env:BYBIT_RO_API_SECRET
}

Set-Location $repoRoot
& $nodePath '--import' $tsxLoaderUrl $srcIndexPath
exit $LASTEXITCODE
