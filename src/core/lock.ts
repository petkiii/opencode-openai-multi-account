import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureDirPrivate, sleep } from "./fs.js";

const LOCK_TIMEOUT_MS = 10_000;
const LOCK_STALE_MS = 120_000;
const LOCK_RETRY_MS = 75;

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

async function removeStaleLock(lockPath: string): Promise<void> {
  try {
    const info = await fs.stat(lockPath);
    if (Date.now() - info.mtimeMs <= LOCK_STALE_MS) return;
    await fs.rm(lockPath, { recursive: true, force: true });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return;
    throw error;
  }
}

export async function withFileLock<T>(
  locksDir: string,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  await ensureDirPrivate(locksDir);

  const lockPath = path.join(locksDir, `${hashKey(key)}.lock`);
  const ownerFile = path.join(lockPath, "owner.json");
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (true) {
    try {
      await fs.mkdir(lockPath, { mode: 0o700 });
      await fs.writeFile(
        ownerFile,
        `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), key })}\n`,
        { mode: 0o600, flag: "wx" },
      );
      break;
    } catch (error) {
      if (Date.now() >= deadline) {
        throw new Error(`Timed out acquiring lock for ${key}`);
      }

      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        await removeStaleLock(lockPath);
        await sleep(LOCK_RETRY_MS);
        continue;
      }

      throw error;
    }
  }

  try {
    return await fn();
  } finally {
    await fs
      .rm(lockPath, { recursive: true, force: true })
      .catch(() => undefined);
  }
}
