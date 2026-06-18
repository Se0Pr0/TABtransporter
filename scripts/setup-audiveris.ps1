param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$UserAgent = "TABtransporter-audiveris-setup"
$ReleaseApi = "https://api.github.com/repos/Audiveris/audiveris/releases/latest"

function Find-Audiveris {
  if ($env:AUDIVERIS_BIN -and (Test-Path -LiteralPath $env:AUDIVERIS_BIN)) {
    return (Resolve-Path -LiteralPath $env:AUDIVERIS_BIN).Path
  }

  $command = Get-Command audiveris -ErrorAction SilentlyContinue
  if ($command -and $command.Source -and (Test-Path -LiteralPath $command.Source)) {
    return $command.Source
  }

  $candidates = @(
    "$env:ProgramFiles\Audiveris\bin\Audiveris.bat",
    "$env:ProgramFiles\Audiveris\Audiveris.exe",
    "$env:ProgramFiles\Audiveris\Audiveris.bat",
    "${env:ProgramFiles(x86)}\Audiveris\bin\Audiveris.bat",
    "${env:ProgramFiles(x86)}\Audiveris\Audiveris.exe",
    "${env:ProgramFiles(x86)}\Audiveris\Audiveris.bat",
    "$env:LOCALAPPDATA\Programs\Audiveris\bin\Audiveris.bat",
    "$env:LOCALAPPDATA\Programs\Audiveris\Audiveris.exe"
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  $roots = @(
    "$env:ProgramFiles\Audiveris",
    "${env:ProgramFiles(x86)}\Audiveris",
    "$env:LOCALAPPDATA\Programs\Audiveris"
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

  foreach ($root in $roots) {
    $found = Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -in @("Audiveris.bat", "audiveris.bat", "Audiveris.exe", "audiveris.exe") } |
      Select-Object -First 1
    if ($found) {
      return $found.FullName
    }
  }

  return $null
}

$current = Find-Audiveris
if ($current -and -not $Force) {
  [Environment]::SetEnvironmentVariable("AUDIVERIS_BIN", $current, "User")
  Write-Host "Audiveris already installed: $current"
  Write-Host "AUDIVERIS_BIN was saved to the current user environment."
  exit 0
}

Write-Host "Fetching latest Audiveris release from GitHub..."
$release = Invoke-RestMethod -Uri $ReleaseApi -Headers @{ "User-Agent" = $UserAgent; "Accept" = "application/vnd.github+json" }
$asset = $release.assets | Where-Object { $_.name -match "windowsConsole-x86_64\.msi$" } | Select-Object -First 1

if (-not $asset) {
  throw "Windows Console MSI was not found in the latest Audiveris release: $($release.html_url)"
}

$downloadDir = Join-Path $env:TEMP "tabtransporter-audiveris"
New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null
$installerPath = Join-Path $downloadDir $asset.name

Write-Host "Downloading $($asset.name)..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $installerPath -Headers @{ "User-Agent" = $UserAgent }

Write-Host "Installing Audiveris. A Windows permission prompt may appear."
$process = Start-Process -FilePath "msiexec.exe" -ArgumentList @("/i", $installerPath, "/passive", "/norestart") -Wait -PassThru
if ($process.ExitCode -ne 0) {
  throw "Audiveris installer exited with code $($process.ExitCode)."
}

$installed = Find-Audiveris
if (-not $installed) {
  throw "Audiveris installer finished, but the executable was not found. Set AUDIVERIS_BIN manually."
}

[Environment]::SetEnvironmentVariable("AUDIVERIS_BIN", $installed, "User")
$env:AUDIVERIS_BIN = $installed

Write-Host "Audiveris installed: $installed"
Write-Host "AUDIVERIS_BIN was saved to the current user environment."
