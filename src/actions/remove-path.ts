import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import * as p from "@clack/prompts";
import type { HsAccount } from "../hs/accounts.js";
import { portalKey } from "../hs/accounts.js";
import { localDirFor } from "../paths.js";
import { loadPathsConfig, portalPaths, removePath, savePathsConfig } from "../state/paths-config.js";
import { dim, handleCancel } from "../ui.js";

/** Menu action: remove a saved path from paths-config.json, optionally deleting local files. */
export async function removePathAction(account: HsAccount, cwd: string = process.cwd()): Promise<void> {
  const config = await loadPathsConfig(cwd);
  const key = portalKey(account);
  const paths = portalPaths(config, key);

  if (paths.length === 0) {
    p.log.info("No saved paths for this portal.");
    return;
  }

  const BACK = "__back__";
  const remotePath = handleCancel(
    await p.select({
      message: "Which path to remove?",
      options: [
        ...paths.map((path) => ({ value: path, label: path })),
        { value: BACK, label: "← Back" },
      ],
    })
  );
  if (remotePath === BACK) return;

  const confirmed = handleCancel(
    await p.confirm({ message: `Remove ${remotePath} from paths-config.json? (HubSpot files are not affected)` })
  );
  if (!confirmed) return;

  await savePathsConfig(removePath(config, key, remotePath), cwd);
  p.log.success(`Removed ${remotePath} from config.`);

  const localDir = localDirFor(account, remotePath, cwd);
  if (!existsSync(localDir)) return;

  const deleteLocal = handleCancel(
    await p.confirm({
      message: `Also delete the local folder? ${dim(localDir)}`,
      initialValue: false,
    })
  );
  if (!deleteLocal) return;

  await rm(localDir, { recursive: true, force: true });
  p.log.success(`Deleted ${localDir}`);
}
