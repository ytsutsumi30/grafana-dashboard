# Google OIDC Authentication Runbook

## Purpose

Replace the temporary access-code input with Google OpenID Connect (OIDC) while preserving Grafana dashboard refresh and Android vibration-demo operation. The Grafana service-account token stays only in Google Secret Manager.

## Production Design

Use two Cloud Run services. The admin service hosts the signed-in sales UI and privileged Grafana/AI operations. The public service is transport-public because Grafana Infinity needs anonymous reads, while application OIDC protects Android sensor writes.

| Service / route category | OIDC mode behavior |
| --- | --- |
| admin: proposal, create/update, folders, data sources, history, logs, AI, demo/reset | Google ID token required |
| public: `POST /api/mobile-sensor` | Google ID token required |
| public: sensor history/latest/metrics and Grafana monitoring `GET` | Anonymous read-only access |
| public: `GET /api/ai/*` without model execution | Anonymous rule-based result |
| both: `GET /api/ping` | Public liveness only |

Do not apply Cloud Run IAP to the public service because it would stop Grafana anonymous reads. The public service account receives Firestore access only and must not receive Grafana/OpenAI secrets. The admin service account owns privileged integrations.

## Configured OAuth Clients

- External Google Auth Platform branding is configured for project `modern-replica-465803-n8`.
- Web client: `grafana-dashboard-builder-web`; both Cloud Run URLs are registered as authorized JavaScript origins.
- Android debug client: `android-vibration-demo-debug`; package `com.example.androidvibrationdemo` with the debug signing SHA-1 is registered.
- The Android app requests ID tokens using the Web client ID. It stores neither an ID token nor an OAuth client secret.

The web client ID is public application configuration. Do not expose an OAuth client secret, Grafana token, application access code, or Google ID token.

## Deploy Google OIDC

Run from the repository root:

```powershell
.\scripts\deploy-cloud-run.ps1 `
  -ProjectId modern-replica-465803-n8 `
  -Region asia-northeast1 `
  -ServiceName grafana-dashboard-builder `
  -ServiceRole admin `
  -AppAuthMode google-oidc `
  -GoogleOidcClientId '<configured web client ID>' `
  -GoogleOidcAllowedEmails 'y.tsutsumi30@gmail.com' `
  -GrafanaUrl https://ytsutsumi30.grafana.net `
  -AiProvider vertex `
  -VertexAiLocation global `
  -VertexAiModel gemini-2.5-flash-lite `
  -EnableFirestoreHistory `
  -EnableFirestoreSensorData `
  -ServiceAccount grafana-dashboard-builder-run@modern-replica-465803-n8.iam.gserviceaccount.com `
  -SkipOpenAiSecret `
  -AllowUnauthenticated
```

Deploy the public sensor/monitoring candidate separately:

```powershell
.\scripts\deploy-cloud-run.ps1 `
  -ProjectId modern-replica-465803-n8 `
  -Region asia-northeast1 `
  -ServiceName grafana-sensor-api `
  -ServiceRole public `
  -InitialCreate `
  -AppAuthMode google-oidc `
  -GoogleOidcClientId '<configured web client ID>' `
  -GoogleOidcAllowedEmails 'y.tsutsumi30@gmail.com' `
  -EnableFirestoreSensorData `
  -ServiceAccount grafana-sensor-api-run@modern-replica-465803-n8.iam.gserviceaccount.com `
  -SkipOpenAiSecret `
  -AllowUnauthenticated
```

The deployment script removes the legacy `APP_ACCESS_TOKEN` binding in OIDC mode and preserves `grafana-service-account-token`. It builds an immutable image and prints the candidate URL, Release ID, and image digest. Existing services receive a tagged candidate revision with no production traffic; complete the verification below, then rerun with the same arguments plus the printed `-ReleaseId`, `-ExpectedImageDigest`, and `-Promote`.

The first `grafana-sensor-api` deployment requires `-InitialCreate`. Cloud Run cannot create a service with zero traffic, so its first revision becomes live immediately. The script rejects this switch when the service already exists. Verify route boundaries, authentication, Firestore persistence, and secret isolation immediately. If verification fails, remove public invoker access or delete the new service and keep Android and Grafana endpoints on the previous combined service.

The service fails closed at startup. A Cloud Run revision will not become ready when authentication is `none`, the OIDC client ID is missing, or both email/domain allowlists are empty. IAP mode uses the same allowlist for the authenticated-user email header. Access-code mode requires an explicit Secret Manager binding.

## Verification

1. Open the admin Cloud Run URL in a clean browser profile.
2. Confirm that the access-code field is absent and Google sign-in is available.
3. Sign in with the allowlisted Google account and confirm the authenticated email is shown.
4. Load folders, generate a proposal, and create a disposable dashboard.
5. Verify admin `GET /api/mobile-sensor/history` returns `404 ROUTE_NOT_AVAILABLE`.
6. Verify public anonymous `GET /api/mobile-sensor/history?limit=5` returns `200`.
7. Verify public anonymous `POST /api/mobile-sensor` returns `401 OIDC_AUTH_REQUIRED`.
8. Install the Android debug APK, sign in, and confirm a sensor POST succeeds.
9. Verify public `/` and `/api/folders` return 404 and that its runtime has no Grafana/OpenAI secrets.

## Rollback

If browser or Android sign-in fails after promotion, restore the previously verified immutable revision for each affected service. Do not change the public service to access-code mode because the Android app does not send that credential.

```powershell
gcloud run revisions list --project modern-replica-465803-n8 --region asia-northeast1 --service grafana-dashboard-builder
gcloud run revisions list --project modern-replica-465803-n8 --region asia-northeast1 --service grafana-sensor-api

gcloud run services update-traffic grafana-dashboard-builder `
  --project modern-replica-465803-n8 `
  --region asia-northeast1 `
  --to-revisions '<previous-admin-revision>=100'

gcloud run services update-traffic grafana-sensor-api `
  --project modern-replica-465803-n8 `
  --region asia-northeast1 `
  --to-revisions '<previous-public-revision>=100'
```

Record both previous revision names and image digests before promotion. Roll back only the affected service, verify `/api/ping`, then repeat the route and Android checks. Traffic rollback is an explicit human approval action.

## References

- [Cloud Run end-user authentication](https://cloud.google.com/run/docs/authenticating/end-users)
- [Google Identity Services](https://developers.google.com/identity/gsi/web)
