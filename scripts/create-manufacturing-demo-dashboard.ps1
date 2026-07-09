param(
  [string]$CloudRunUrl = "https://grafana-dashboard-builder-577010681495.asia-northeast1.run.app",
  [string]$ProjectId = "modern-replica-465803-n8",
  [string]$Industry = "板金加工業者",
  [string]$DashboardType = "manufacturing",
  [string]$FolderUid = "",
  [switch]$Overwrite,
  [string]$AccessToken = ""
)

$ErrorActionPreference = "Stop"

function Get-AppAccessToken {
  param(
    [string]$ExplicitToken,
    [string]$GcpProjectId
  )
  if ($ExplicitToken) {
    return $ExplicitToken
  }
  $envToken = [Environment]::GetEnvironmentVariable("GRAFANA_DASHBOARD_BUILDER_ACCESS_TOKEN", "User")
  if ($envToken) {
    return $envToken
  }
  $processToken = $env:GRAFANA_DASHBOARD_BUILDER_ACCESS_TOKEN
  if ($processToken) {
    return $processToken
  }
  $gcloud = Get-Command gcloud -ErrorAction SilentlyContinue
  if ($gcloud) {
    return (& gcloud secrets versions access latest --secret=grafana-dashboard-builder-access-token --project $GcpProjectId).Trim()
  }
  throw "App access token was not found. Set GRAFANA_DASHBOARD_BUILDER_ACCESS_TOKEN or pass -AccessToken."
}

$base = $CloudRunUrl.TrimEnd("/")
$token = Get-AppAccessToken -ExplicitToken $AccessToken -GcpProjectId $ProjectId
$headers = @{
  "Content-Type" = "application/json"
  "X-App-Access-Token" = $token
}

$proposalBody = @{
  industry = $Industry
  dashboardType = $DashboardType
} | ConvertTo-Json

$proposal = Invoke-RestMethod "$base/api/propose" -Method Post -Headers $headers -Body $proposalBody

$createBody = @{
  industry = $Industry
  dashboardType = $DashboardType
  folderUid = $FolderUid
  overwrite = [bool]$Overwrite
  panels = $proposal.panels
} | ConvertTo-Json -Depth 20

$created = Invoke-RestMethod "$base/api/create-dashboard" -Method Post -Headers $headers -Body $createBody

[pscustomobject]@{
  ok = $created.ok
  name = $created.name
  title = $created.title
  overwritten = $created.overwritten
  panelCount = $proposal.panels.Count
  firstPanels = ($proposal.panels | Select-Object -First 4 -ExpandProperty title) -join ", "
  url = $created.url
} | ConvertTo-Json -Depth 5
