# Application Improvement Loop

## 0. Loop Classification

- Type: manual goal loop.
- Purpose: evaluate application improvement candidates, implement one high-priority batch, and repeat verification only when an observable check fails.
- Smallest useful loop: one prioritized improvement and one complete local verification run.

## 1. Goal

- Done means: the selected improvement works after a realistic browser operation, the local API remains healthy, the target screen has zero console errors, and related tests pass.
- Machine-checkable condition: `node scripts/verify-ui-change-loop.js` exits with code `0`.
- Human review condition: the latest desktop/mobile screenshots are reviewed before Cloud Run deployment when the change affects customer-facing layout or wording.

## 2. Trigger

- Run manually after a request to improve the application or after identifying a repeated sales-demo failure.
- Do not schedule this loop automatically. Candidate selection requires product judgment.

## 3. Candidate Prioritization

Score each candidate from 1 to 5. Priority score is `impact + frequency - implementation risk`.

| Candidate | Impact | Frequency | Risk | Priority | Decision |
| --- | ---: | ---: | ---: | ---: | --- |
| Restore an edited proposal after refresh or accidental navigation | 5 | 4 | 1 | 8 | Implemented first |
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
