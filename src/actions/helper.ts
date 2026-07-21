import * as p from "@clack/prompts";
import pc from "picocolors";

/** Menu action: quick-start guide and workflow overview. */
export async function helperAction(): Promise<void> {
  const title = (text: string): string => pc.cyan(pc.bold(text));

  p.note(
    [
      title("Quick start"),
      "  1. Configure new path — download a Design Manager path (e.g. /my-theme)",
      "  2. Edit files locally under src/{portal}-{id}/",
      "  3. Watch — auto-upload on save, or Deploy — upload + git commit",
      "",
      title("Remote path examples"),
      "  /my-theme                  whole theme",
      "  /my-theme/templates        just the templates folder",
      "  /marketing/modules/cta     a single module",
      "",
      title("Files"),
      "  paths-config.json          saved paths per portal",
      "  db/deploy-history.json     last 50 deploys",
      "",
      title("Requirements"),
      "  HubSpot CLI v8+ (npm i -g @hubspot/cli), authenticated via: hs account auth",
      "  Deploy detects changes with git, so run inside a git repository",
    ].join("\n"),
    "Help"
  );
}
