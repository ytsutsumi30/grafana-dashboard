param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectId,

  [string]$Region = "asia-northeast1",
  [string]$ServiceName = "grafana-dashboard-builder",
  [ValidateSet("admin", "public")]
  [string]$ServiceRole = "admin",
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
  [int]$OutboundApiTimeoutMs = 15000,
  [int]$GrafanaApiTimeoutMs = 15000,
  [int]$AiApiTimeoutMs = 45000,
  [switch]$EnableFirestoreHistory,
  [string]$FirestoreDatabase = "(default)",
  [string]$FirestoreHistoryCollection = "dashboard_creation_history",
  [string]$FirestoreIdempotencyCollection = "api_idempotency",
  [switch]$EnableFirestoreSensorData,
  [string]$FirestoreSensorCollection = "mobile_sensor_points",
  [string]$FirestoreSensorLatestCollection = "mobile_sensor_latest",
  [ValidateRange(1, 365)]
  [int]$FirestoreSensorRetentionDays = 7,
  [string]$ArtifactRepository = "grafana-apps",
  [string]$ReleaseId = "",
  [string]$ExpectedImageDigest = "",
  [string]$ServiceAccount = "",
  [switch]$SkipOpenAiSecret,
  [switch]$AllowUnauthenticated,
  [switch]$InitialCreate,
  [switch]$Promote,
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
if (($AppAuthMode -eq "google-oidc" -or $AppAuthMode -eq "iap") -and
    -not $GoogleOidcAllowedEmails -and -not $GoogleOidcAllowedDomains) {
  throw "GoogleOidcAllowedEmails or GoogleOidcAllowedDomains is required for google-oidc and iap modes."
}
if ($AppAuthMode -eq "access-code" -and -not $AppAccessTokenSecret) {
  throw "AppAccessTokenSecret is required when AppAuthMode is access-code."
}
if ($AppAuthMode -eq "none") {
  throw "AppAuthMode none is blocked for Cloud Run deployments."
}
if ($EnableIap -and $AppAuthMode -ne "iap") {
  throw "EnableIap requires AppAuthMode iap."
}
if ($AppAuthMode -eq "iap" -and $AllowUnauthenticated) {
  throw "IAP cannot be combined with AllowUnauthenticated."
}
if ($ServiceRole -eq "public" -and $AppAuthMode -ne "google-oidc") {
  throw "The public API service requires AppAuthMode google-oidc for Android sensor writes."
}
if ($ServiceRole -eq "public" -and (-not $AllowUnauthenticated -or $EnableIap)) {
  throw "The public API service must use AllowUnauthenticated transport access so Grafana can read monitoring endpoints."
}
if ($ServiceRole -eq "public" -and -not $EnableFirestoreSensorData) {
  throw "EnableFirestoreSensorData is required for the public API service."
}
if (-not $ServiceAccount) {
  throw "ServiceAccount is required so admin and public services cannot share the default identity."
}
$expectedServiceAccount = if ($ServiceRole -eq "public") {
  "grafana-sensor-api-run@$ProjectId.iam.gserviceaccount.com"
} else {
  "grafana-dashboard-builder-run@$ProjectId.iam.gserviceaccount.com"
}
if ($ServiceAccount -ne $expectedServiceAccount) {
  throw "ServiceRole $ServiceRole requires dedicated service account $expectedServiceAccount."
}
if (($ServiceRole -eq "public" -and $ServiceName -eq "grafana-dashboard-builder") -or
    ($ServiceRole -eq "admin" -and $ServiceName -eq "grafana-sensor-api")) {
  throw "ServiceName $ServiceName is reserved for the other service role."
}

if (-not $ReleaseId) {
  $gitSha = "nogit"
  if (Get-Command "git" -ErrorAction SilentlyContinue) {
    $candidateSha = (& git rev-parse --short=8 HEAD 2>$null)
    if ($LASTEXITCODE -eq 0 -and $candidateSha) { $gitSha = $candidateSha.Trim() }
  }
  $ReleaseId = "r$((Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss'))-$gitSha"
}
$maxRevisionSuffixLength = [Math]::Min(36, 62 - $ServiceName.Length)
$maxTrafficTagSuffixLength = 46 - $ServiceName.Length - 2 # c-<release-id>
$maxSuffixLength = [Math]::Min($maxRevisionSuffixLength, $maxTrafficTagSuffixLength)
if ($maxSuffixLength -lt 1) {
  throw "ReleaseId and ServiceName cannot produce a valid Cloud Run revision name."
}
$releaseSuffix = $ReleaseId
if ($releaseSuffix.Length -gt $maxSuffixLength -or $releaseSuffix -cnotmatch "^[a-z][a-z0-9-]*[a-z0-9]$") {
  throw "ReleaseId must already be lowercase, use only letters, digits, and hyphens, start with a letter, end with a letter or digit, and be at most $maxSuffixLength characters."
}
if ($Promote -and $ExpectedImageDigest -notmatch "^sha256:[a-f0-9]{64}$") {
  throw "ExpectedImageDigest in sha256:<64 lowercase hex characters> format is required with -Promote."
}
if ($InitialCreate -and $Promote) {
  throw "InitialCreate cannot be combined with Promote because the first Cloud Run revision receives traffic immediately."
}

$imageBase = "$Region-docker.pkg.dev/$ProjectId/$ArtifactRepository/$ServiceName"
$imageTag = "$imageBase`:$releaseSuffix"
$revisionName = "$ServiceName-$releaseSuffix"
$candidateTag = "c-$releaseSuffix"

$authFlag = if ($EnableIap) { "--no-allow-unauthenticated" } elseif ($AllowUnauthenticated) { "--allow-unauthenticated" } else { "--no-allow-unauthenticated" }
$secretParts = @()
if ($ServiceRole -eq "admin") {
  $secretParts += "GRAFANA_SERVICE_ACCOUNT_TOKEN=$GrafanaTokenSecret`:latest"
}
if ($ServiceRole -eq "admin" -and $AiProvider -eq "openai" -and -not $SkipOpenAiSecret) {
  $secretParts += "OPENAI_API_KEY=$OpenAiKeySecret`:latest"
}
if ($AppAuthMode -eq "access-code" -and $AppAccessTokenSecret) {
  $secretParts += "APP_ACCESS_TOKEN=$AppAccessTokenSecret`:latest"
}
$firestoreEnabled = if ($EnableFirestoreHistory) { "true" } else { "false" }
$firestoreSensorEnabled = if ($EnableFirestoreSensorData) { "true" } else { "false" }
$envArgs = "SERVICE_ROLE=$ServiceRole,GRAFANA_URL=$GrafanaUrl,AI_PROVIDER=$AiProvider,VERTEX_AI_PROJECT=$ProjectId,VERTEX_AI_LOCATION=$VertexAiLocation,VERTEX_AI_MODEL=$VertexAiModel,APP_AUTH_MODE=$AppAuthMode,APP_RATE_LIMIT_WINDOW_MS=$AppRateLimitWindowMs,APP_RATE_LIMIT_MAX_REQUESTS=$AppRateLimitMaxRequests,OUTBOUND_API_TIMEOUT_MS=$OutboundApiTimeoutMs,GRAFANA_API_TIMEOUT_MS=$GrafanaApiTimeoutMs,AI_API_TIMEOUT_MS=$AiApiTimeoutMs,FIRESTORE_HISTORY_ENABLED=$firestoreEnabled,FIRESTORE_PROJECT=$ProjectId,FIRESTORE_DATABASE=$FirestoreDatabase,FIRESTORE_HISTORY_COLLECTION=$FirestoreHistoryCollection,FIRESTORE_IDEMPOTENCY_COLLECTION=$FirestoreIdempotencyCollection,FIRESTORE_SENSOR_ENABLED=$firestoreSensorEnabled,FIRESTORE_SENSOR_COLLECTION=$FirestoreSensorCollection,FIRESTORE_SENSOR_LATEST_COLLECTION=$FirestoreSensorLatestCollection,FIRESTORE_SENSOR_RETENTION_DAYS=$FirestoreSensorRetentionDays"
if ($AppAuthMode -eq "google-oidc") {
  $envArgs = "$envArgs,GOOGLE_OIDC_CLIENT_ID=$GoogleOidcClientId"
}
if ($AppAuthMode -eq "google-oidc" -or $AppAuthMode -eq "iap") {
  $envArgs = "$envArgs,GOOGLE_OIDC_ALLOWED_EMAILS=$GoogleOidcAllowedEmails,GOOGLE_OIDC_ALLOWED_DOMAINS=$GoogleOidcAllowedDomains"
}
$deployArgs = @(
  "run", "deploy", $ServiceName,
  "--image", "__IMAGE_DIGEST_REFERENCE__",
  "--project", $ProjectId,
  "--region", $Region,
  "--revision-suffix", $releaseSuffix,
  "--tag", $candidateTag,
  "--set-env-vars", $envArgs,
  "--memory", "512Mi",
  "--cpu", "1",
  "--max-instances", "3",
  $authFlag
)
if (-not $InitialCreate) {
  $deployArgs += "--no-traffic"
}
if ($secretParts.Count -gt 0) {
  $deployArgs += @("--update-secrets", ($secretParts -join ","))
}
if ($ServiceRole -eq "public") {
  $deployArgs += @("--remove-secrets", "GRAFANA_SERVICE_ACCOUNT_TOKEN,OPENAI_API_KEY,APP_ACCESS_TOKEN")
} elseif ($AppAuthMode -ne "access-code") {
  $deployArgs += @("--remove-secrets", "APP_ACCESS_TOKEN")
}
if ($EnableIap) {
  $deployArgs += "--iap"
}
if ($ServiceAccount) {
  $deployArgs += @("--service-account", $ServiceAccount)
}

function Get-VerifiedCandidateRevision([string]$ExpectedDigest = "") {
  $revisionJson = gcloud run revisions describe $revisionName `
    --project $ProjectId `
    --region $Region `
    --format=json
  if ($LASTEXITCODE -ne 0) { throw "Could not describe Cloud Run revision $revisionName." }
  $revision = $revisionJson | ConvertFrom-Json
  $ready = $revision.status.conditions | Where-Object { $_.type -eq "Ready" -and $_.status -eq "True" }
  $deployedImage = [string]$revision.spec.containers[0].image
  if (-not $ready) { throw "Cloud Run revision $revisionName is not Ready." }
  if ($deployedImage -notmatch "@sha256:[a-f0-9]{64}$") {
    throw "Cloud Run revision $revisionName is not pinned to an immutable image digest."
  }
  if ($ExpectedDigest -and -not $deployedImage.EndsWith("@$ExpectedDigest")) {
    throw "Cloud Run revision image does not match the resolved digest. Expected $ExpectedDigest."
  }

  $serviceJson = gcloud run services describe $ServiceName `
    --project $ProjectId `
    --region $Region `
    --format=json
  if ($LASTEXITCODE -ne 0) { throw "Could not describe Cloud Run service $ServiceName." }
  $service = $serviceJson | ConvertFrom-Json
  $candidateTraffic = $service.status.traffic | Where-Object { $_.tag -eq $candidateTag } | Select-Object -First 1
  if (-not $candidateTraffic -or [string]$candidateTraffic.revisionName -ne $revisionName) {
    throw "Candidate tag $candidateTag is not bound to revision $revisionName."
  }
  $candidateUrl = [string]$candidateTraffic.url
  if (-not $candidateUrl) { throw "Could not resolve the candidate URL for tag $candidateTag." }
  return [PSCustomObject]@{ Image = $deployedImage; Url = $candidateUrl }
}

function Test-CandidateEndpoint([string]$CandidateUrl) {
  if ($EnableIap) {
    Write-Output "IAP candidate HTTP verification requires an authorized browser session; revision readiness and digest were verified."
  } elseif ($AllowUnauthenticated) {
    Invoke-RestMethod "$CandidateUrl/api/ping" -TimeoutSec 30 | Out-Null
  } else {
    $identityToken = [string](& gcloud auth print-identity-token --audiences=$CandidateUrl)
    if ($LASTEXITCODE -ne 0 -or -not $identityToken.Trim()) {
      throw "Could not obtain an identity token for candidate health verification."
    }
    Invoke-RestMethod "$CandidateUrl/api/ping" `
      -Headers @{ Authorization = "Bearer $($identityToken.Trim())" } `
      -TimeoutSec 30 | Out-Null
  }
}

function Assert-PublicServiceAccountLeastPrivilege {
  if ($ServiceRole -ne "public") { return }
  $member = "serviceAccount:$ServiceAccount"
  $forbiddenRoles = @(
    "roles/owner",
    "roles/editor",
    "roles/secretmanager.admin",
    "roles/secretmanager.secretAccessor",
    "roles/aiplatform.admin",
    "roles/aiplatform.user"
  )
  $projectPolicyJson = gcloud projects get-iam-policy $ProjectId --format=json
  if ($LASTEXITCODE -ne 0) { throw "Could not inspect project IAM policy for the public service account." }
  $projectPolicy = $projectPolicyJson | ConvertFrom-Json
  foreach ($binding in $projectPolicy.bindings) {
    if ($forbiddenRoles -contains $binding.role -and $binding.members -contains $member) {
      throw "Public service account has forbidden project role $($binding.role)."
    }
  }
  foreach ($secret in @($GrafanaTokenSecret, $OpenAiKeySecret)) {
    $secretPolicyJson = gcloud secrets get-iam-policy $secret --project $ProjectId --format=json 2>$null
    if ($LASTEXITCODE -ne 0) {
      throw "Could not inspect IAM policy for secret $secret; public least privilege was not proven."
    }
    $secretPolicy = $secretPolicyJson | ConvertFrom-Json
    foreach ($binding in $secretPolicy.bindings) {
      if ($binding.members -contains $member) {
        throw "Public service account must not have access to secret $secret."
      }
    }
  }
}

if ($DryRun) {
  Write-Output "Dry run only. No GCP resources were changed."
  Write-Output "Release ID: $releaseSuffix"
  if ($Promote) {
    Write-Output "gcloud run revisions describe $revisionName --project $ProjectId --region $Region --format=json"
    Write-Output "Verify existing revision Ready=True, image digest $ExpectedImageDigest, candidate tag binding, and /api/ping before traffic change."
    Write-Output "gcloud run services update-traffic $ServiceName --to-revisions $revisionName=100 --project $ProjectId --region $Region"
  } else {
    Write-Output "gcloud artifacts repositories describe $ArtifactRepository --location $Region --project $ProjectId"
    Write-Output "gcloud artifacts repositories create $ArtifactRepository --repository-format docker --location $Region --project $ProjectId"
    Write-Output "gcloud builds submit . --tag $imageTag --project $ProjectId"
    Write-Output "gcloud artifacts docker images describe $imageTag --project $ProjectId --format=value(image_summary.digest)"
    $dryDeployArgs = $deployArgs | ForEach-Object { if ($_ -eq "__IMAGE_DIGEST_REFERENCE__") { "$imageBase@sha256:<resolved-digest>" } else { $_ } }
    Write-Output ("gcloud " + ($dryDeployArgs -join " "))
    Write-Output "Verify revision Ready=True and deployed image digest before any traffic change: $revisionName"
    if ($InitialCreate) {
      Write-Output "Initial service creation receives production traffic immediately; verify every route and remove invoker access if verification fails."
    } else {
      Write-Output "Promotion skipped. Re-run with -Promote only after candidate verification."
    }
  }
  exit 0
}

gcloud config set project $ProjectId | Out-Host

Assert-PublicServiceAccountLeastPrivilege

if (-not $Promote) {
  & gcloud run services describe $ServiceName --project $ProjectId --region $Region *> $null
  $serviceExists = $LASTEXITCODE -eq 0
  if ($InitialCreate -and $serviceExists) {
    throw "InitialCreate is only valid when Cloud Run service $ServiceName does not exist."
  }
  if (-not $InitialCreate -and -not $serviceExists) {
    throw "Cloud Run service $ServiceName does not exist. Re-run with -InitialCreate after reviewing that the first revision receives traffic immediately."
  }
}

if ($Promote) {
  $candidate = Get-VerifiedCandidateRevision $ExpectedImageDigest
  Test-CandidateEndpoint $candidate.Url
  gcloud run services update-traffic $ServiceName `
    --to-revisions "$revisionName=100" `
    --project $ProjectId `
    --region $Region | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Traffic promotion failed for $revisionName." }
  Write-Output "Promoted verified revision to 100% traffic: $revisionName"
  Write-Output "Image: $($candidate.Image)"
  exit 0
}

gcloud services enable `
  run.googleapis.com `
  cloudbuild.googleapis.com `
  secretmanager.googleapis.com `
  artifactregistry.googleapis.com `
  aiplatform.googleapis.com `
  --project $ProjectId | Out-Host

& gcloud artifacts repositories describe $ArtifactRepository `
  --location $Region `
  --project $ProjectId *> $null
if ($LASTEXITCODE -ne 0) {
  gcloud artifacts repositories create $ArtifactRepository `
    --repository-format docker `
    --location $Region `
    --description "Immutable Grafana application releases" `
    --project $ProjectId | Out-Host
}

gcloud builds submit . `
  --tag $imageTag `
  --project $ProjectId | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Cloud Build failed for $imageTag." }

$imageDigest = [string](& gcloud artifacts docker images describe $imageTag `
  --project $ProjectId `
  --format="value(image_summary.digest)")
$imageDigest = $imageDigest.Trim()
if ($LASTEXITCODE -ne 0 -or $imageDigest -notmatch "^sha256:[a-f0-9]{64}$") {
  throw "Could not resolve an immutable image digest for $imageTag."
}
$imageReference = "$imageBase@$imageDigest"
$deployArgs = $deployArgs | ForEach-Object { if ($_ -eq "__IMAGE_DIGEST_REFERENCE__") { $imageReference } else { $_ } }

gcloud @deployArgs | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Cloud Run candidate deployment failed for $revisionName." }

$candidate = Get-VerifiedCandidateRevision $imageDigest
Test-CandidateEndpoint $candidate.Url
Write-Output "Candidate revision verified: $revisionName"
Write-Output "Image: $($candidate.Image)"
Write-Output "Candidate URL: $($candidate.Url)"
if ($InitialCreate) {
  Write-Output "Initial service revision is live because Cloud Run cannot create a service with zero traffic. Verify route boundaries immediately."
} else {
  Write-Output "No production traffic was changed. Re-run with -Promote, ReleaseId $releaseSuffix, and ExpectedImageDigest $imageDigest after reviewing the candidate URL."
}
