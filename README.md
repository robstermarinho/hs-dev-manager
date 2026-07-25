# hubspot-dev-manager

Interactive CLI for fetching, watching, and deploying HubSpot Design Manager files across multiple accounts.

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
npm install --global hubspot-dev-manager
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

- `npm run dev` — rebuild on source changes
- `npm run lint` — run ESLint
- `npm run typecheck` — run TypeScript without emitting files
- `npm test` — run the Vitest suite once
- `npm run build` — build the Node 22 ESM bundle in `dist/`

## License

MIT © 2026 Robert Marinho
