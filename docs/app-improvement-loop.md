# Application Improvement Loop

## 0. Loop Classification

- Type: manual goal loop.
- Purpose: evaluate application improvement candidates, implement one high-priority batch, and repeat verification only when an observable check fails.
- Smallest useful loop: one prioritized improvement and one complete local verification run.

## 1. Goal

- Done means: the selected improvement works after a realistic browser operation, the local API remains healthy, the target screen has zero console errors, and related tests pass.
- Machine-checkable condition: `node scripts/verify-ui-change-loop.js` exits with code `0` locally and in the GitHub Actions `Validate` job.
- Human review condition: the latest desktop/mobile screenshots are reviewed before Cloud Run deployment when the change affects customer-facing layout or wording.

## 2. Trigger

- Run manually after a request to improve the application or after identifying a repeated sales-demo failure.
- Do not schedule this loop automatically. Candidate selection requires product judgment.

## 3. Candidate Prioritization

Score each candidate from 1 to 5. Priority score is `impact + frequency - implementation risk`.

| Candidate | Impact | Frequency | Risk | Priority | Decision |
| --- | ---: | ---: | ---: | ---: | --- |
| Restore an edited proposal after refresh or accidental navigation | 5 | 4 | 1 | 8 | Implemented first |
| Run the local browser/API verifier on every push and pull request | 5 | 4 | 2 | 7 | Implemented third |
| Add finite browser API timeouts and retry guidance | 4 | 3 | 2 | 5 | Implemented second |
| Add a full Grafana Cloud write smoke test to CI | 4 | 2 | 4 | 2 | Human-approved external test only |
| Add more decorative UI customization | 2 | 2 | 2 | 2 | Defer |

## 4. Doer Steps

1. Inspect current behavior, recent verification evidence, and known operating constraints.
2. Score candidates and select one coherent improvement batch.
3. Keep secrets and external Grafana writes outside the local loop.
4. Implement the selected behavior and its deterministic verification together.
5. Update the specification, sales guide, and this decision record.

## 5. Verification

Run:

```powershell
node scripts\verify-ui-change-loop.js
```

Expected evidence:

- Dev server starts at `http://127.0.0.1:4173/`.
- `GET /api/ping` returns HTTP 200.
- The known sheet-metal proposal API returns at least 8 panels.
- The target page renders a 19-panel proposal on desktop and mobile.
- Edited panel title and project label are written to the browser draft, including an immediate reload before the debounce timer completes.
- Reloading the page restores the edited values and workflow step 2.
- The access code is not stored or restored with the draft.
- A simulated stalled request stops within the test timeout and returns retry guidance.
- A simulated connection failure returns distinct network/Cloud Run guidance.
- Browser console errors and uncaught runtime exceptions are 0.
- Node.js syntax checks and dashboard JSON validation pass.
- Evidence is written under `outputs/ui-verification/`.

## 6. Stop Conditions

- Success: the verifier exits `0` and screenshot review shows no clipping or incoherent overlap.
- Maximum attempts: 2 per verifier execution.
- Time limit: use the script's finite server and browser timeouts; do not wait indefinitely for external services.
- Stop and ask the user when the same external failure occurs twice, Grafana Cloud writes are required, or a visual/brand choice has no objective acceptance criterion.

## 7. Guardrails

- The loop clears Grafana and application access tokens in its dev-server environment.
- Draft storage must never contain the application access code, Grafana token, OpenAI key, Google credential, or other secret.
- Do not deploy Cloud Run or create/update Grafana Cloud dashboards in this loop.
- Do not automatically retry POST operations such as dashboard creation; a retry can create duplicate external writes.
- Use a temporary browser profile and terminate the local server/browser after verification.
- Keep generated screenshots and JSON evidence under the Git-ignored `outputs/` directory.
- CI uploads `outputs/ui-verification/` only after failure and retains it for 7 days.

## 8. Record

- Improvement decision: this file.
- UI-specific verification details: `docs/ui-change-verification-loop.md`.
- Executable verifier: `scripts/verify-ui-change-loop.js`.
- Product behavior: `docs/dashboard-builder-specification.md`.
- Sales operation: `docs/sales-user-guide.md`.

## 9. 2026-07-17 Decision

- Selected issue: an edited proposal was lost after a page refresh.
- Implementation: versioned local browser draft, 300 ms autosave debounce, page-exit flush, automatic restoration, saved-time state, explicit draft discard, and draft removal after successful Grafana creation.
- Saved fields: customer conditions, folder, overwrite option, proposal metadata, and panel edits.
- Excluded fields: access code and every server-side secret.
- Verification finding: screenshot review detected preview content clipping after the first successful machine check. The panel content sizing and screenshot paint wait were corrected before the loop stopped.

## 10. 2026-07-17 API Timeout Decision

- Selected issue: stalled browser requests could leave a sales operation waiting indefinitely.
- Implementation: common GET/POST request handler, 30-second AbortController timeout, safe JSON response parsing, and separate timeout/connection messages.
- Retry policy: re-enable the existing operation button and ask the user to confirm the network and Cloud Run state before retrying.
- Automatic retry is intentionally disabled for POST requests because Grafana dashboard creation and demo-data generation change external state.
- Verification: replace browser `fetch` with deterministic stalled and connection-failure implementations, use a 25 ms test timeout, confirm both guidance messages, and keep console errors at zero.

## 11. 2026-07-17 CI Verification Decision

- Selected issue: UI, console, draft-recovery, and local API checks were only run manually and could regress after a later push.
- Implementation: discover Chrome/Chromium/Edge on Windows, Linux, and macOS; add CI-safe headless options; run the complete verifier in the GitHub Actions `Validate` job.
- CI trigger: push or pull request targeting `master`.
- Evidence policy: upload screenshots and result JSON only when the job fails, retain for 7 days, and ignore an absent evidence directory when startup fails early.
- External-state guardrail: CI clears Grafana/application tokens and does not create or update Grafana Cloud dashboards.
- Local evidence: both normal Windows execution and `CI=true` execution completed on the first attempt with console errors at zero.

## 12. Five-Cycle Improvement Batch

The user requested five consecutive finite improvement loops. Each cycle uses the same maximum of two verifier attempts, creates one local commit after success, and defers the GitHub push until all five cycles finish.

| Cycle | Improvement | Machine check | Status |
| ---: | --- | --- | --- |
| 1 | Use the runtime Grafana URL instead of a tenant-specific hardcode | Change `state.grafanaUrl`, render metadata, and confirm the generated link follows it | Completed |
| 2 | Filter a long panel editor list | Filter 19 panels and restore the complete list | Completed |
| 3 | Move panels up and down | Reorder state and preview, then restore original order | Completed |
| 4 | Reject expired or malformed browser drafts | Reload an expired draft and confirm it is removed | Completed |
| 5 | Enforce input limits and focus actionable errors | Submit an overlong industry and confirm focused error status | Completed |

### Cycle 1 Decision

- Problem: preview and printed proposal URLs were fixed to one Grafana Cloud tenant.
- Change: derive dashboard links from the sanitized `grafanaUrl` returned by `/api/runtime-status`.
- Fallback: show `Grafana URLを確認中` instead of linking to the wrong tenant.
- External writes: none.

### Cycle 2 Decision

- Problem: a 19-panel manufacturing proposal required excessive scrolling to find one editor.
- Change: add a client-side search over panel title, purpose, unit, and visualization.
- Data behavior: filtering changes only rendered editor cards; preview, panel state, order, and draft data remain unchanged.
- Recovery: clear the filter automatically when creating a new proposal, adding a panel, or discarding a draft.

### Cycle 3 Decision

- Problem: users could add or delete panels but could not change their order before Grafana creation.
- Change: add fixed-size up/down controls to each panel editor with accessible labels and hover titles.
- State behavior: swap entries in `state.panels`, then regenerate the editor list and 24-column preview and autosave the new order.
- Guardrail: disable upward movement for the first panel and downward movement for the final panel.

### Cycle 4 Decision

- Problem: a stale or manually modified browser draft could be restored into the editor without sufficient validation.
- Change: expire drafts after seven days and sanitize identity, strings, numeric fields, visualization types, scenarios, and panel count before restoration.
- Recovery: remove invalid, expired, or excessively future-dated drafts from localStorage and return the workflow to `条件入力`.
- Verification: replace a valid draft timestamp with an eight-day-old value, reload the page, and confirm both storage removal and an empty editor.

### Cycle 5 Decision

- Problem: browser inputs did not expose their server-side limits, and button-triggered validation errors did not move keyboard focus to the actionable message.
- Change: apply explicit limits to industry, proposal metadata, panel title, unit, and purpose fields; reject an overlong industry before any API request.
- Accessibility: mark the invalid industry and move focus from the triggering button to the live status region while preserving the button for immediate retry.
- Verification: submit 121 characters, confirm the 120-character message and focused status, then generate a normal proposal and validate all dynamic field limits.

## 13. Five-Cycle Improvement Batch 2

This batch prioritizes panel-editing safety and speed. Each cycle keeps the two-attempt verifier limit, produces one commit after success, and defers the external push until all five cycles pass.

| Cycle | Improvement | Machine check | Status |
| ---: | --- | --- | --- |
| 1 | Prevent adding more than 24 panels | Fill the editor to 24 panels and confirm Add is disabled without changing state | Completed |
| 2 | Focus a newly added panel | Add one panel and confirm its title receives focus | Completed |
| 3 | Duplicate an existing panel | Duplicate one panel and confirm copied data, position, and focus | Completed |
| 4 | Undo an accidental panel deletion | Delete and restore one panel with order preserved | Completed |
| 5 | Filter panels with validation errors | Introduce one invalid range and confirm only that panel is shown | Completed |

### Batch 2 Cycle 1 Decision

- Problem: the editor allowed users to exceed the server-supported 24-panel limit and only exposed the problem after the state was already invalid.
- Change: share one `MAX_PANEL_COUNT` constant across validation, Add-button state, handler guard, and the visible panel count.
- Guardrail: disable Add at 24 panels and keep a handler-level check so scripted or stale interactions cannot append another panel.
- Verification: replace the proposal temporarily with 24 panels, confirm Add remains inert, then restore the original proposal.

### Batch 2 Cycle 2 Decision

- Problem: after adding a panel to a long editor list, the new card could remain outside the visible area and require manual searching.
- Change: tag editor cards with their source panel index, scroll the new title input to the center, focus it, and select the default title.
- Data behavior: focus management does not alter panel order or values; normal autosave still records the added panel.
- Verification: add panel 20, confirm preview/state count and selected title focus, then remove the test panel and restore 19 panels.

### Batch 2 Cycle 3 Decision

- Problem: creating several similar machine or sensor panels required repeatedly entering the same visualization, range, unit, and thresholds.
- Change: add a Duplicate command to every card, insert the copy directly after its source, assign a unique ID, and suffix the editable title with `- Copy`.
- Guardrail: disable duplication at the shared 24-panel limit and focus/select the copied title for immediate renaming.
- Verification: duplicate the first panel, compare all monitoring fields and preview order, confirm unique identity and focus, then restore the original proposal.

### Batch 2 Cycle 4 Decision

- Problem: Delete removed a configured panel immediately, making an accidental click costly to reconstruct.
- Change: retain the most recently deleted panel and its index, show a dedicated undo strip, and restore the panel to its prior position on request.
- Lifecycle: clear pending undo state when a new proposal replaces the current one; autosave records both deletion and restoration without persisting the temporary undo object.
- Verification: delete the first panel, confirm the strip and 18-panel state, undo, and compare editor and preview title order with the original 19 panels.

### Batch 2 Cycle 5 Decision

- Problem: validation disabled Grafana creation but users still had to scan a long editor list to find the panels that needed correction.
- Change: show the invalid-panel count beside the visible/total count and add an `エラーのみ` checkbox that composes with text search.
- Recovery: adding, duplicating, replacing, or discarding a proposal clears the error-only view so newly created content remains visible.
- Verification: introduce one invalid range, compare visible card indexes with computed validation results, confirm creation is disabled, then repair and restore the complete valid list.

## 14. OIDC Authentication Migration Loop

The access-code UI is being replaced by Google OpenID Connect. This is a bounded migration loop with a maximum of ten cycles. Production remains in legacy access-code mode until a Google OAuth client is configured and the final authentication switch is verified.

| Cycle | Improvement | Machine check | Status |
| ---: | --- | --- | --- |
| 1 | Add server authentication modes | Start `google-oidc` locally and reject an invalid Bearer token | Completed |
| 2 | Make the browser UI select its authentication path at runtime | IAP/OIDC mode hides the legacy code input | Completed |
| 3 | Add Cloud Run deployment flags for OIDC and IAP | Script validates an OIDC deployment configuration without secret output | Completed |
| 4 | Extend automated verification coverage | UI and server checks cover legacy and OIDC paths | Completed |
| 5 | Document the OAuth and Android migration path | Runbook identifies the manual OAuth prerequisite and rollout order | Completed |
| 6 | Run complete local/CI-equivalent validation | Browser console, syntax, JSON, and OIDC checks pass | Completed |
| 7 | Add Android Google Sign-In compatibility | Android sends a Google ID token without persisting it | Completed |
| 8 | Deploy Google OIDC and verify production flows | Protected writes reject anonymous calls; Grafana reads remain available | Completed |

### OIDC Cycle 1 Decision

- Change: support `access-code`, `google-oidc`, `iap`, and `none` runtime modes without changing the existing production default.
- Google OIDC guard: verify RS256 signature against Google's JWKS, issuer, audience, expiry, verified email, and optional email/domain allowlists.
- Compatibility: `access-code` remains the fallback while `APP_ACCESS_TOKEN` is configured; no access token value is exposed through the status API.
- Verification: `scripts/verify-google-oidc-mode.js` starts an isolated server, verifies `/api/auth-status`, and confirms an invalid Bearer token receives `401 OIDC_AUTH_REQUIRED`.

### OIDC Cycle 2 Decision

- Change: render the access-code field only in `access-code` mode; render Google Identity Services only in `google-oidc` mode; show an authenticated IAP actor without any user-entered code.
- Token handling: Google ID tokens remain only in page memory and use the Authorization header. Legacy access codes remain session-only for the temporary compatibility mode.
- API behavior: all protected browser operations wait for an authenticated runtime mode rather than checking a specific input field.
- Verification: the existing full browser verifier passes with the no-auth local mode, preserving proposal editing, draft recovery, console error zero, and dashboard JSON checks.

### OIDC Cycle 3 Decision

- Change: add explicit authentication mode, Google OIDC client/allowlist, IAP, and dry-run parameters to the Cloud Run deployment script.
- Secret lifecycle: use `--update-secrets` and remove `APP_ACCESS_TOKEN` only when the selected mode is no longer `access-code`; preserve the Grafana token secret.
- IAP guardrail: the script refuses the contradictory combination of IAP and unauthenticated Cloud Run access.
- Verification: PowerShell parser validation and Google OIDC dry run completed without changing GCP resources or printing a secret value.

### OIDC Cycle 4 Decision

- Change: include the OIDC server verifier in the normal UI verification command and assert the access-code, Google sign-in, and IAP UI states directly from the browser DOM.
- Coverage: validate that Google OIDC hides the legacy input, IAP exposes the signed-in actor, and an invalid Bearer token remains unauthorized.
- Verification: full local UI loop completed with console errors at zero, related OIDC test success, and all dashboard JSON validation success.

### OIDC Cycle 5 Decision

- Change: add a dedicated runbook with OAuth client setup, Google OIDC deployment, production verification, Android compatibility gate, and rollback commands.
- Critical constraint: Cloud Run IAP directly protects every route; the current unauthenticated Android sensor sender would stop working. The runbook requires Android Google Sign-In or a separate ingestion service before the final cutover.
- Secret lifecycle: remove the access-code binding from Cloud Run only after successful sign-in verification; defer Secret Manager deletion to a separate approved cleanup.

### OIDC Cycle 6 Decision

- Verification: `CI=true node scripts/verify-ui-change-loop.js` completed successfully with console errors at zero, including the isolated Google OIDC invalid-token rejection test.
- Deployment validation: PowerShell parser and `deploy-cloud-run.ps1 -DryRun` succeeded for `google-oidc` without changing GCP resources.
- Documentation: NotebookLM source manifest refreshed for the new authentication runbook and updated verification definition.
- Stop condition: cycles 7 and 8 require a human-completed Google Auth Platform OAuth client for this no-organization project. Direct IAP is additionally deferred because it would block the current unauthenticated Android sensor endpoint.

### OIDC Cycle 7 Decision

- Change: add Google Play Services sign-in to the Android vibration demo and send the resulting Web-client ID token only in the request `Authorization` header.
- Token handling: Android holds the token in memory only. The OAuth client ID is supplied as a visible public configuration value; no OAuth secret is placed in source code or on the device.
- Verification: compile the debug APK and inspect the source path that requires Google sign-in before streaming when an OAuth client ID is configured.
- Remaining prerequisite: create the Google Auth Platform Web and Android OAuth clients, then deploy Cloud Run in `google-oidc` mode.

### OIDC Cycle 8 Decision

- OAuth setup: external branding, the Cloud Run web client, and the Android debug client are configured in Google Auth Platform.
- Route boundary: Cloud Run remains public only for Grafana-compatible read-only monitoring endpoints. Dashboard administration, AI model calls, and Android sensor writes require a verified allowlisted Google ID token.
- Android configuration: the debug app defaults to the canonical Cloud Run receiver and the public Web client ID; ID tokens stay in memory.
- Verification: the isolated OIDC test checks anonymous history reads return `200` and anonymous sensor writes return `401`; the Android debug APK builds successfully.
- Production: revision `grafana-dashboard-builder-00031-d76` is serving 100% traffic in `google-oidc` mode. Anonymous folders, sensor writes, and proposal generation return `401`; sensor history and Grafana KPI reads return `200`.
