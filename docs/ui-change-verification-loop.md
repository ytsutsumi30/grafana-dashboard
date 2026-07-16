# UI Change Verification Loop

## Goal

- Done means: after a UI change, the dashboard builder starts locally, the target screen renders, browser console errors are zero, and related repository checks pass.
- Machine-checkable condition: `node scripts/verify-ui-change-loop.js` exits with code `0`.

## Trigger

- Manual turn loop after changes to:
  - `public/grafana-sales-dashboard-builder.html`
  - `server/grafana-dashboard-builder.js`
  - UI-facing API behavior, dashboard proposal rendering, preview rendering, or static asset serving

## Doer Steps

- Implement the UI change.
- Keep the change scoped to the requested behavior.
- Run formatting or syntax checks if a touched file has a known formatter or parser.

## Verification

- Command/tool:

```powershell
node scripts\verify-ui-change-loop.js
```

- Expected result:
  - Dev server starts at `http://127.0.0.1:4173/`.
  - Target page title is `Grafana Cloud ダッシュボード提案ツール`.
  - Required controls exist: `#industry`, `#dashboardType`, `#propose`, `#create`.
  - Browser console errors and runtime exceptions are `0`.
  - Related tests pass:
    - `node --check server/grafana-dashboard-builder.js`
    - `node --check scripts/verify-ui-change-loop.js`
    - `node scripts/validate-repository.js`

- Evidence to report:
  - Dev server URL.
  - Console error count.
  - Related test command results.

## Stop Conditions

- Success: verification command exits `0`.
- Retry limit: default `2` attempts, configurable with `UI_VERIFY_MAX_RETRIES`.
- Budget/time limit: stop after the retry limit or when the browser/server readiness timeout is exceeded.
- Escalate to human when:
  - The UI renders but visual quality is subjective.
  - Grafana Cloud or external AI APIs are required to prove the change.
  - Browser automation cannot start Chrome/Edge on the local machine.

## Guardrails

- Blocked actions:
  - Do not deploy to Cloud Run as part of this local UI verification loop.
  - Do not write or print secrets.
  - Do not modify Grafana Cloud dashboards during this loop.
- Required tests/hooks/permissions:
  - Use a temporary browser profile.
  - Kill the local dev server started by the loop after verification.
  - Keep related checks local and deterministic.

## Record

- Durable loop definition: `docs/ui-change-verification-loop.md`.
- Executable loop: `scripts/verify-ui-change-loop.js`.
- If this loop changes, update both the doc and script in the same commit.
