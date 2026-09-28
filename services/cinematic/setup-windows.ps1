param(
  [string]$SupabaseUrl = ''
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$venv = Join-Path $root '.venv-splitter'
$python = Join-Path $venv 'Scripts/python.exe'
$settings = Join-Path $PSScriptRoot 'worker.windows.env'

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  throw 'FFmpeg kurulu değil veya PATH içinde bulunamadı. Önce FFmpeg kurun.'
}
if (-not (Test-Path 'C:\Program Files\Tailscale\tailscale.exe') -and
    -not (Get-Command tailscale -ErrorAction SilentlyContinue)) {
  throw 'Tailscale kurulu değil. Önce Tailscale uygulamasını kurup hesabınıza giriş yapın.'
}

if (-not (Test-Path $python)) {
  if (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3.11 -m venv $venv
  } elseif (Get-Command python -ErrorAction SilentlyContinue) {
    & python -c 'import sys; assert sys.version_info[:2] == (3, 11), "Python 3.11 gerekli"'
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.11 kurun.' }
    & python -m venv $venv
  } else {
    throw 'Python 3.11 kurun. Kurulumda Add python.exe to PATH seçeneğini açın.'
  }
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $python)) {
    throw 'Python 3.11 sanal ortamı oluşturulamadı.'
  }
}

& $python -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw 'pip güncellenemedi.' }
& $python -m pip install torch==2.3.1 torchaudio==2.3.1 --index-url https://download.pytorch.org/whl/cu121
if ($LASTEXITCODE -ne 0) { throw 'PyTorch CUDA kurulamadı.' }
& $python -m pip install demucs==4.0.1 'numpy<2' soundfile
if ($LASTEXITCODE -ne 0) { throw 'Ses ayırma bağımlılıkları kurulamadı.' }
& $python -c 'import torch, torchaudio, demucs, soundfile; print("CUDA:", torch.cuda.is_available())'
if ($LASTEXITCODE -ne 0) { throw 'Ses ayırma bağımlılıkları doğrulanamadı.' }

if (-not (Test-Path $settings)) {
  if (-not $SupabaseUrl -and (Test-Path (Join-Path $root '.env.local'))) {
    $line = Get-Content (Join-Path $root '.env.local') |
      Where-Object { $_ -match '^NEXT_PUBLIC_SUPABASE_URL=' } |
      Select-Object -First 1
    if ($line) { $SupabaseUrl = ($line -split '=', 2)[1].Trim().Trim('"', "'") }
  }
  if ($SupabaseUrl -notmatch '^https://[^/]+\.supabase\.co/?$') {
    throw 'Supabase URL bulunamadı. Betiği -SupabaseUrl https://projeniz.supabase.co ile yeniden çalıştırın.'
  }
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $secret = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
  $content = "NEXT_PUBLIC_SUPABASE_URL=$($SupabaseUrl.TrimEnd('/'))`nCINEMATIC_API_KEY=$secret`n"
  [System.IO.File]::WriteAllText($settings, $content)
}

Write-Host "Kurulum tamamlandı. Gizli anahtar $settings dosyasına kaydedildi."
Write-Host 'Sonraki adım: .\services\cinematic\start-windows.ps1'
