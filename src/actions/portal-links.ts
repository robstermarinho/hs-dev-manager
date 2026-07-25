import * as p from "@clack/prompts";
import type { HsAccount } from "../hs/accounts.js";
import { hubspotPortalUrls } from "../paths.js";
import { handleCancel, menuLabel, openUrl } from "../ui.js";

const BACK = Symbol("back");

interface PortalLink {
  label: string;
  url: string;
}

export function portalLinks(account: HsAccount): PortalLink[] {
  const urls = hubspotPortalUrls(account);
  return [
    { label: "Design Manager", url: urls.designManager },
    { label: "Website pages", url: urls.websites },
    { label: "HubDB tables", url: urls.hubdb },
    { label: "Settings", url: urls.settings },
    { label: "Files", url: urls.files },
  ];
}

/** Select and open a HubSpot app page scoped to the current portal. */
export async function portalLinksAction(
  account: HsAccount,
  opener: (url: string) => Promise<boolean> = openUrl
): Promise<void> {
  const selected = handleCancel<PortalLink | typeof BACK>(
    await p.select<PortalLink | typeof BACK>({
      message: `Open HubSpot for ${account.name}`,
      options: [
        ...portalLinks(account).map((link) => ({
          value: link,
          label: menuLabel("open", link.label),
          hint: link.url,
        })),
        { value: BACK, label: menuLabel("back", "Back") },
      ],
    })
  );

  if (selected === BACK) return;
  if (!(await opener(selected.url))) {
    p.log.warn(`Could not open the browser. Visit: ${selected.url}`);
  }
}
