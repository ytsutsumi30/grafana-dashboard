param(
  [string]$NotebookId = "",
  [string]$Title = "Grafana Dashboard Builder PoC",
  [string]$NotebookLmExe = "",
  [switch]$DryRun,
  [string]$ManifestPath = ""
)

$ErrorActionPreference = "Stop"

function Resolve-NotebookLm {
  param([string]$Requested)
  if ($Requested -and (Test-Path $Requested)) {
    return (Resolve-Path $Requested).Path
  }
  $cmd = Get-Command notebooklm -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }
  $known = "C:\Users\tsuts\notebooklm-podcast-lab\.venv\Scripts\notebooklm.exe"
  if (Test-Path $known) {
    return $known
  }
  throw "notebooklm CLI was not found. Install notebooklm-py or pass -NotebookLmExe."
}

function Invoke-NotebookLmJson {
  param(
    [string]$Exe,
    [string[]]$Arguments
  )
  $raw = & $Exe @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "notebooklm command failed: $($Arguments -join ' ')"
  }
  return $raw | ConvertFrom-Json
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$sources = @(
  "README.md",
  "docs\notebooklm-source-index.md",
  "docs\notebooklm-source-manifest.json",
  "docs\notebooklm-mcp-integration.md",
  "docs\manufacturing-dashboard-build-log.md",
  "docs\manufacturing-demo-runbook.md",
  "docs\manufacturing-datasource-mapping.md",
  "docs\dashboard-builder-specification.md",
  "docs\sales-user-guide.md",
  "docs\android-vibration-demo-mvp.md",
  "docs\shipping-inspection-api-contract.md",
  "docs\shipping-inspection-demo-guide.md",
  "docs\skill-application-plan.md",
  "scripts\create-manufacturing-demo-dashboard.ps1",
  "scripts\verify-manufacturing-demo-dashboard.ps1",
  "scripts\setup-notebooklm-mcp-auth.js",
  "scripts\sync-notebooklm-mcp-sources.js"
)

$manifest = [pscustomobject]@{
  title = $Title
  notebookId = $NotebookId
  dryRun = [bool]$DryRun
  sourceCount = $sources.Count
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  sources = @(
    foreach ($relativePath in $sources) {
      $path = Join-Path $repoRoot $relativePath
      $item = Get-Item -LiteralPath $path -ErrorAction SilentlyContinue
      [pscustomobject]@{
        relativePath = $relativePath
        exists = [bool]$item
        sizeBytes = if ($item) { $item.Length } else { 0 }
      }
    }
  )
}

if ($ManifestPath) {
  $manifestFile = $ManifestPath
  if (-not [System.IO.Path]::IsPathRooted($manifestFile)) {
    $manifestFile = Join-Path $repoRoot $manifestFile
  }
  $manifest | ConvertTo-Json -Depth 5 | Set-Content -Path $manifestFile -Encoding UTF8
}

if ($DryRun) {
  $manifest | ConvertTo-Json -Depth 5
  exit 0
}

$notebooklm = Resolve-NotebookLm -Requested $NotebookLmExe

$auth = & $notebooklm auth check --test --json | ConvertFrom-Json
if ($auth.status -ne "ok") {
  throw "NotebookLM authentication is not valid. Run: notebooklm login"
}

if (-not $NotebookId) {
  $created = Invoke-NotebookLmJson -Exe $notebooklm -Arguments @("create", $Title, "--json")
  $NotebookId = $created.notebook.id
  if (-not $NotebookId) {
    $NotebookId = $created.id
  }
  if (-not $NotebookId) {
    throw "Notebook was created but no notebook ID was returned."
  }
}

foreach ($relativePath in $sources) {
  $path = Join-Path $repoRoot $relativePath
  if (Test-Path $path) {
    Write-Host "Adding source: $relativePath"
    & $notebooklm source add $path -n $NotebookId --json | Out-Null
  } else {
    Write-Warning "Missing source: $relativePath"
  }
}

Write-Host "NotebookLM sync completed."
Write-Host "Notebook ID: $NotebookId"
