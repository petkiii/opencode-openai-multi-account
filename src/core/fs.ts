import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export async function ensureDirPrivate(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
}

export async function readJsonFile<T>(
  filePath: string,
  fallback: T,
): Promise<T> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch (error) {
    if (isMissing(error)) return fallback;
    throw error;
  }
}

export async function writeJsonAtomic(
  filePath: string,
  value: unknown,
  mode = 0o600,
): Promise<void> {
  const directory = path.dirname(filePath);
  await ensureDirPrivate(directory);

  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${randomUUID()}.tmp`,
  );
  const content = `${JSON.stringify(value, null, 2)}\n`;

  await fs.writeFile(tempPath, content, { mode, flag: "wx" });
  await fs.rename(tempPath, filePath);
}

export async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
