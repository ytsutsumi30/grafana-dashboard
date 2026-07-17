param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectId,

  [string]$Region = "asia-northeast1",
  [string]$ServiceName = "grafana-dashboard-builder",
  [string]$GrafanaUrl = "https://ytsutsumi30.grafana.net",
  [string]$GrafanaTokenSecret = "grafana-service-account-token",
  [string]$OpenAiKeySecret = "openai-api-key",
  [ValidateSet("access-code", "google-oidc", "iap", "none")]
  [string]$AppAuthMode = "access-code",
  [string]$GoogleOidcClientId = "",
  [string]$GoogleOidcAllowedEmails = "", # Use semicolons for multiple values.
  [string]$GoogleOidcAllowedDomains = "", # Use semicolons for multiple values.
  [switch]$EnableIap,
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
  [switch]$AllowUnauthenticated,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Require-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is not installed or not on PATH."
  }
}

Require-Command "gcloud"

if ($AppAuthMode -eq "google-oidc" -and -not $GoogleOidcClientId) {
  throw "GoogleOidcClientId is required when AppAuthMode is google-oidc."
}
if ($EnableIap -and $AppAuthMode -ne "iap") {
  throw "EnableIap requires AppAuthMode iap."
}
if ($AppAuthMode -eq "iap" -and $AllowUnauthenticated) {
  throw "IAP cannot be combined with AllowUnauthenticated."
}

$authFlag = if ($EnableIap) { "--no-allow-unauthenticated" } elseif ($AllowUnauthenticated) { "--allow-unauthenticated" } else { "--no-allow-unauthenticated" }
$secretArgs = "GRAFANA_SERVICE_ACCOUNT_TOKEN=$GrafanaTokenSecret`:latest"
if ($AiProvider -eq "openai" -and -not $SkipOpenAiSecret) {
  $secretArgs = "$secretArgs,OPENAI_API_KEY=$OpenAiKeySecret`:latest"
}
if ($AppAuthMode -eq "access-code" -and $AppAccessTokenSecret) {
  $secretArgs = "$secretArgs,APP_ACCESS_TOKEN=$AppAccessTokenSecret`:latest"
}
$firestoreEnabled = if ($EnableFirestoreHistory) { "true" } else { "false" }
$envArgs = "GRAFANA_URL=$GrafanaUrl,AI_PROVIDER=$AiProvider,VERTEX_AI_PROJECT=$ProjectId,VERTEX_AI_LOCATION=$VertexAiLocation,VERTEX_AI_MODEL=$VertexAiModel,APP_AUTH_MODE=$AppAuthMode,APP_RATE_LIMIT_WINDOW_MS=$AppRateLimitWindowMs,APP_RATE_LIMIT_MAX_REQUESTS=$AppRateLimitMaxRequests,FIRESTORE_HISTORY_ENABLED=$firestoreEnabled,FIRESTORE_PROJECT=$ProjectId,FIRESTORE_DATABASE=$FirestoreDatabase,FIRESTORE_HISTORY_COLLECTION=$FirestoreHistoryCollection"
if ($AppAuthMode -eq "google-oidc") {
  $envArgs = "$envArgs,GOOGLE_OIDC_CLIENT_ID=$GoogleOidcClientId,GOOGLE_OIDC_ALLOWED_EMAILS=$GoogleOidcAllowedEmails,GOOGLE_OIDC_ALLOWED_DOMAINS=$GoogleOidcAllowedDomains"
}
$deployArgs = @(
  "run", "deploy", $ServiceName,
  "--source", ".",
  "--project", $ProjectId,
  "--region", $Region,
  "--set-env-vars", $envArgs,
  "--update-secrets", $secretArgs,
  "--memory", "512Mi",
  "--cpu", "1",
  "--max-instances", "3",
  $authFlag
)
if ($AppAuthMode -ne "access-code") {
  $deployArgs += @("--remove-secrets", "APP_ACCESS_TOKEN")
}
if ($EnableIap) {
  $deployArgs += "--iap"
}
if ($ServiceAccount) {
  $deployArgs += @("--service-account", $ServiceAccount)
}

if ($DryRun) {
  Write-Output "Dry run only. No GCP resources were changed."
  Write-Output ("gcloud " + ($deployArgs -join " "))
  exit 0
}

gcloud config set project $ProjectId | Out-Host

gcloud services enable `
  run.googleapis.com `
  cloudbuild.googleapis.com `
  secretmanager.googleapis.com `
  artifactregistry.googleapis.com `
  aiplatform.googleapis.com `
  --project $ProjectId | Out-Host

gcloud @deployArgs
