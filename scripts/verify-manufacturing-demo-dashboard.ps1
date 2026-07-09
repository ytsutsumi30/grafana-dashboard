param(
  [string]$GrafanaUrl = "https://ytsutsumi30.grafana.net",
  [string]$ProjectId = "modern-replica-465803-n8",
  [string]$DashboardUid = "sheet-metal-maintenance-demo",
  [int]$ExpectedMinPanels = 19,
  [string[]]$ExpectedLeadingPanels = @(
    "Overall Equipment Effectiveness",
    "Availability / Uptime",
    "Unplanned Downtime",
    "Active Alarm Count"
  ),
  [string[]]$ExpectedPanels = @(
    "Maintenance Action Queue",
    "Production Loss Breakdown",
    "Shift Production Summary",
    "Quality Defect Trend",
    "Top Defect Reasons",
    "MTBF / MTTR Trend",
    "Alert Rule Candidates"
  ),
  [string]$GrafanaToken = ""
)

$ErrorActionPreference = "Stop"

function Get-GrafanaToken {
  param(
    [string]$ExplicitToken,
    [string]$GcpProjectId
  )
  if ($ExplicitToken) {
    return $ExplicitToken
  }
  $envToken = [Environment]::GetEnvironmentVariable("GRAFANA_SERVICE_ACCOUNT_TOKEN", "User")
  if ($envToken) {
    return $envToken
  }
  if ($env:GRAFANA_SERVICE_ACCOUNT_TOKEN) {
    return $env:GRAFANA_SERVICE_ACCOUNT_TOKEN
  }
  $gcloud = Get-Command gcloud -ErrorAction SilentlyContinue
  if ($gcloud) {
    return (& gcloud secrets versions access latest --secret=grafana-service-account-token --project $GcpProjectId).Trim()
  }
  throw "Grafana token was not found. Set GRAFANA_SERVICE_ACCOUNT_TOKEN or pass -GrafanaToken."
}

$base = $GrafanaUrl.TrimEnd("/")
$token = Get-GrafanaToken -ExplicitToken $GrafanaToken -GcpProjectId $ProjectId
$headers = @{ Authorization = "Bearer $token" }
$response = Invoke-RestMethod "$base/api/dashboards/uid/$DashboardUid" -Headers $headers
$dashboard = $response.dashboard
$panels = @($dashboard.panels)
$orderedPanels = @($panels | Sort-Object { $_.gridPos.y }, { $_.gridPos.x })
$leadingTitles = @($orderedPanels | Select-Object -First $ExpectedLeadingPanels.Count -ExpandProperty title)

$errors = @()
if ($dashboard.uid -ne $DashboardUid) {
  $errors += "Dashboard UID mismatch. expected=$DashboardUid actual=$($dashboard.uid)"
}
if ($panels.Count -lt $ExpectedMinPanels) {
  $errors += "Panel count is too small. expectedMin=$ExpectedMinPanels actual=$($panels.Count)"
}
for ($i = 0; $i -lt $ExpectedLeadingPanels.Count; $i += 1) {
  if ($leadingTitles[$i] -ne $ExpectedLeadingPanels[$i]) {
    $errors += "Leading panel $($i + 1) mismatch. expected=$($ExpectedLeadingPanels[$i]) actual=$($leadingTitles[$i])"
  }
}
foreach ($expectedPanel in $ExpectedPanels) {
  if (-not ($panels | Where-Object { $_.title -eq $expectedPanel })) {
    $errors += "Expected panel was not found: $expectedPanel"
  }
}

$result = [pscustomobject]@{
  ok = $errors.Count -eq 0
  uid = $dashboard.uid
  title = $dashboard.title
  panelCount = $panels.Count
  leadingPanels = $leadingTitles -join ", "
  expectedPanelsFound = ($ExpectedPanels | ForEach-Object { $name = $_; [pscustomobject]@{ title = $name; found = [bool]($panels | Where-Object { $_.title -eq $name }) } })
  grafanaUrl = "$base$($response.meta.url)"
  errors = $errors
}

$result | ConvertTo-Json -Depth 5

if ($errors.Count -gt 0) {
  exit 1
}
