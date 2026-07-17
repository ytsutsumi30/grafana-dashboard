# Google OIDC Authentication Runbook

## Purpose

Replace the temporary access-code input with Google OpenID Connect (OIDC) while preserving Grafana dashboard refresh and Android vibration-demo operation. The Grafana service-account token stays only in Google Secret Manager.

## Production Design

Cloud Run remains transport-public because Grafana Infinity and dashboard viewers read monitoring data without an interactive Google login. Application authentication protects user and device actions.

| Route category | OIDC mode behavior |
| --- | --- |
| Dashboard proposal, create/update, folders, data sources, history, logs and AI execution | Google ID token required |
| `POST /api/mobile-sensor` and demo/reset actions | Google ID token required |
| Sensor history/latest/metrics and Grafana monitoring `GET` endpoints | Anonymous read-only access for Grafana refresh |
| `GET /api/ai/*` without `ai=true` | Anonymous rule-based monitoring result |
| `GET /api/ping`, `GET /api/auth-status` | Public health/auth state |

Do not use direct Cloud Run IAP for this service: IAP protects every route and would stop anonymous Grafana reads unless ingestion and dashboard-query APIs are moved to a separate service.

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
  -AppAuthMode google-oidc `
  -GoogleOidcClientId '<configured web client ID>' `
  -GoogleOidcAllowedEmails 'y.tsutsumi30@gmail.com' `
  -GrafanaUrl https://ytsutsumi30.grafana.net `
  -AiProvider vertex `
  -VertexAiLocation global `
  -VertexAiModel gemini-2.5-flash-lite `
  -EnableFirestoreHistory `
  -ServiceAccount grafana-dashboard-builder-run@modern-replica-465803-n8.iam.gserviceaccount.com `
  -SkipOpenAiSecret `
  -AllowUnauthenticated
```

The deployment script removes the legacy `APP_ACCESS_TOKEN` binding in OIDC mode and preserves `grafana-service-account-token`.

## Verification

1. Open the Cloud Run URL in a clean browser profile.
2. Confirm that the access-code field is absent and Google sign-in is available.
3. Sign in with the allowlisted Google account and confirm the authenticated email is shown.
4. Load folders, generate a proposal, and create a disposable dashboard.
5. Verify anonymous `GET /api/folders` returns `401 OIDC_AUTH_REQUIRED`.
6. Verify anonymous `GET /api/mobile-sensor/history?limit=5` returns `200`.
7. Verify anonymous `POST /api/mobile-sensor` returns `401 OIDC_AUTH_REQUIRED`.
8. Install the Android debug APK, sign in, and confirm a sensor POST succeeds.

## Rollback

If browser or Android sign-in fails, restore the temporary compatibility mode:

```powershell
.\scripts\deploy-cloud-run.ps1 `
  -ProjectId modern-replica-465803-n8 `
  -Region asia-northeast1 `
  -ServiceName grafana-dashboard-builder `
  -AppAuthMode access-code `
  -AppAccessTokenSecret grafana-dashboard-builder-access-token `
  -GrafanaUrl https://ytsutsumi30.grafana.net `
  -AiProvider vertex `
  -EnableFirestoreHistory `
  -ServiceAccount grafana-dashboard-builder-run@modern-replica-465803-n8.iam.gserviceaccount.com `
  -SkipOpenAiSecret `
  -AllowUnauthenticated
```

Keep the access-code secret until web and Android OIDC verification has completed. Removing the Secret Manager secret itself is a separate approved cleanup action.

## References

- [Cloud Run end-user authentication](https://cloud.google.com/run/docs/authenticating/end-users)
- [Google Identity Services](https://developers.google.com/identity/gsi/web)
