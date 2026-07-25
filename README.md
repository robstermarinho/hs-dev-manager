<p align="center">
  <img src="assets/banner.png" alt="HS Dev Manager" width="680">
</p>

[![CI](https://github.com/robstermarinho/hs-dev-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/robstermarinho/hs-dev-manager/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/hs-dev-manager)](https://www.npmjs.com/package/hs-dev-manager)
[![node](https://img.shields.io/node/v/hs-dev-manager)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/hs-dev-manager)](./LICENSE)
[![types](https://img.shields.io/badge/types-TypeScript-blue)](https://www.typescriptlang.org/)
[![downloads](https://img.shields.io/npm/dm/hs-dev-manager)](https://www.npmjs.com/package/hs-dev-manager)
[![install size](https://packagephobia.com/badge?p=hs-dev-manager)](https://packagephobia.com/result?p=hs-dev-manager)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/robstermarinho/hs-dev-manager/pulls)

Interactive CLI for fetching, watching, and deploying HubSpot Design Manager files across multiple accounts.

> **Not an official HubSpot product.** This project is not affiliated with, endorsed by, or supported by HubSpot, Inc. It is a community tool that wraps the official [HubSpot CLI](https://www.npmjs.com/package/@hubspot/cli). "HubSpot" is a trademark of HubSpot, Inc., used here only to describe compatibility.

## Why this package?

The official `hs` CLI is a fine tool, genuinely. But it was clearly designed with one portal in mind, and some of us live a different life: five client portals before lunch, each with its own Design Manager tree, and a strong desire not to `hs account use` our way into deploying the wrong theme to the wrong customer.

That's the gap this tool fills. While we wait, in the spirit of "no rush, HubSpot, we know you're busy," `hsdm` gives you:

- **Portals as a first-class concept:** Pick an account from a menu, and every fetch, watch, and deploy is scoped to it. Files land in `src/{account}-{id}/`, so two portals never collide.
- **Saved remote paths per portal:** Configure a Design Manager path once, reuse it forever. No more retyping `/Marketing/Themes/...` from memory.
- **Guardrails around destructive syncs:** Fetch refuses to overwrite uncommitted work, and every clean sync becomes a scoped Git commit. Your history knows exactly what came from where.
- **A deploy flow that asks first:** Pick the changed files to upload, get a commit containing only what actually shipped.
- **One menu instead of seven flags:** Arrow keys, not man pages.

If you manage a single portal, the official CLI is probably all you need. If you manage several, this is the tool we wished existed, so we built it.

## Requirements

- Node.js 22 or newer
- HubSpot CLI 8.x
- At least one authenticated HubSpot account
- Git for deploy detection and automatic sync commits

Install and authenticate the official HubSpot CLI first:

```bash
npm install --global @hubspot/cli
hs account auth
```

## Install

```bash
npm install --global hs-dev-manager
```

Both executable names are equivalent:

```bash
hsdm
hs-dev-manager
```

## Quick start

Run `hsdm` from the root of the Git repository where HubSpot files should live.

1. Select an authenticated HubSpot account.
2. Choose **Configure new path** and browse or enter a Design Manager path.
3. Edit the downloaded files under `src/{account-name}-{account-id}/`.
4. Use **Watch** to upload changes on save, or **Deploy** to select files, upload them, and create a scoped Git commit.

The CLI remembers the last selected account and the remote paths configured for each account.

## Safety behavior

- Fetch operations use HubSpot's `--overwrite` option and are blocked when the selected account's local scope contains uncommitted changes.
- An incomplete fetch is never committed automatically. Any partially written files remain uncommitted for inspection.
- Deploy uploads only the files selected in the prompt and commits only successfully uploaded files.
- Locally deleted files are reported but are not deleted remotely.
- Adding an account delegates authentication to the official `hs account auth` flow. This package does not collect credentials.

Use a HubSpot sandbox or test account when validating a new workflow. `Watch` and `Deploy` write to the selected HubSpot account.

## Local files

| Path | Purpose |
| --- | --- |
| `src/{account}-{id}/` | Files downloaded from Design Manager |
| `paths-config.json` | Saved remote paths by account |
| `.hsaccount` | Last selected account ID |
| `db/fetch-log.json` | Successful fetch timestamps |
| `db/deploy-history.json` | Most recent 50 deploy records |

These state formats remain compatible with the legacy shell-based workflow.

## Development

```bash
npm install
npm run check
npm run test:coverage
npm pack --dry-run
```

Useful scripts:

- `npm run dev`: Rebuild on source changes
- `npm run lint`: Run ESLint
- `npm run typecheck`: Run TypeScript without emitting files
- `npm test`: Run the Vitest suite once
- `npm run build`: Build the Node 22 ESM bundle in `dist/`

## License

MIT © 2026 Robert Marinho
