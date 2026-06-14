param(
    [string]$CodexHome = $env:CODEX_HOME
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repoRoot ".codex\skills\axmem"
if (-not (Test-Path -LiteralPath (Join-Path $source "SKILL.md"))) {
    throw "Codex skill source not found: $source"
}

if (-not $CodexHome) {
    $CodexHome = Join-Path $HOME ".codex"
}

$targetRoot = Join-Path $CodexHome "skills"
$target = Join-Path $targetRoot "axmem"
New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null
if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
}
Copy-Item -LiteralPath $source -Destination $target -Recurse -Force
Write-Output "Installed AXMEM Codex skill to $target"
