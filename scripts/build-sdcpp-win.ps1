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
Get-ChildItem $OutDir -Filter '*.dll' -File -ErrorAction SilentlyContinue | Remove-Item -Force
Remove-Item (Join-Path $OutDir 'sdcpp-runtime-manifest.json') -Force -ErrorAction SilentlyContinue
if (Test-Path $Build) { Remove-Item -Recurse -Force $Build }

cmake -S $Src -B $Build `
    -DCMAKE_BUILD_TYPE=Release `
    -DSD_CUDA=ON `
    -DSD_BUILD_EXAMPLES=ON `
    -DSD_BUILD_SHARED_LIBS=OFF `
    -DSD_WEBP=OFF `
    -DSD_WEBM=OFF `
    -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded `
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

# CUDA for Windows does not ship static cuBLAS, so copy the complete
# non-system DLL dependency closure beside the sidecar. Tauri installs these
# files beside the application and sidecar executable.
$VsWhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$VsRoot = (& $VsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
$Dumpbin = Get-ChildItem "$VsRoot\VC\Tools\MSVC\*\bin\Hostx64\x64\dumpbin.exe" |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $Dumpbin) { throw 'dumpbin.exe not found' }

$VcRuntimeRoots = @(Get-ChildItem "$VsRoot\VC\Redist\MSVC\*\x64\Microsoft.VC*.CRT" `
    -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
$SearchRoots = @(
    $OutDir,
    (Join-Path $Build 'bin\Release'),
    (Join-Path $Build 'bin'),
    (Join-Path $env:CUDA_PATH 'bin')
) + $VcRuntimeRoots | Where-Object { $_ -and (Test-Path $_) }
$SystemRoots = @(
    (Join-Path $env:SystemRoot 'System32')
) | Where-Object { Test-Path $_ }
$DriverDlls = [System.Collections.Generic.HashSet[string]]::new(
    [string[]]@('nvcuda.dll', 'nvml.dll', 'nvapi64.dll'),
    [System.StringComparer]::OrdinalIgnoreCase
)
$Queue = [System.Collections.Generic.Queue[string]]::new()
$Seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$Queue.Enqueue($OutBin)
while ($Queue.Count -gt 0) {
    $Current = $Queue.Dequeue()
    $Dependencies = & $Dumpbin /DEPENDENTS $Current
    if ($LASTEXITCODE -ne 0) { throw "dumpbin failed for $Current" }
    foreach ($Line in $Dependencies) {
        if ($Line -notmatch '^\s+([A-Za-z0-9_.-]+\.dll)\s*$') { continue }
        $Name = $Matches[1]
        if (-not $Seen.Add($Name)) { continue }
        $Found = $null
        foreach ($Root in $SearchRoots) {
            $Path = Join-Path $Root $Name
            if (Test-Path $Path) { $Found = $Path; break }
        }
        if ($Found) {
            $Destination = Join-Path $OutDir $Name
            if ((Resolve-Path $Found).Path -ne $Destination) {
                Copy-Item -Force $Found $Destination
            }
            $Queue.Enqueue($Destination)
            continue
        }
        $IsSystem = $Name -match '^(api-ms-win-|ext-ms-win-)' -or
            @($SystemRoots | Where-Object { Test-Path (Join-Path $_ $Name) }).Count -gt 0
        if ($IsSystem -or $DriverDlls.Contains($Name)) { continue }
        throw "Unresolved non-system dependency $Name required by $Current"
    }
}

$RuntimeFiles = Get-ChildItem $OutDir -File |
    Where-Object { $_.Extension -eq '.dll' } |
    Sort-Object Name
$Manifest = [ordered]@{
    schema = 2
    engineCommit = (git -C $Src rev-parse HEAD).Trim()
    files = @($RuntimeFiles | ForEach-Object {
        [ordered]@{
            name = $_.Name
            bytes = $_.Length
            sha256 = (Get-FileHash -Algorithm SHA256 $_.FullName).Hash.ToLowerInvariant()
        }
    })
}
$Manifest | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $OutDir 'sdcpp-runtime-manifest.json')
& "$RepoRoot\scripts\verify-sdcpp-runtime.ps1" -Root $OutDir -ExpectedEngineCommit $Manifest.engineCommit

$env:PATH = "$OutDir;$env:PATH"
bash "$RepoRoot/scripts/verify-sdcpp-cli.sh" $OutBin $Manifest.engineCommit
