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
