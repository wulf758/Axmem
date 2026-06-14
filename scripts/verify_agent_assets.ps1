$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$required = @(
    ".codex\skills\axmem\SKILL.md",
    "CLAUDE.md",
    ".claude\commands\axmem-recall.md",
    ".claude\commands\axmem-handoff.md",
    ".claude\commands\axmem-ingest.md"
)
foreach ($relative in $required) {
    $path = Join-Path $repoRoot $relative
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Missing agent asset: $relative"
    }
}
Write-Output "AXMEM agent assets are present."
