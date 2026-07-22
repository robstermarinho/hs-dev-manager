import { chmod, rm } from "node:fs/promises";
import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");
const executableCli = {
  name: "executable-cli",
  setup(buildApi) {
    buildApi.onEnd(async (result) => {
      if (result.errors.length === 0) await chmod(new URL("../dist/cli.js", import.meta.url), 0o755);
    });
  },
};
const options = {
  entryPoints: ["src/cli.ts"],
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node20",
  outdir: "dist",
  entryNames: "[name]",
  chunkNames: "chunks/[name]-[hash]",
  splitting: true,
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "info",
  plugins: [executableCli],
};

await rm(new URL("../dist", import.meta.url), { recursive: true, force: true });

if (watch) {
  const buildContext = await context(options);
  await buildContext.watch();
  console.log("Watching for changes…");
} else {
  await build(options);
}
