param(
    [Parameter(Mandatory = $true)]
    [string]$Root,
    [string]$ExpectedEngineCommit = '',
    [switch]$AllowAdditionalDlls
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path $Root).Path
$ManifestPath = Join-Path $Root 'sdcpp-runtime-manifest.json'
if (-not (Test-Path $ManifestPath -PathType Leaf)) {
    throw "Runtime manifest not found: $ManifestPath"
}

$Manifest = Get-Content -Raw $ManifestPath | ConvertFrom-Json
if ($Manifest.schema -ne 2 -or $Manifest.engineCommit -notmatch '^[0-9a-f]{40}$') {
    throw "Invalid runtime manifest header: $ManifestPath"
}
if ($ExpectedEngineCommit -and $Manifest.engineCommit -ne $ExpectedEngineCommit) {
    throw "Runtime manifest engine commit does not match $ExpectedEngineCommit"
}

$Expected = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($Entry in @($Manifest.files)) {
    if ($Entry.name -notmatch '^[A-Za-z0-9_.-]+\.dll$' -or
        $Entry.sha256 -notmatch '^[0-9a-f]{64}$' -or
        [uint64]$Entry.bytes -eq 0 -or
        -not $Expected.Add([string]$Entry.name)) {
        throw "Invalid or duplicate runtime manifest entry: $($Entry.name)"
    }
    $Path = Join-Path $Root $Entry.name
    if (-not (Test-Path $Path -PathType Leaf)) { throw "Missing runtime file: $Path" }
    $File = Get-Item $Path
    if ([uint64]$File.Length -ne [uint64]$Entry.bytes) { throw "Size mismatch: $Path" }
    $Hash = (Get-FileHash -Algorithm SHA256 $Path).Hash.ToLowerInvariant()
    if ($Hash -ne $Entry.sha256) { throw "SHA-256 mismatch: $Path" }
}
if ($Expected.Count -eq 0) { throw 'Runtime manifest contains no CUDA DLLs' }

if (-not $AllowAdditionalDlls) {
    $Actual = @(Get-ChildItem $Root -File -Filter '*.dll' | Select-Object -ExpandProperty Name)
    foreach ($Name in $Actual) {
        if (-not $Expected.Contains($Name)) { throw "Unmanifested runtime DLL: $Name" }
    }
    if ($Actual.Count -ne $Expected.Count) { throw 'Runtime DLL set does not match the manifest' }
}

Write-Host "verified $($Expected.Count) runtime DLLs in $Root"
