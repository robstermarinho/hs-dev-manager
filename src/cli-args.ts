export type CliMode =
  | { kind: "run" }
  | { kind: "init" }
  | { kind: "version" }
  | { kind: "help" }
  | { kind: "unknown"; flag: string };

const VERSION_FLAGS = ["--version", "-v"];
const HELP_FLAGS = ["--help", "-h"];

/**
 * The CLI is interactive; the only arguments it takes are the ones every CLI is
 * expected to answer. An unrecognized flag is reported instead of silently
 * dropping the user into the menu.
 */
export function parseCliArgs(args: string[]): CliMode {
  // Help wins over version whatever the order, as everywhere else.
  if (args.some((arg) => HELP_FLAGS.includes(arg))) return { kind: "help" };
  if (args.some((arg) => VERSION_FLAGS.includes(arg))) return { kind: "version" };

  const unknown = args.find((arg) => arg.startsWith("-"));
  if (unknown) return { kind: "unknown", flag: unknown };

  return args[0] === "init" ? { kind: "init" } : { kind: "run" };
}

export function helpText(packageName: string, version: string): string {
  return [
    `${packageName} v${version} — interactive manager for HubSpot Design Manager files`,
    "",
    "Usage",
    "  hsdm                 start the interactive menu",
    "  hsdm init            prepare this folder (git repository + .gitignore)",
    "  hsdm --version       print the version",
    "  hsdm --help          print this help",
    "",
    "What it does",
    "  Downloads Design Manager paths into src/{portal}-{id}/, watches or deploys",
    "  your edits back, and checks HubSpot for changes before overwriting anything.",
    "",
    "Requirements",
    "  HubSpot CLI v8+ (npm i -g @hubspot/cli), authenticated via: hs account auth",
    "  Deploy and fetch commits need a git repository",
    "",
    "Environment",
    "  HSDM_NO_REMOTE_CHECK=1   never compare against HubSpot (CI, or keys without CMS scopes)",
  ].join("\n");
}
