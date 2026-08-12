# Changelog

Notable changes to `hs-dev-manager`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **The Paths screen says what state each saved path is in**: how long ago it was fetched and whether it exists on disk, so a path configured on another machine or deleted locally is visible without entering fetch. An `Open Design Manager` item sits next to it. The screen stays offline — it is re-rendered after every sub-action, and drift is reported where it is acted on.

### Fixed

- **The drift check reported "HubSpot matches your local copy" when it had nothing to compare against.** A portal with no sync records — every repo carried over from the bash version — had no baseline, and the missing baseline was rendered as an all-clear, hiding real Design Manager edits. Paths that cannot be compared are now named as unverified, in the headline, in the per-path hints, and in watch, which falls back to asking instead of starting on a copy it cannot vouch for.
- **A local copy that no longer matches its recorded sync is now detected.** A `git checkout`, a discarded fetch, or an edit made outside the tool leaves the recorded timestamp describing content that is gone, and every comparison against it reads as "in sync". Those paths are reported as unverified instead.
- **Repos with no sync records now compare against local file times** rather than giving up. It dates the local write, not a verified match, so the headline says so.

### Changed

- **JSON files that came back only with their keys reordered are reverted after a fetch.** HubSpot does not serialize `fields.json` with a stable key order, so re-downloading an untouched theme rewrote dozens of them byte for byte and buried the real changes in the review. Array order, which is the field order shown in the editor, is still compared as-is.

## [0.2.0] — 2026-08-06

Everything the tool sends to or takes from HubSpot now starts from knowing what changed there. In 0.1.0, fetch overwrote and deploy uploaded without ever comparing, so an edit made in the Design Manager was lost without a word.

### Added

- **Design Manager drift detection.** Two listing requests report every remote asset's modification time, compared against a content hash recorded for each file at its last sync (`db/remote-state.json`). Read-only, and silent when it cannot answer — it never claims your copy is current without knowing.
- **Fetch shows what moved before you choose.** Entering `Fetch / update local` lists the drifted assets and annotates each saved path. A path that drifted then offers `Only what changed`, which downloads just those assets, or the full re-download as before. Each saved path is treated on its own.
- **Watch checks before it starts.** Nothing changed means no prompt at all; otherwise it lists the drift and offers to download what changed, re-download the path, or watch anyway. What it downloads is committed like a fetch sync.
- **Deploy compares each file against its Design Manager copy** before uploading, and can show a diff of exactly what the upload would overwrite. Conflicts can be skipped, overwritten, or the deploy cancelled.
- **Offline lint for HubL and JSON**, both as a menu action and as a gate before any upload: delimiter and block balance, and JSON parsing with line and column. (`hs cms lint` no longer exists in HubSpot CLI v8; the remaining validators are marketplace-only.)
- **Browsable deploy history** with relative ages, file counts, a shortened path per row, pagination, and each deploy's files rendered as a tree.
- **Post-fetch review**: commit the sync, read the full diff, or undo the fetch entirely.
- **`hsdm init`** prepares a folder — git repository plus a `.gitignore` for the tool's local state — and is safe to re-run. The menu offers the same thing the first time it matters.
- **`hsdm --help`**, and the tool's own version shown next to the HubSpot CLI version at startup.
- **`HSDM_NO_REMOTE_CHECK=1`** skips every remote check, for CI or an access key without the CMS scopes. Deploy then says out loud that it is uploading without comparing.

### Changed

- Path management moved into a **Paths** submenu that shows the saved paths on entry, so listing them is no longer a separate action and the main menu is shorter.
- Deploy records a content hash for every file it uploads, which is what later drift checks compare against.
- Unknown command-line flags now fail with the help text instead of silently opening the interactive menu.
- README gained a get-started tutorial and a section stating exactly what the tool requests from HubSpot, and what each request costs.

### Fixed

- **The remote listing was capped at 1000 assets** and ignored the reported total, so a larger portal silently under-reported drift — the worst way for this check to fail. Both listings are now paged to completion.
- A listing that cannot be read in full now reports "unknown" instead of an empty result, which previously read as "nothing changed on HubSpot".
- **HubL lint false positives**: whitespace control (`{%- … -%}`), backslash-escaped quotes inside tags, punctuation immediately after a tag name, and `{% raw %}` bodies were all misparsed. Across one real 4870-file project this cut 57 reported errors to 4, each of which is a genuine stray closing tag.
- Watch no longer leaves what it downloaded uncommitted, which blocked the next fetch on its clean-tree guard and was swept into the deploy offered when the watch stopped.
- A targeted download now refreshes the saved path's "last fetch" age instead of leaving it pointing at the last full re-download.
- `HSDM_NO_REMOTE_CHECK` was documented as skipping the remote check but was ignored by deploy.

## [0.1.0] — 2026-07-25

First published release: portal selection, path configuration with a remote browser, fetch, watch, deploy with scoped git commits, deploy history, and HubSpot shortcuts.
