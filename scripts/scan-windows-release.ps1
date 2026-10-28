param(
  [Parameter(Mandatory = $true)][string]$Path,
  [switch]$UpdateSignatures
)

$ErrorActionPreference = 'Stop'
$artifact = (Get-Item -LiteralPath $Path).FullName
if ([IO.Path]::GetExtension($artifact) -ne '.zip') { throw 'Expected a Windows release ZIP.' }

$platformRoot = Join-Path $env:ProgramData 'Microsoft/Windows Defender/Platform'
$scanner = Get-ChildItem -LiteralPath $platformRoot -Directory -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending |
  ForEach-Object { Join-Path $_.FullName 'MpCmdRun.exe' } |
  Where-Object { Test-Path -LiteralPath $_ } |
  Select-Object -First 1
if (!$scanner) { $scanner = Join-Path $env:ProgramFiles 'Windows Defender/MpCmdRun.exe' }
if (!(Test-Path -LiteralPath $scanner)) { throw 'Microsoft Defender scanner is unavailable.' }

if ($UpdateSignatures) {
  & $scanner -SignatureUpdate
  if ($LASTEXITCODE -ne 0) { throw "Defender signature update failed: $LASTEXITCODE" }
}

Get-MpComputerStatus | Select-Object AMEngineVersion, AntivirusSignatureVersion, AntivirusSignatureLastUpdated | Format-List
# Custom diagnostic scans inspect archives and ignore exclusions. Without this
# flag, exit code 0 can also mean malware was found and successfully removed.
& $scanner -Scan -ScanType 3 -File $artifact -DisableRemediation
if ($LASTEXITCODE -ne 0) { throw "Defender detected a threat or could not finish the release scan: $LASTEXITCODE" }
if (!(Test-Path -LiteralPath $artifact)) { throw 'Release archive disappeared during scanning.' }
Write-Host "Microsoft Defender release scan passed: $artifact"
