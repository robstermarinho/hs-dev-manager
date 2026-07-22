import * as p from "@clack/prompts";
import pc from "picocolors";
import type { HsAccount } from "../hs/accounts.js";
import { joinRemote, listRemote, parentRemote, type RemoteEntry } from "../hs/remote-ls.js";
import { dim, handleCancel } from "../ui.js";

const USE_CURRENT = "__use__";
const GO_UP = "__up__";
const CANCEL = "__cancel__";

function entryOption(entry: RemoteEntry): { value: string; label: string; hint?: string } {
  switch (entry.kind) {
    case "folder":
      return { value: entry.name, label: `${pc.cyan(entry.name)}/` };
    case "module":
      return { value: entry.name, label: pc.magenta(entry.name), hint: "module" };
    case "file":
      return { value: entry.name, label: entry.name };
  }
}

/**
 * Interactively browse the remote Design Manager via `hs cms ls` and return
 * the chosen remote path, or undefined when cancelled or listing fails.
 */
export async function browseRemotePath(account: HsAccount): Promise<string | undefined> {
  let current = "/";

  while (true) {
    const spinner = p.spinner();
    spinner.start(`Listing ${current}`);
    const entries = await listRemote(account.accountId, current);
    if (!entries) {
      spinner.stop(`Failed to list ${current}`, 1);
      return undefined;
    }
    spinner.stop(`${current} ${dim(`· ${entries.length} item(s)`)}`);

    const choice = handleCancel(
      await p.select<string>({
        message: `Browsing ${pc.cyan(current)}`,
        options: [
          ...(current !== "/"
            ? [
                { value: USE_CURRENT, label: `✓ Use this path (${current})` },
                { value: GO_UP, label: "↑ Up one level" },
              ]
            : []),
          ...entries.map(entryOption),
          { value: CANCEL, label: "← Cancel" },
        ],
      })
    );

    if (choice === CANCEL) return undefined;
    if (choice === USE_CURRENT) return current;
    if (choice === GO_UP) {
      current = parentRemote(current);
      continue;
    }

    const entry = entries.find((e) => e.name === choice);
    if (!entry) continue;
    const chosenPath = joinRemote(current, entry.name);

    if (entry.kind === "folder") {
      current = chosenPath;
      continue;
    }
    // Modules and files are terminal fetch units.
    return chosenPath;
  }
}
