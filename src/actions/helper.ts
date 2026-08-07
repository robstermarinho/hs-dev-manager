import * as p from "@clack/prompts";
import pc from "picocolors";

/** Menu action: quick-start guide and workflow overview. */
export async function helperAction(): Promise<void> {
  const title = (text: string): string => pc.cyan(pc.bold(text));

  p.note(
    [
      title("Quick start"),
      "  1. Paths → Configure new path — download a Design Manager path (e.g. /my-theme)",
      "  2. Edit files locally under src/{portal}-{id}/",
      "  3. Watch — auto-upload on save, or Deploy — upload + git commit",
      "  4. Later: Fetch / update local — see what changed on HubSpot since your last sync",
      "",
      title("Remote path examples"),
      "  /my-theme                  whole theme",
      "  /my-theme/templates        just the templates folder",
      "  /marketing/modules/cta     a single module",
      "",
      title("Files"),
      "  paths-config.json          saved paths per portal (commit this)",
      "  db/                        local sync state and deploy history (do not commit)",
      "  .hsaccount                 last selected portal (do not commit)",
      "",
      title("Requirements"),
      "  HubSpot CLI v8+ (npm i -g @hubspot/cli), authenticated via: hs account auth",
      "  Deploy detects changes with git, so run inside a git repository",
      "  hsdm init prepares a folder: git repository + .gitignore for the local state",
    ].join("\n"),
    "Help"
  );
}
