$ErrorActionPreference = 'Stop'
$target = if ([Environment]::Is64BitOperatingSystem) { 'win32-x64' } else { throw 'Lamina supports Windows x64 only.' }
$base = if ($env:LAMINA_RELEASE_BASE) { $env:LAMINA_RELEASE_BASE } else { 'https://github.com/aryaniyaps/lamina/releases/latest/download' }
$destination = if ($env:LAMINA_INSTALL_DIR) { $env:LAMINA_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Lamina\bin' }
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('lamina-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  Invoke-WebRequest "$base/lamina-$target.exe" -OutFile "$tmp\lamina.exe"
  Invoke-WebRequest "$base/lamina-cocoindex-worker-$target.exe" -OutFile "$tmp\cocoindex-worker.exe"
  Invoke-WebRequest "$base/lamina-retrieval-model-int8-v1.onnx" -OutFile "$tmp\model.onnx"
  Invoke-WebRequest "$base/SHA256SUMS" -OutFile "$tmp\SHA256SUMS"
  $expected = ((Get-Content "$tmp\SHA256SUMS" | Where-Object { $_ -match "  lamina-$target\.exe$" }) -split '\s+')[0]
  if (-not $expected -or (Get-FileHash "$tmp\lamina.exe" -Algorithm SHA256).Hash.ToLower() -ne $expected.ToLower()) { throw 'Checksum verification failed.' }
  $runtimeExpected = ((Get-Content "$tmp\SHA256SUMS" | Where-Object { $_ -match "  lamina-cocoindex-worker-$target\.exe$" }) -split '\s+')[0]
  if (-not $runtimeExpected -or (Get-FileHash "$tmp\cocoindex-worker.exe" -Algorithm SHA256).Hash.ToLower() -ne $runtimeExpected.ToLower()) { throw 'Managed CocoIndex worker checksum verification failed.' }
  $modelExpected = ((Get-Content "$tmp\SHA256SUMS" | Where-Object { $_ -match "  lamina-retrieval-model-int8-v1\.onnx$" }) -split '\s+')[0]
  if (-not $modelExpected -or (Get-FileHash "$tmp\model.onnx" -Algorithm SHA256).Hash.ToLower() -ne $modelExpected.ToLower()) { throw 'Managed retrieval model checksum verification failed.' }
  Move-Item "$tmp\lamina.exe" (Join-Path $destination 'lamina.exe') -Force
  $version = & (Join-Path $destination 'lamina.exe') --version
  $cacheBase = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME 'AppData\Local' }
  $runtimeDir = Join-Path $cacheBase "lamina\runtime\$version\$target\app\observation-runtime"
  $retrievalDir = Join-Path $cacheBase "lamina\runtime\$version\$target\app\retrieval-runtime"
  New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
  Move-Item "$tmp\cocoindex-worker.exe" (Join-Path $runtimeDir 'cocoindex-worker.exe') -Force
  New-Item -ItemType Directory -Force -Path $retrievalDir | Out-Null
  & (Join-Path $runtimeDir 'cocoindex-worker.exe') retrieval extract-assets --destination $retrievalDir | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Managed retrieval assets could not be extracted.' }
  Move-Item "$tmp\model.onnx" (Join-Path $retrievalDir 'model.onnx') -Force
} finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
if (-not (($env:Path -split ';') -contains $destination)) { Write-Warning "Installed to $destination. Add it to your user PATH, then run: lamina doctor --json" }
