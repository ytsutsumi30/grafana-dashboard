# Google OIDC Authentication Runbook

## Purpose

Replace the temporary dashboard-builder access-code input with Google OpenID Connect authentication. The dashboard builder verifies Google ID tokens server-side and keeps the Grafana Service Account Token only in Secret Manager.

## Current State

- Cloud Run service: `grafana-dashboard-builder`
- Project: `modern-replica-465803-n8`
- Region: `asia-northeast1`
- Current production mode: `access-code`
- Target browser mode: `google-oidc`
- Android sensor sender: Google Sign-In capable `POST /api/mobile-sensor`; production configuration is still pending

Do not remove `APP_ACCESS_TOKEN` from the running service until the OAuth client is configured and the Android migration decision is complete.

## Authentication Modes

| Mode | Intended use | Browser UI | API guard |
| --- | --- | --- | --- |
| `access-code` | Temporary PoC compatibility | Shows access-code field | `X-App-Access-Token` |
| `google-oidc` | Web and native client Google sign-in | Shows Google sign-in | Google ID token in `Authorization: Bearer` |
| `iap` | Browser-only internal application | No access-code field; IAP supplies identity | Cloud Run IAP header |
| `none` | Local development only | No authentication UI | No application guard |

## Google OAuth Client Prerequisite

This project has no Google Cloud organization. Google documents that the first external OAuth client for Cloud Run/IAP must be created through Google Cloud Console; it cannot be created by the CLI alone.

1. Open [Google Auth Platform Branding](https://console.cloud.google.com/auth/branding?project=modern-replica-465803-n8).
2. Create an External audience and complete the required app/contact fields.
3. Open [Google Auth Platform Clients](https://console.cloud.google.com/auth/clients?project=modern-replica-465803-n8).
4. Create a Web application OAuth client for the dashboard builder.
5. Add the Cloud Run origins used by the service, including:
   - `https://grafana-dashboard-builder-577010681495.asia-northeast1.run.app`
   - `https://grafana-dashboard-builder-pjvjufzh3q-an.a.run.app`
6. Record the client ID. It is public configuration, not a secret.

For direct Cloud Run IAP, Google recommends enabling IAP from the Cloud Run Security page for this first setup. Direct IAP protects every route on this service, including Android sensor ingestion.

## Web OIDC Deployment

After the OAuth client exists, deploy using the client ID and an explicit allowlist. Multiple values use semicolons.

```powershell
.\scripts\deploy-cloud-run.ps1 `
  -ProjectId modern-replica-465803-n8 `
  -Region asia-northeast1 `
  -ServiceName grafana-dashboard-builder `
  -AppAuthMode google-oidc `
  -GoogleOidcClientId '<Web OAuth client ID>' `
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

The script removes `APP_ACCESS_TOKEN` from Cloud Run in this mode. It keeps `grafana-service-account-token` in Secret Manager. Do not put the OAuth client secret, Grafana token, or application secret into the browser.

## Required Verification

1. Open the Cloud Run URL in a clean browser profile.
2. Confirm the access-code input is absent and the Google sign-in button is visible.
3. Sign in with an allowlisted account.
4. Confirm `認証済み: <email>` is shown.
5. Create a panel proposal and load folders.
6. Create a disposable Grafana dashboard only after normal UI verification succeeds.
7. Confirm an unauthorized browser receives `401 OIDC_AUTH_REQUIRED` for `/api/folders`.

## Android Compatibility Gate

The Android vibration app now supports Google Sign-In. It takes the Web OAuth client ID as public configuration, requests an ID token, holds it only in memory, and sends it as `Authorization: Bearer` to `/api/mobile-sensor`. This matches the same server-side validation used by the browser UI.

Before production cutover:

1. Create an Android OAuth client for package `com.example.androidvibrationdemo` and its signing certificate SHA-1.
2. Build/install the Android app, enter the Web OAuth client ID, and complete Google Sign-In with an allowlisted account.
3. Confirm a sensor POST succeeds after the Cloud Run `google-oidc` deployment.

For a multi-device production system, move sensor ingestion to a dedicated service with device credentials and durable storage. That is not required for this single-device sales-demo cutover.

## Rollback

If Google OIDC sign-in fails, redeploy the previous compatibility configuration:

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

Keep the access-code secret until the Google OIDC rollout and Android compatibility verification are complete. Then remove only the Cloud Run secret binding first; delete the Secret Manager secret in a separate, explicitly approved cleanup change.

## References

- [Authenticate end users on Cloud Run](https://cloud.google.com/run/docs/authenticating/end-users)
- [Configure IAP for Cloud Run](https://cloud.google.com/run/docs/securing/identity-aware-proxy-cloud-run)
