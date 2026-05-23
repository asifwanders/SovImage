# Build stable-diffusion.cpp for Windows x64 (CUDA).
# Outputs frontend/src-tauri/binaries/sd-x86_64-pc-windows-msvc.exe for use as
# a Tauri sidecar (externalBin convention).
#
# Usage (local or CI):
#   pwsh scripts/build-sdcpp-win.ps1
#
# Requires: Visual Studio 2022 Build Tools (cl.exe), CMake, CUDA Toolkit 12.x.

$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$Src      = Join-Path $RepoRoot 'vendor\stable-diffusion.cpp'
$Build    = Join-Path $RepoRoot 'vendor\sdcpp-build-win'
$OutDir   = Join-Path $RepoRoot 'frontend\src-tauri\binaries'
$OutBin   = Join-Path $OutDir   'sd-x86_64-pc-windows-msvc.exe'

if (-not (Test-Path $Src)) {
    Write-Error "Missing $Src. Run: git submodule update --init --recursive"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
if (Test-Path $Build) { Remove-Item -Recurse -Force $Build }

cmake -S $Src -B $Build `
    -DCMAKE_BUILD_TYPE=Release `
    -DSD_CUDA=ON `
    -DSD_BUILD_EXAMPLES=ON `
    -DSD_BUILD_SHARED_LIBS=OFF `
    -DSD_WEBP=OFF `
    -DSD_WEBM=OFF `
    -A x64
if ($LASTEXITCODE -ne 0) { throw "cmake configure failed" }

# Build only the CLI target first; fall back to full build if the target
# name moves between upstream versions.
cmake --build $Build --config Release --target sd-cli -j
if ($LASTEXITCODE -ne 0) {
    Write-Host "sd-cli target build failed, falling back to full build"
    cmake --build $Build --config Release -j
    if ($LASTEXITCODE -ne 0) { throw "cmake build failed" }
}

# Newer sd.cpp ships sd-cli.exe; older ships sd.exe.
$Candidate = $null
foreach ($name in @('sd-cli.exe','sd.exe')) {
    $p = Join-Path $Build "bin\Release\$name"
    if (Test-Path $p) { $Candidate = $p; break }
}
if (-not $Candidate) {
    Get-ChildItem -Recurse "$Build\bin" | ForEach-Object { Write-Host $_.FullName }
    throw "sd binary not found"
}

Copy-Item -Force $Candidate $OutBin
Write-Host "built: $OutBin"

# Smoke check
& $OutBin --help | Select-Object -First 3
