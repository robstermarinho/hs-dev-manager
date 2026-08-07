import { createRequire } from "node:module";
import { helpText, parseCliArgs } from "./cli-args.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { name: string; version: string };

async function main(): Promise<void> {
  const mode = parseCliArgs(process.argv.slice(2));

  if (mode.kind === "version") {
    console.log(pkg.version);
    return;
  }
  if (mode.kind === "help") {
    console.log(helpText(pkg.name, pkg.version));
    return;
  }
  if (mode.kind === "unknown") {
    console.error(`Unknown option: ${mode.flag}\n`);
    console.error(helpText(pkg.name, pkg.version));
    process.exitCode = 1;
    return;
  }

  if (mode.kind === "init") {
    const { bootstrapProject, describeBootstrap } = await import("./bootstrap.js");
    for (const line of describeBootstrap(await bootstrapProject())) console.log(line);
    return;
  }

  const { runApp } = await import("./menu.js");
  await runApp();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
