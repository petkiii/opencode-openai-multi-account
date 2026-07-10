import { chmodSync, existsSync } from "node:fs";

const binPath = "dist/cli/index.js";

if (!existsSync(binPath)) {
  throw new Error(`Missing built CLI entrypoint: ${binPath}`);
}

if (process.platform !== "win32") {
  chmodSync(binPath, 0o755);
}
