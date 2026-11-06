// Entry of `npm run build` and `npm run check`: installs the packages when they are missing, then runs the build.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(join(root, "node_modules", "yaml"))) {
  console.log("Installing packages (first run)...");
  const r = spawnSync("npm install --no-audit --no-fund", { cwd: root, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
await import("./build.mjs");
