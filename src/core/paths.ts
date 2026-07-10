import os from "node:os";
import path from "node:path";

export interface ResolvedPaths {
  packageDataDir: string;
  storeFile: string;
  locksDir: string;
  openCodeDataDir: string;
  openCodeAuthFile: string;
}

function resolveBaseDataHome(env: NodeJS.ProcessEnv): string {
  return env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
}

export function resolvePaths(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedPaths {
  const baseDataHome = resolveBaseDataHome(env);
  const packageDataDir =
    env.OPENCODE_MULTI_ACCOUNT_DATA_DIR ||
    path.join(baseDataHome, "opencode-openai-multi-account");
  const openCodeDataDir =
    env.OPENCODE_DATA_DIR || path.join(baseDataHome, "opencode");

  return {
    packageDataDir,
    storeFile: path.join(packageDataDir, "accounts.json"),
    locksDir: path.join(packageDataDir, "locks"),
    openCodeDataDir,
    openCodeAuthFile: path.join(openCodeDataDir, "auth.json"),
  };
}
