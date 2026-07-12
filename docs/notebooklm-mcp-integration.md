# NotebookLM MCP Integration Notes

This document records how this project uses NotebookLM MCP for the Grafana dashboard builder PoC.

## Target Notebook

- Notebook URL: `https://notebooklm.google.com/notebook/e6ec4685-1b9b-47ab-a7fd-d4464e1a2324`
- MCP library id: `grafana-dashboard-builder-poc`
- Purpose: collect Grafana dashboard builder documentation, manufacturing dashboard runbooks, Android sensor demo notes, Cloud Run deployment notes, and datasource replacement guidance.

## notebooklm-mcp Findings

The `PleasePrompto/notebooklm-mcp` project provides a NotebookLM MCP server that:

- Runs via `npx notebooklm-mcp@latest`.
- Requires Node.js 18 or newer and Chrome or bundled Chromium.
- Supports Windows, Linux, macOS, and WSL2.
- Uses a persistent Chrome profile for Google authentication.
- Supports NotebookLM library management, Q&A, source ingestion, sessions, and Audio Overview generation.
- Supports `stdio` for Codex/Claude/Cursor and Streamable HTTP for HTTP MCP clients.

Important implementation detail: NotebookLM MCP v2 source ingestion supports `url` and `text` in the main MCP server. File upload is not part of the v2 main server interface, so this project uploads local Markdown and script files as text sources.

## Current Local State

Codex can see the NotebookLM MCP server and the server reports authenticated in the connected Codex MCP environment.

The following operations were verified:

- `get_health`: authenticated in the Codex MCP environment.
- `add_notebook`: registered the target Grafana NotebookLM URL in the MCP library.
- `select_notebook`: selected `grafana-dashboard-builder-poc` as the active notebook.
- Direct `npx notebooklm-mcp@latest` startup: available, profile is `full`, and the server advertises `add_source`.

Observed limitation:

- Direct `npx notebooklm-mcp@latest` currently uses a separate unauthenticated browser profile from the already connected Codex MCP server.
- Codex's exposed tool list currently omits `add_source`, even though the direct MCP server advertises it.
- A direct Q&A attempt against the target Notebook URL failed to locate the NotebookLM chat input or hit `net::ERR_CONNECTION_CLOSED`.

## Source Sync Strategy

The project keeps a source manifest at:

- `docs/notebooklm-source-manifest.json`

Primary sync command for MCP:

```powershell
node .\scripts\sync-notebooklm-mcp-sources.js --notebook-url https://notebooklm.google.com/notebook/e6ec4685-1b9b-47ab-a7fd-d4464e1a2324
```

Both MCP helper scripts force `BROWSER_CHANNEL=chromium` unless the environment already sets a channel. This keeps the browser used for authentication and the browser used for source sync consistent.

If the MCP server's built-in `add_source` cannot open the current NotebookLM add-source dialog, `scripts/sync-notebooklm-mcp-sources.js` can fall back to direct UI automation. The direct UI path opens the notebook, selects `コピーしたテキスト`, pastes the source body, and clicks `挿入`.

```powershell
node .\scripts\sync-notebooklm-mcp-sources.js --direct-ui --notebook-url https://notebooklm.google.com/notebook/e6ec4685-1b9b-47ab-a7fd-d4464e1a2324
```

Dry run:

```powershell
node .\scripts\sync-notebooklm-mcp-sources.js --dry-run --notebook-url https://notebooklm.google.com/notebook/e6ec4685-1b9b-47ab-a7fd-d4464e1a2324
```

If direct MCP auth is missing, run NotebookLM MCP auth setup, then rerun the sync command:

```powershell
node .\scripts\setup-notebooklm-mcp-auth.js
```

Complete Google login in the opened browser. Then rerun the sync command so the direct MCP profile has a valid Google login.

If source sync redirects to the Google login page even though `get_health` reports authenticated, force re-authentication:

```powershell
node .\scripts\setup-notebooklm-mcp-auth.js --force
```

If the browser profile remains inconsistent, clear only NotebookLM MCP auth/browser state while preserving the local notebook library:

```powershell
node .\scripts\setup-notebooklm-mcp-auth.js --clean
```

## Operational Rules

- Do not upload secrets, API keys, service account tokens, `.env` files, or local auth cookies.
- Keep source count below the NotebookLM notebook limit.
- Re-run dry-run before uploading sources.
- Prefer source titles prefixed with `Grafana Project -` for easier search in NotebookLM.
- When docs change, regenerate the manifest and then run MCP sync.

## Validation Commands

```powershell
.\scripts\sync-notebooklm-sources.ps1 -DryRun -NotebookId grafana-dashboard-builder-poc -ManifestPath docs\notebooklm-source-manifest.json
node --check .\scripts\sync-notebooklm-mcp-sources.js
node .\scripts\sync-notebooklm-mcp-sources.js --dry-run --notebook-url https://notebooklm.google.com/notebook/e6ec4685-1b9b-47ab-a7fd-d4464e1a2324
```
