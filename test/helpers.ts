import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AccountManager } from "../src/core/service.js";
import { readAccountStore } from "../src/core/store.js";
import { resolvePaths } from "../src/core/paths.js";

export const FIXED_NOW = Date.parse("2026-04-22T12:00:00.000Z");

export function createJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.`;
}

export async function createHarness(
  options: {
    now?: () => number;
    ids?: string[];
  } = {},
) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "opencode-multi-account-"),
  );
  const env = {
    ...process.env,
    OPENCODE_MULTI_ACCOUNT_DATA_DIR: path.join(root, "multi"),
    OPENCODE_DATA_DIR: path.join(root, "opencode"),
  };

  const ids = [...(options.ids ?? [])];
  const manager = new AccountManager({
    env,
    now: options.now ?? (() => FIXED_NOW),
    createId: ids.length ? () => ids.shift() ?? crypto.randomUUID() : undefined,
  });
  const paths = resolvePaths(env);

  return {
    root,
    env,
    paths,
    manager,
    async readStore() {
      return readAccountStore(paths.storeFile);
    },
    async readAuthFile() {
      const raw = await fs.readFile(paths.openCodeAuthFile, "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    },
    async writeAuthFile(data: unknown) {
      await fs.mkdir(paths.openCodeDataDir, { recursive: true });
      await fs.writeFile(
        paths.openCodeAuthFile,
        `${JSON.stringify(data, null, 2)}\n`,
      );
    },
    async cleanup() {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
