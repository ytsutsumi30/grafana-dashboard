param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectId,

  [string]$Region = "asia-northeast1",
  [string]$ServiceName = "grafana-dashboard-builder",
  [string]$GrafanaUrl = "https://ytsutsumi30.grafana.net",
  [string]$GrafanaTokenSecret = "grafana-service-account-token",
  [string]$OpenAiKeySecret = "openai-api-key",
  [string]$AiProvider = "vertex",
  [string]$VertexAiLocation = "global",
  [string]$VertexAiModel = "gemini-2.5-flash-lite",
  [string]$AppAccessTokenSecret = "",
  [int]$AppRateLimitWindowMs = 60000,
  [int]$AppRateLimitMaxRequests = 30,
  [switch]$EnableFirestoreHistory,
  [string]$FirestoreDatabase = "(default)",
  [string]$FirestoreHistoryCollection = "dashboard_creation_history",
  [string]$ServiceAccount = "",
  [switch]$SkipOpenAiSecret,
  [switch]$AllowUnauthenticated
)

$ErrorActionPreference = "Stop"

function Require-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is not installed or not on PATH."
  }
}

Require-Command "gcloud"

gcloud config set project $ProjectId | Out-Host

gcloud services enable `
  run.googleapis.com `
  cloudbuild.googleapis.com `
  secretmanager.googleapis.com `
  artifactregistry.googleapis.com `
  aiplatform.googleapis.com `
  --project $ProjectId | Out-Host

$authFlag = if ($AllowUnauthenticated) { "--allow-unauthenticated" } else { "--no-allow-unauthenticated" }
$secretArgs = "GRAFANA_SERVICE_ACCOUNT_TOKEN=$GrafanaTokenSecret`:latest"
if ($AiProvider -eq "openai" -and -not $SkipOpenAiSecret) {
  $secretArgs = "$secretArgs,OPENAI_API_KEY=$OpenAiKeySecret`:latest"
}
if ($AppAccessTokenSecret) {
  $secretArgs = "$secretArgs,APP_ACCESS_TOKEN=$AppAccessTokenSecret`:latest"
}
$firestoreEnabled = if ($EnableFirestoreHistory) { "true" } else { "false" }
$envArgs = "GRAFANA_URL=$GrafanaUrl,AI_PROVIDER=$AiProvider,VERTEX_AI_PROJECT=$ProjectId,VERTEX_AI_LOCATION=$VertexAiLocation,VERTEX_AI_MODEL=$VertexAiModel,APP_RATE_LIMIT_WINDOW_MS=$AppRateLimitWindowMs,APP_RATE_LIMIT_MAX_REQUESTS=$AppRateLimitMaxRequests,FIRESTORE_HISTORY_ENABLED=$firestoreEnabled,FIRESTORE_PROJECT=$ProjectId,FIRESTORE_DATABASE=$FirestoreDatabase,FIRESTORE_HISTORY_COLLECTION=$FirestoreHistoryCollection"
$deployArgs = @(
  "run", "deploy", $ServiceName,
  "--source", ".",
  "--project", $ProjectId,
  "--region", $Region,
  "--set-env-vars", $envArgs,
  "--set-secrets", $secretArgs,
  "--memory", "512Mi",
  "--cpu", "1",
  "--max-instances", "3",
  $authFlag
)
if ($ServiceAccount) {
  $deployArgs += @("--service-account", $ServiceAccount)
}

gcloud @deployArgs
