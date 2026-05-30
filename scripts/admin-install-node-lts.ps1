$ErrorActionPreference = 'Stop'

$base = 'https://nodejs.org/dist/latest-v24.x'
$msiName = 'node-v24.16.0-x64.msi'
$msiPath = Join-Path $env:TEMP $msiName
$shaPath = Join-Path $env:TEMP 'node-shasums.txt'
$logPath = Join-Path $env:TEMP 'node-install.log'

Invoke-WebRequest -Uri "$base/$msiName" -OutFile $msiPath
Invoke-WebRequest -Uri "$base/SHASUMS256.txt" -OutFile $shaPath

$expected = (
  (Select-String -Path $shaPath -Pattern ([regex]::Escape($msiName) + '$')).Line -split '\s+'
)[0].ToLower()

$actual = (Get-FileHash $msiPath -Algorithm SHA256).Hash.ToLower()

if ($actual -ne $expected) {
  throw "SHA256 mismatch for $msiName. Actual: $actual Expected: $expected"
}

$process = Start-Process msiexec.exe -ArgumentList '/i', $msiPath, '/qn', '/norestart', '/l*v', $logPath -Wait -PassThru

if ($process.ExitCode -ne 0) {
  throw "msiexec exit code: $($process.ExitCode). See $logPath"
}

& 'C:\Program Files\nodejs\node.exe' --version
& 'C:\Program Files\nodejs\npm.cmd' --version
