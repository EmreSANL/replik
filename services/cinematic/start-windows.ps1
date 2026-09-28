$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$python = Join-Path $root '.venv-splitter/Scripts/python.exe'
$settings = Join-Path $PSScriptRoot 'worker.windows.env'
$tailscale = if (Test-Path 'C:\Program Files\Tailscale\tailscale.exe') {
  'C:\Program Files\Tailscale\tailscale.exe'
} else {
  (Get-Command tailscale -ErrorAction Stop).Source
}

if (-not (Test-Path $python) -or -not (Test-Path $settings)) {
  throw 'Önce services/cinematic/setup-windows.ps1 betiğini çalıştırın.'
}
foreach ($line in Get-Content $settings) {
  if ($line -match '^([A-Z_]+)=(.+)$' -and $Matches[1] -in @('CINEMATIC_API_KEY', 'NEXT_PUBLIC_SUPABASE_URL')) {
    [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
  }
}
if (-not $env:CINEMATIC_API_KEY -or $env:NEXT_PUBLIC_SUPABASE_URL -notmatch '^https://') {
  throw 'worker.windows.env içinde Supabase URL ve ortak anahtar gerekli.'
}

$status = (& $tailscale status --json | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0 -or -not $status.Self.DNSName) {
  throw 'Tailscale hesabına giriş yapın ve MagicDNS özelliğini açın.'
}
$domain = $status.Self.DNSName.TrimEnd('.')
$env:CINEMATIC_API_URL = "https://$domain"
$env:CINEMATIC_HOST = '127.0.0.1'
$env:CINEMATIC_PORT = '8011'

& $tailscale funnel --bg --yes 8011
if ($LASTEXITCODE -ne 0) { throw 'Tailscale Funnel başlatılamadı.' }

Write-Host "Ses motoru: $env:CINEMATIC_API_URL"
Write-Host 'Bu terminali açık bırakın. Vercel ortamına CINEMATIC_API_URL adresini ve worker.windows.env içindeki CINEMATIC_API_KEY değerini ekleyin.'
& $python (Join-Path $PSScriptRoot 'server.py')
if ($LASTEXITCODE -ne 0) { throw 'Ses motoru durdu; yukarıdaki hatayı inceleyin.' }
