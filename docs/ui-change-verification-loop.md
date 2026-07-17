# UI Improvement and Verification Loop

## 0. Should This Be a Loop?

- Task: inspect the dashboard builder UI, implement one prioritized improvement batch, and verify the result.
- Why one normal check is not enough: visual changes can introduce browser exceptions, responsive overflow, or broken proposal rendering after implementation.
- Smallest useful loop: one improvement batch followed by automated desktop/mobile verification, with at most two attempts.

## 1. Goal

- Completion statement: the primary sales workflow remains easy to identify, the target screen renders a manufacturing proposal on desktop and mobile, browser console errors are zero, and related repository checks pass.
- Machine-checkable condition: `node scripts/verify-ui-change-loop.js` exits with code `0`.
- Human-review condition: a person reviews the generated screenshots when visual hierarchy, wording, or customer suitability is the reason for the change.

## 2. Trigger

- Manual goal-style retry loop after changes to:
  - `public/grafana-sales-dashboard-builder.html`
  - `server/grafana-dashboard-builder.js`
  - proposal rendering, preview rendering, static asset serving, or UI-facing API behavior
- Event-driven verifier on GitHub Actions after a push or pull request targeting `master`.

## 3. Doer

- Inputs: the requested UI outcome, current desktop/mobile screenshots, and existing product conventions.
- Allowed files/systems: local repository files and local dev server only.
- Steps:
  1. Inspect the current screen and identify issues by workflow impact, frequency, and implementation risk.
  2. Select one coherent improvement batch. Do not combine unrelated refactors.
  3. Preserve dashboard creation and Grafana API behavior unless the request explicitly changes it.
  4. Implement the UI and accessibility changes.
  5. Start verification from the first affected step.

## 4. Verifier

- Verification command:

```powershell
node scripts\verify-ui-change-loop.js
```

- Browser checks:
  - Start the dev server at `http://127.0.0.1:4173/`.
  - Confirm page title and required controls.
  - Confirm three workflow steps and at least six collapsible auxiliary sections.
  - Generate the known `板金加工業者` manufacturing proposal.
  - Confirm at least eight preview panels and panel edit cards render.
  - Confirm the dashboard URL follows the runtime Grafana URL instead of a tenant hardcode.
  - Filter the panel editor list, restore it, and reorder panels while keeping the preview synchronized.
  - Fill the proposal to 24 panels and confirm Add cannot create a 25th panel.
  - Add and duplicate a panel, confirm copied data and selected title focus, then restore the original list.
  - Delete and undo one panel while preserving editor and preview order.
  - Introduce an invalid range, filter to invalid panels, repair it, and confirm creation is enabled again.
  - Submit an overlong industry, confirm input limits, and confirm focus moves to the actionable error status.
  - Simulate Google OIDC and IAP runtime modes; confirm the access-code field is hidden and authenticated identity text is rendered.
  - Edit a panel title and project label, immediately reload before the debounce completes, and confirm both values are restored.
  - Replace the draft timestamp with an expired value, reload, and confirm the draft is removed.
  - Confirm the application access code is not persisted or restored with the draft.
  - Simulate a stalled fetch and a connection failure, then confirm finite timeout and retry-guidance messages.
  - Confirm the workflow advances to step 2.
  - Confirm desktop content does not overflow the document viewport.
  - Confirm mobile content fits within 390 px and only the preview canvas scrolls horizontally.
  - Confirm console errors and uncaught runtime exceptions are zero.
  - Discover Chrome/Chromium/Edge through `CHROME_PATH`, `CHROME_BIN`, or standard Windows/Linux/macOS paths.
- Related tests:
  - `node --check server/grafana-dashboard-builder.js`
  - `node --check scripts/verify-ui-change-loop.js`
  - `node scripts/verify-google-oidc-mode.js`
  - `node scripts/validate-repository.js`
- Local API checks:
  - `GET /api/ping` returns HTTP 200.
  - `POST /api/propose` returns the known template with at least eight panels.
- Browser API failure checks:
  - A stalled request is aborted by the configured timeout.
  - A connection failure produces distinct network/Cloud Run guidance.
  - Neither handled failure produces a console error or uncaught exception.
- Required evidence:
  - `outputs/ui-verification/latest-desktop.png`
  - `outputs/ui-verification/latest-mobile.png`
  - `outputs/ui-verification/latest-result.json`
  - On CI failure, the `ui-verification-<run id>` GitHub Actions artifact is retained for 7 days.

## 5. Stop Conditions

- Success: the verification command exits `0` and required evidence files exist.
- Maximum attempts: 2 by default; configure with `UI_VERIFY_MAX_RETRIES` only for local diagnosis.
- Time limit: each server/browser operation uses a finite timeout; do not extend the loop indefinitely.
- Stop and ask the user when:
  - two attempts fail for the same external or environment-dependent reason,
  - the requested visual decision needs brand or sales-owner approval,
  - verification requires writing to Grafana Cloud, Cloud Run, or another external system.

## 6. Guardrails

- Do not deploy to Cloud Run or modify Grafana Cloud dashboards in this local loop.
- Do not print, persist, or capture secrets. The dev server starts with Grafana and app access tokens cleared.
- Use a temporary browser profile and terminate the browser and dev server after verification.
- Keep screenshots and result JSON under the Git-ignored `outputs/` directory.
- Keep the implementation and verifier independent: the verifier checks observable DOM/layout state rather than internal success flags.

## 7. Record

- Durable loop definition: `docs/ui-change-verification-loop.md`.
- Executable verifier: `scripts/verify-ui-change-loop.js`.
- Product behavior: `docs/dashboard-builder-specification.md`.
- Sales workflow: `docs/sales-user-guide.md`.
- Latest evidence: `outputs/ui-verification/`.
- When this loop changes, update the definition and executable verifier in the same change.

## 8. Current Improvement Decision

- Date: 2026-07-17.
- Priority issue: primary dashboard creation actions were mixed with history, operations, datasource replacement, and AI demo functions in one long sidebar.
- Applied decision:
  - keep customer conditions and create actions visible,
  - move auxiliary tools into collapsible sections,
  - show `条件入力`, `パネル編集`, and `Grafana作成` progress in the main toolbar,
  - keep the desktop sidebar and main toolbar visible while scrolling,
  - contain the 24-column preview as a horizontal canvas on mobile,
  - display Grafana unit identifiers as customer-readable unit symbols.
- Human review point: review the two latest screenshots before a customer-facing Cloud Run deployment.
